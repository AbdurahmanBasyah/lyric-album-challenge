import { z } from "zod";

import type { SpotifyFetch } from "../auth/spotify";
import {
  fetchWithRetry,
  type RetryClock,
  type RetrySleep,
} from "../http/retry";
import type { TrackSummary } from "../../types/tracks";

/** The current Spotify playlist-item collection endpoint. */
export const SPOTIFY_PLAYLIST_ITEMS_URL =
  "https://api.spotify.com/v1/playlists";

/** Spotify currently accepts at most 50 playlist items per request. */
export const PLAYLIST_ITEMS_PAGE_SIZE = 50;

const MAX_SAFE_OFFSET = Number.MAX_SAFE_INTEGER;
const MIN_LRCLIB_DURATION_MS = 1_000;
const MAX_LRCLIB_DURATION_MS = 3_600_000;
const SPOTIFY_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export type SpotifyPlaylistItemsErrorKind =
  | "invalid_input"
  | "invalid_cursor"
  | "auth"
  | "inaccessible"
  | "rate_limited"
  | "unavailable";

/**
 * Provider failures intentionally retain only a stable category. In
 * particular, response bodies, URLs, schema issues, and token values are not
 * stored on this error.
 */
export class SpotifyPlaylistItemsError extends Error {
  readonly kind: SpotifyPlaylistItemsErrorKind;

