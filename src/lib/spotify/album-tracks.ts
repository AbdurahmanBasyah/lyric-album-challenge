import { z } from "zod";

import type { SpotifyFetch } from "../auth/spotify";
import {
  fetchWithRetry,
  type RetryClock,
  type RetrySleep,
} from "../http/retry";
import type { TrackSummary } from "../../types/tracks";

/**
 * The provider URL is used only by this server-side adapter.  Cursors exposed
 * by the adapter are application-owned offsets, never provider URLs.
 */
export const SPOTIFY_ALBUM_TRACKS_URL =
  "https://api.spotify.com/v1/albums";
export const ALBUM_TRACKS_PAGE_SIZE = 50;

const MAX_SAFE_OFFSET = Number.MAX_SAFE_INTEGER;
const SPOTIFY_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const LRCLIB_MIN_DURATION_MS = 1_000;
const LRCLIB_MAX_DURATION_MS = 3_600_000;

export type SpotifyAlbumTracksErrorKind =
  | "invalid_input"
  | "invalid_cursor"
  | "auth"
  | "rate_limited"
  | "unavailable";

/**
 * Provider failures intentionally collapse to categories.  No response body,
 * URL, schema issue, or exception detail is retained on this error.
 */
export class SpotifyAlbumTracksError extends Error {
  readonly kind: SpotifyAlbumTracksErrorKind;

  constructor(kind: SpotifyAlbumTracksErrorKind) {
    super(
      kind === "invalid_input"
        ? "Spotify album tracks input is invalid."
        : kind === "invalid_cursor"
          ? "Spotify album tracks cursor is invalid."
          : "Spotify album tracks request failed.",
    );
    this.name = "SpotifyAlbumTracksError";
    this.kind = kind;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A provider-neutral, single-page album-track result. */
export type SpotifyAlbumTracksPage = Readonly<{
  items: readonly TrackSummary[];
  nextCursor: string | null;
}>;

export type SpotifyAlbumTracksRequestDependencies = Readonly<{
  fetch?: SpotifyFetch;
  sleep?: RetrySleep;
  now?: RetryClock;
}>;

/**
 * Named request form for callers that prefer not to rely on positional
 * arguments.  The positional overload below follows the existing Spotify
 * adapter convention in this repository.
 */
export type SpotifyAlbumTracksInput = Readonly<{
  accessToken: string;
  albumId: string;
  albumName: string;
  cursor?: string;
  fetch?: SpotifyFetch;
  sleep?: RetrySleep;
  now?: RetryClock;
  dependencies?: SpotifyAlbumTracksRequestDependencies;
}>;

/** Alias for callers that use request terminology. */
export type SpotifyAlbumTracksRequest = SpotifyAlbumTracksInput;

/** Alias for callers that use the shorter domain name. */
export type AlbumTracksPage = SpotifyAlbumTracksPage;

const spotifyIdSchema = z
  .string()
  .trim()
  .min(1)
  .regex(SPOTIFY_ID_PATTERN);

const safeNonNegativeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .refine(Number.isSafeInteger);

const positiveSafeIntegerSchema = z
  .number()
  .int()
  .positive()
  .refine(Number.isSafeInteger);

const spotifyArtistSchema = z
  .object({
    name: z.string().trim().min(1),
  })
  .passthrough();

const spotifyTrackSchema = z
  .object({
    type: z.literal("track").optional(),
    id: spotifyIdSchema,
    name: z.string().trim().min(1),
    artists: z.array(spotifyArtistSchema).min(1),
    duration_ms: safeNonNegativeIntegerSchema,
    track_number: positiveSafeIntegerSchema,
    disc_number: positiveSafeIntegerSchema,
    is_local: z.boolean().nullable().optional(),
    is_playable: z.boolean().nullable().optional(),
  })
  .passthrough();

function isSpotifyApiUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return (
      url.protocol === "https:" &&
      url.hostname === "api.spotify.com" &&
      url.port === "" &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}

const spotifyPaginationUrlSchema = z
  .string()
  .trim()
  .min(1)
  .url()
  .refine(isSpotifyApiUrl);

const spotifyAlbumTracksResponseSchema = z
  .object({
    items: z.array(z.unknown()),
    limit: safeNonNegativeIntegerSchema
      .refine((value) => value > 0)
      .refine((value) => value <= ALBUM_TRACKS_PAGE_SIZE),
    next: z.union([spotifyPaginationUrlSchema, z.null()]),
    offset: safeNonNegativeIntegerSchema,
    total: safeNonNegativeIntegerSchema,
  })
  .passthrough();

type SpotifyAlbumTracksResponse = z.infer<
  typeof spotifyAlbumTracksResponseSchema
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidInput(): never {
  throw new SpotifyAlbumTracksError("invalid_input");
}

function normalizeAlbumId(value: unknown): string {
  if (typeof value !== "string") {
    return invalidInput();
  }

  const normalized = value.trim();

  if (normalized.length === 0 || !SPOTIFY_ID_PATTERN.test(normalized)) {
    return invalidInput();
  }

  return normalized;
}

function normalizeAlbumName(value: unknown): string {
  if (typeof value !== "string") {
    return invalidInput();
  }

  const normalized = value.trim();

  if (normalized.length === 0) {
    return invalidInput();
  }

  return normalized;
}

/**
 * Parses the application's opaque offset cursor.  Only canonical decimal
 * offsets are accepted so that equivalent cursors cannot address different
 * pages or create ambiguous URL requests.
 */
export function parseOffsetCursor(cursor?: string): number {
  if (cursor !== undefined && typeof cursor !== "string") {
    throw new SpotifyAlbumTracksError("invalid_cursor");
  }

  if (cursor === undefined) {
    return 0;
  }

  if (!/^(?:0|[1-9]\d*)$/.test(cursor)) {
    throw new SpotifyAlbumTracksError("invalid_cursor");
  }

  const offset = Number(cursor);

  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > MAX_SAFE_OFFSET
  ) {
    throw new SpotifyAlbumTracksError("invalid_cursor");
  }

  return offset;
}

/** Builds the one-page provider request URL without exposing it to callers. */
export function buildAlbumTracksUrl(albumId: string, cursor?: string): URL {
  const normalizedAlbumId = normalizeAlbumId(albumId);
  const offset = parseOffsetCursor(cursor);
  const url = new URL(
    `${SPOTIFY_ALBUM_TRACKS_URL}/${encodeURIComponent(normalizedAlbumId)}/tracks`,
  );

  url.searchParams.set("limit", String(ALBUM_TRACKS_PAGE_SIZE));
  url.searchParams.set("offset", String(offset));

  return url;
}

// Explicit aliases make the boundary easy to discover without creating a
// second implementation or changing the provider-neutral return shape.
export const buildSpotifyAlbumTracksUrl = buildAlbumTracksUrl;
export const parseAlbumTracksOffsetCursor = parseOffsetCursor;

function classifyProviderResponse(
  response: Response,
): SpotifyAlbumTracksErrorKind {
  if (response.status === 401) {
    return "auth";
  }

  if (response.status === 429) {
    return "rate_limited";
  }

  return "unavailable";
}

function getNextCursor(page: SpotifyAlbumTracksResponse): string | null {
  if (page.next === null) {
    return null;
  }

  let nextOffset: number;
  const providerNextUrl = new URL(page.next);
  const providerOffset = providerNextUrl.searchParams.get("offset");

  if (providerOffset !== null) {
    try {
      nextOffset = parseOffsetCursor(providerOffset);
    } catch {
      throw new SpotifyAlbumTracksError("unavailable");
    }
  } else {
    nextOffset = page.offset + page.items.length;

    if (!Number.isSafeInteger(nextOffset) || nextOffset < 0) {
      throw new SpotifyAlbumTracksError("unavailable");
    }
  }

  return String(nextOffset);
}

function isKnownIneligibleTrack(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return value.is_local === true || value.is_playable === false;
}

function mapTrack(value: unknown): TrackSummary | null {
  // Explicitly ineligible records are allowed to omit otherwise unusable
  // metadata; they never enter the lyric pipeline.
  if (isKnownIneligibleTrack(value)) {
    return null;
  }

  const parsed = spotifyTrackSchema.safeParse(value);

  if (!parsed.success) {
    throw new SpotifyAlbumTracksError("unavailable");
  }

  const track = parsed.data;

  if (
    track.duration_ms < LRCLIB_MIN_DURATION_MS ||
    track.duration_ms > LRCLIB_MAX_DURATION_MS
  ) {
    return null;
  }

  return {
    spotifyId: track.id,
    name: track.name,
    artistNames: track.artists.map((artist) => artist.name),
    durationMs: track.duration_ms,
  };
}

type NormalizedAlbumTracksRequest = Readonly<{
  accessToken: string;
  albumId: string;
  albumName: string;
  cursor?: string;
  fetch?: SpotifyFetch;
  sleep?: RetrySleep;
  now?: RetryClock;
}>;

function normalizeRequest(
  inputOrAccessToken: SpotifyAlbumTracksInput | string,
  positionalAlbumId?: string,
  positionalAlbumName?: string,
  positionalCursor?: string,
  positionalDependencies?: SpotifyAlbumTracksRequestDependencies,
): NormalizedAlbumTracksRequest {
  let accessToken: unknown;
  let albumId: unknown;
  let albumName: unknown;
  let cursor: unknown;
  let fetchCandidate: unknown;
  let sleepCandidate: unknown;
  let nowCandidate: unknown;

  if (typeof inputOrAccessToken === "string") {
    accessToken = inputOrAccessToken;
    albumId = positionalAlbumId;
    albumName = positionalAlbumName;
    cursor = positionalCursor;

    if (
      positionalDependencies !== undefined &&
      !isRecord(positionalDependencies)
    ) {
      return invalidInput();
    }

    fetchCandidate = positionalDependencies?.fetch;
    sleepCandidate = positionalDependencies?.sleep;
    nowCandidate = positionalDependencies?.now;
  } else if (
    typeof inputOrAccessToken === "object" &&
    inputOrAccessToken !== null
  ) {
    accessToken = inputOrAccessToken.accessToken;
    albumId = inputOrAccessToken.albumId;
    albumName = inputOrAccessToken.albumName;
    cursor = inputOrAccessToken.cursor;

    if (
      inputOrAccessToken.dependencies !== undefined &&
      !isRecord(inputOrAccessToken.dependencies)
    ) {
      return invalidInput();
    }

    fetchCandidate =
      inputOrAccessToken.fetch ?? inputOrAccessToken.dependencies?.fetch;
    sleepCandidate =
      inputOrAccessToken.sleep ?? inputOrAccessToken.dependencies?.sleep;
    nowCandidate = inputOrAccessToken.now ?? inputOrAccessToken.dependencies?.now;
  } else {
    return invalidInput();
  }

  if (typeof accessToken !== "string" || accessToken.trim().length === 0) {
    return invalidInput();
  }

  const normalizedAlbumId = normalizeAlbumId(albumId);
  const normalizedAlbumName = normalizeAlbumName(albumName);

  if (cursor !== undefined && typeof cursor !== "string") {
    throw new SpotifyAlbumTracksError("invalid_cursor");
  }

  parseOffsetCursor(cursor);

  if (fetchCandidate !== undefined && typeof fetchCandidate !== "function") {
    return invalidInput();
  }

  if (sleepCandidate !== undefined && typeof sleepCandidate !== "function") {
    return invalidInput();
  }

  if (nowCandidate !== undefined && typeof nowCandidate !== "function") {
    return invalidInput();
  }

  const normalizedFetch = fetchCandidate as SpotifyFetch | undefined;

  return {
    accessToken,
    albumId: normalizedAlbumId,
    albumName: normalizedAlbumName,
    ...(cursor === undefined ? {} : { cursor }),
    ...(normalizedFetch === undefined ? {} : { fetch: normalizedFetch }),
    ...(sleepCandidate === undefined
      ? {}
      : { sleep: sleepCandidate as RetrySleep }),
    ...(nowCandidate === undefined ? {} : { now: nowCandidate as RetryClock }),
  };
}

/**
 * Fetches one page of simplified tracks for a selected album.  This function
 * never follows Spotify's `next` URL; callers decide whether and when to ask
 * for another application-owned cursor.
 */
export function getAlbumTracks(
  input: SpotifyAlbumTracksInput,
): Promise<SpotifyAlbumTracksPage>;
export function getAlbumTracks(
  accessToken: string,
  albumId: string,
  albumName: string,
  dependencies?: SpotifyAlbumTracksRequestDependencies,
): Promise<SpotifyAlbumTracksPage>;
export function getAlbumTracks(
  accessToken: string,
  albumId: string,
  albumName: string,
  cursor?: string,
  dependencies?: SpotifyAlbumTracksRequestDependencies,
): Promise<SpotifyAlbumTracksPage>;
export async function getAlbumTracks(
  inputOrAccessToken: SpotifyAlbumTracksInput | string,
  positionalAlbumId?: string,
  positionalAlbumName?: string,
  positionalCursor?: string | SpotifyAlbumTracksRequestDependencies,
  positionalDependencies?: SpotifyAlbumTracksRequestDependencies,
): Promise<SpotifyAlbumTracksPage> {
  let cursor: string | undefined;
  let dependencies = positionalDependencies;

  if (
    positionalCursor !== undefined &&
    typeof positionalCursor === "object" &&
    positionalCursor !== null
  ) {
    cursor = undefined;
    dependencies = positionalCursor;
  } else {
    cursor = positionalCursor;
  }

  const request = normalizeRequest(
    inputOrAccessToken,
    positionalAlbumId,
    positionalAlbumName,
    cursor,
    dependencies,
  );
  const url = buildAlbumTracksUrl(request.albumId, request.cursor);
  let response: Response;

  try {
    response = await fetchWithRetry(
      url.toString(),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${request.accessToken}`,
        },
      },
      {
        fetch: request.fetch,
        sleep: request.sleep,
        now: request.now,
      },
    );
  } catch {
    throw new SpotifyAlbumTracksError("unavailable");
  }

  if (!response.ok) {
    throw new SpotifyAlbumTracksError(classifyProviderResponse(response));
  }

  let rawResponse: unknown;

  try {
    rawResponse = await response.json();
  } catch {
    throw new SpotifyAlbumTracksError("unavailable");
  }

  const parsed = spotifyAlbumTracksResponseSchema.safeParse(rawResponse);

  if (!parsed.success) {
    throw new SpotifyAlbumTracksError("unavailable");
  }

  const page = parsed.data;
  const items: TrackSummary[] = [];

  for (const item of page.items) {
    const mapped = mapTrack(item);

    if (mapped !== null) {
      items.push(mapped);
    }
  }

  return {
    items,
    nextCursor: getNextCursor(page),
  };
}