  constructor(kind: SpotifyPlaylistItemsErrorKind) {
    super(
      kind === "invalid_input"
        ? "Spotify playlist input is invalid."
        : kind === "invalid_cursor"
          ? "Spotify playlist cursor is invalid."
          : "Spotify playlist items request failed.",
    );
    this.name = "SpotifyPlaylistItemsError";
    this.kind = kind;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type SpotifyPlaylistItemsRequestDependencies = Readonly<{
  fetch?: SpotifyFetch;
  sleep?: RetrySleep;
  now?: RetryClock;
}>;

export type SpotifyPlaylistItemsInput = Readonly<{
  accessToken: string;
  playlistId: string;
  cursor?: string;
  fetch?: SpotifyFetch;
  sleep?: RetrySleep;
  now?: RetryClock;
  dependencies?: SpotifyPlaylistItemsRequestDependencies;
}>;

/** Alias for callers that use request terminology. */
export type SpotifyPlaylistItemsRequest = SpotifyPlaylistItemsInput;

export type SpotifyPlaylistItemsPage = Readonly<{
  items: readonly TrackSummary[];
  nextCursor: string | null;
}>;

/** Alias kept for callers that use the shorter domain name. */
export type PlaylistItemsPage = SpotifyPlaylistItemsPage;

const safeNonNegativeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .refine(Number.isSafeInteger);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSpotifyId(value: string): boolean {
  return SPOTIFY_ID_PATTERN.test(value);
}

function normalizePlaylistId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (normalized.length === 0 || !isSpotifyId(normalized)) {
    return null;
  }

  return normalized;
}

function isSpotifyPaginationUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return (
      url.protocol === "https:" &&
      url.hostname === "api.spotify.com" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

const spotifyPaginationUrlSchema = z
  .string()
  .trim()
  .url()
  .refine(isSpotifyPaginationUrl);

const spotifyPlaylistItemWrapperSchema = z
  .object({
    is_local: z.boolean(),
    item: z.unknown().nullable(),
  })
  .passthrough();

const spotifyItemTypeSchema = z
  .object({
    type: z.string().trim().min(1),
  })
  .passthrough();

const spotifyTrackAvailabilitySchema = z
  .object({
    is_local: z.boolean().nullable().optional(),
    is_playable: z.boolean().nullable().optional(),
    restrictions: z.record(z.string(), z.unknown()).nullable().optional(),
    available_markets: z.array(z.string()).nullable().optional(),
  })
  .passthrough();

const spotifyArtistSchema = z
  .object({
    name: z.string().trim().min(1),
  })
  .passthrough();

const spotifyTrackSchema = z
  .object({
    type: z.literal("track"),
    id: z.string().trim().min(1).regex(SPOTIFY_ID_PATTERN),
    name: z.string().trim().min(1),
    artists: z.array(spotifyArtistSchema).min(1),
    album: z
      .object({
        name: z.string().trim().min(1),
      })
      .passthrough(),
    // Zero is a structurally valid non-negative Spotify duration but falls
    // outside LRCLIB's lookup range and is filtered after parsing. Negative,
    // fractional, and unsafe values remain malformed provider metadata.
    duration_ms: safeNonNegativeIntegerSchema,
    track_number: z
      .number()
      .int()
      .positive()
      .refine(Number.isSafeInteger),
    disc_number: z
      .number()
      .int()
      .positive()
      .refine(Number.isSafeInteger),
    is_local: z.boolean().nullable().optional(),
    is_playable: z.boolean().nullable().optional(),
    restrictions: z.record(z.string(), z.unknown()).nullable().optional(),
    available_markets: z.array(z.string()).nullable().optional(),
  })
  .passthrough();

const spotifyPlaylistItemsResponseSchema = z
  .object({
    items: z.array(z.unknown()),
    limit: z.number().int().min(1).max(PLAYLIST_ITEMS_PAGE_SIZE),
    next: spotifyPaginationUrlSchema.nullable(),
    offset: safeNonNegativeIntegerSchema,
    total: safeNonNegativeIntegerSchema,
  })
  .passthrough();

type SpotifyPlaylistItemsResponse = z.infer<
  typeof spotifyPlaylistItemsResponseSchema
>;

/**
 * Parses the application-owned opaque cursor. Only canonical decimal offsets
 * are accepted; Spotify pagination URLs never cross this adapter boundary.
 */
export function parseOffsetCursor(cursor?: string): number {
  if (cursor === undefined) {
    return 0;
  }

  if (typeof cursor !== "string" || !/^(?:0|[1-9]\d*)$/.test(cursor)) {
    throw new SpotifyPlaylistItemsError("invalid_cursor");
  }

  const offset = Number(cursor);

  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > MAX_SAFE_OFFSET
  ) {
    throw new SpotifyPlaylistItemsError("invalid_cursor");
  }

  return offset;
}

/** Alias with an adapter-specific name for callers importing both cursors. */
export const parsePlaylistItemsOffsetCursor = parseOffsetCursor;

export function buildPlaylistItemsUrl(
  playlistId: string,
  cursor?: string,
): URL {
  const normalizedPlaylistId = normalizePlaylistId(playlistId);

  if (normalizedPlaylistId === null) {
    throw new SpotifyPlaylistItemsError("invalid_input");
  }

  const offset = parseOffsetCursor(cursor);
  const url = new URL(
    `${SPOTIFY_PLAYLIST_ITEMS_URL}/${encodeURIComponent(normalizedPlaylistId)}/items`,
  );
  url.searchParams.set("limit", String(PLAYLIST_ITEMS_PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  return url;
}

/** Alias that makes the provider boundary explicit at call sites. */
export const buildSpotifyPlaylistItemsUrl = buildPlaylistItemsUrl;

function classifyProviderResponse(
  response: Response,
): SpotifyPlaylistItemsErrorKind {
  if (response.status === 401) {
    return "auth";
  }

  if (response.status === 403) {
    return "inaccessible";
  }

  if (response.status === 429) {
    return "rate_limited";
  }

  return "unavailable";
}

function schemaFailure(): never {
  throw new SpotifyPlaylistItemsError("unavailable");
}

function mapPlaylistItem(rawWrapper: unknown): TrackSummary | null {
  // A null wrapper is not a valid playlist-item envelope. The provider uses a
  // wrapper with `item: null` for an unavailable entry; silently accepting a
  // null wrapper would hide malformed page data.
  if (rawWrapper === null) {
    return schemaFailure();
  }

  if (!isRecord(rawWrapper)) {
    return schemaFailure();
  }

  // Local entries are explicitly ineligible. Check this before requiring an
  // item because provider local placeholders need not contain usable metadata.
  if (rawWrapper.is_local === true) {
    return null;
  }

  const wrapper = spotifyPlaylistItemWrapperSchema.safeParse(rawWrapper);

  if (!wrapper.success) {
    return schemaFailure();
  }

  const rawItem = wrapper.data.item;

  if (rawItem === null) {
    return null;
  }

  if (!isRecord(rawItem)) {
    return schemaFailure();
  }

  const itemType = spotifyItemTypeSchema.safeParse(rawItem);

  if (!itemType.success) {
    return schemaFailure();
  }

  // Episodes and any future non-track item types have no place in this
  // track-only lyric pipeline. Their provider fields are intentionally not
  // parsed as track metadata.
  if (itemType.data.type !== "track") {
    return null;
  }

  // Availability metadata is parsed before the required track fields so an
  // explicitly unavailable track can be skipped even when Spotify omits the
  // rest of its metadata.
  const availability = spotifyTrackAvailabilitySchema.safeParse(rawItem);

  if (!availability.success) {
    return schemaFailure();
  }

  if (
    availability.data.is_local === true ||
    availability.data.is_playable === false ||
    (availability.data.restrictions !== undefined &&
      availability.data.restrictions !== null)
  ) {
    return null;
  }

  const track = spotifyTrackSchema.safeParse(rawItem);

  if (!track.success) {
    return schemaFailure();
  }

  if (
    track.data.duration_ms < MIN_LRCLIB_DURATION_MS ||
    track.data.duration_ms > MAX_LRCLIB_DURATION_MS
  ) {
    return null;
  }

  return {
    spotifyId: track.data.id,
    name: track.data.name,
    artistNames: track.data.artists.map((artist) => artist.name),
    durationMs: track.data.duration_ms,
  };
}

function getNextCursor(page: SpotifyPlaylistItemsResponse): string | null {
  if (page.next === null) {
    return null;
  }

  const fallbackOffset = page.offset + page.items.length;

  if (!Number.isSafeInteger(fallbackOffset)) {
    throw new SpotifyPlaylistItemsError("unavailable");
  }

  let providerNextUrl: URL;

  try {
    // The response schema has already checked the origin and URL shape. Keep
    // this parse guarded so malformed URL implementations still fail neutral.
    providerNextUrl = new URL(page.next);
  } catch {
    throw new SpotifyPlaylistItemsError("unavailable");
  }

  const providerOffset = providerNextUrl.searchParams.get("offset");

  if (providerOffset === null) {
    return String(fallbackOffset);
  }

  try {
    return String(parseOffsetCursor(providerOffset));
  } catch {
    throw new SpotifyPlaylistItemsError("unavailable");
  }
}

function isRequestDependencies(
  value: unknown,
): value is SpotifyPlaylistItemsRequestDependencies {
  return (
    isRecord(value) &&
    (value.fetch === undefined || typeof value.fetch === "function") &&
    (value.sleep === undefined || typeof value.sleep === "function") &&
    (value.now === undefined || typeof value.now === "function")
  );
}

type NormalizedPlaylistItemsRequest = Readonly<{
  playlistId: string;
  accessToken: string;
  cursor?: string;
  dependencies: SpotifyPlaylistItemsRequestDependencies;
}>;

function normalizeRequestArguments(
  inputOrAccessToken: SpotifyPlaylistItemsInput | string,
  positionalPlaylistId?: string,
  positionalCursor?: string,
  positionalDependencies?: SpotifyPlaylistItemsRequestDependencies,
): NormalizedPlaylistItemsRequest {
  let accessToken: unknown;
  let playlistId: unknown;
  let cursor: unknown;
  let fetchCandidate: unknown;
  let sleepCandidate: unknown;
  let nowCandidate: unknown;

  if (typeof inputOrAccessToken === "string") {
    accessToken = inputOrAccessToken;
    playlistId = positionalPlaylistId;
    cursor = positionalCursor;

    if (
      positionalDependencies !== undefined &&
      !isRequestDependencies(positionalDependencies)
    ) {
      throw new SpotifyPlaylistItemsError("invalid_input");
    }

    fetchCandidate = positionalDependencies?.fetch;
    sleepCandidate = positionalDependencies?.sleep;
    nowCandidate = positionalDependencies?.now;
  } else if (isRecord(inputOrAccessToken)) {
    accessToken = inputOrAccessToken.accessToken;
    playlistId = inputOrAccessToken.playlistId;
    cursor = inputOrAccessToken.cursor;

    if (
      Object.prototype.hasOwnProperty.call(inputOrAccessToken, "fetch") &&
      inputOrAccessToken.fetch !== undefined &&
      typeof inputOrAccessToken.fetch !== "function"
    ) {
      throw new SpotifyPlaylistItemsError("invalid_input");
    }

    if (
      inputOrAccessToken.dependencies !== undefined &&
      !isRequestDependencies(inputOrAccessToken.dependencies)
    ) {
      throw new SpotifyPlaylistItemsError("invalid_input");
    }

    fetchCandidate =
      inputOrAccessToken.fetch ?? inputOrAccessToken.dependencies?.fetch;
    sleepCandidate =
      inputOrAccessToken.sleep ?? inputOrAccessToken.dependencies?.sleep;
    nowCandidate = inputOrAccessToken.now ?? inputOrAccessToken.dependencies?.now;
  } else {
    throw new SpotifyPlaylistItemsError("invalid_input");
  }

  const normalizedPlaylistId = normalizePlaylistId(playlistId);

  if (
    typeof accessToken !== "string" ||
    accessToken.trim().length === 0 ||
    normalizedPlaylistId === null
  ) {
    throw new SpotifyPlaylistItemsError("invalid_input");
  }

  if (cursor !== undefined && typeof cursor !== "string") {
    throw new SpotifyPlaylistItemsError("invalid_cursor");
  }

  parseOffsetCursor(cursor);

  if (fetchCandidate !== undefined && typeof fetchCandidate !== "function") {
    throw new SpotifyPlaylistItemsError("invalid_input");
  }

  if (sleepCandidate !== undefined && typeof sleepCandidate !== "function") {
    throw new SpotifyPlaylistItemsError("invalid_input");
  }

  if (nowCandidate !== undefined && typeof nowCandidate !== "function") {
    throw new SpotifyPlaylistItemsError("invalid_input");
  }

  return {
    playlistId: normalizedPlaylistId,
    accessToken: accessToken.trim(),
    cursor,
    dependencies: {
      ...(fetchCandidate === undefined
        ? {}
        : { fetch: fetchCandidate as SpotifyFetch }),
      ...(sleepCandidate === undefined
        ? {}
        : { sleep: sleepCandidate as RetrySleep }),
      ...(nowCandidate === undefined
        ? {}
        : { now: nowCandidate as RetryClock }),
    },
  };
}

/**
 * Fetches exactly one page of the current playlist-item endpoint. Provider
 * pagination is reduced to an application-owned decimal cursor, and only
 * lyric-eligible Spotify tracks are returned.
 */
export function getPlaylistItems(
  input: SpotifyPlaylistItemsInput,
): Promise<SpotifyPlaylistItemsPage>;
export function getPlaylistItems(
  accessToken: string,
  playlistId: string,
  cursor?: string,
  dependencies?: SpotifyPlaylistItemsRequestDependencies,
): Promise<SpotifyPlaylistItemsPage>;
export function getPlaylistItems(
  accessToken: string,
  playlistId: string,
  dependencies?: SpotifyPlaylistItemsRequestDependencies,
): Promise<SpotifyPlaylistItemsPage>;
export async function getPlaylistItems(
  inputOrAccessToken: SpotifyPlaylistItemsInput | string,
  positionalPlaylistId?: string,
  positionalCursor?: string | SpotifyPlaylistItemsRequestDependencies,
  positionalDependencies: SpotifyPlaylistItemsRequestDependencies = {},
): Promise<SpotifyPlaylistItemsPage> {
  let cursor: string | undefined;
  let dependencies = positionalDependencies;

  if (isRequestDependencies(positionalCursor)) {
    cursor = undefined;
    dependencies = positionalCursor;
  } else {
    cursor = positionalCursor;
  }

  const request = normalizeRequestArguments(
    inputOrAccessToken,
    positionalPlaylistId,
    cursor,
    dependencies,
  );
  const playlistId = normalizePlaylistId(request.playlistId);
  const accessToken = request.accessToken;

  if (playlistId === null || accessToken.length === 0) {
    throw new SpotifyPlaylistItemsError("invalid_input");
  }

  const requestCursor = request.cursor;
  const url = buildPlaylistItemsUrl(playlistId, requestCursor);
  let response: Response;

  try {
    response = await fetchWithRetry(
      url.toString(),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        fetch: request.dependencies.fetch,
        sleep: request.dependencies.sleep,
        now: request.dependencies.now,
      },
    );
  } catch {
    throw new SpotifyPlaylistItemsError("unavailable");
  }

  if (!response.ok) {
    throw new SpotifyPlaylistItemsError(classifyProviderResponse(response));
  }

  let rawResponse: unknown;

  try {
    rawResponse = await response.json();
  } catch {
    throw new SpotifyPlaylistItemsError("unavailable");
  }

  const parsed = spotifyPlaylistItemsResponseSchema.safeParse(rawResponse);

  if (!parsed.success) {
    throw new SpotifyPlaylistItemsError("unavailable");
  }

  const page = parsed.data;
  const mappedItems: TrackSummary[] = [];

  for (const item of page.items) {
    const track = mapPlaylistItem(item);

    if (track !== null) {
      mappedItems.push(track);
    }
  }

  return {
    items: mappedItems,
    nextCursor: getNextCursor(page),
  };
}

/** Alias for callers that name the operation as a page fetch. */
export const getPlaylistItemsPage = getPlaylistItems;
