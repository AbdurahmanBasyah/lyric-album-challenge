import type { TrackSummary } from "../../types/tracks";
import { MAX_SOURCE_TRACK_POSITIONS } from "../challenge/source-tracks";
import {
  fetchWithRetry,
  type RetryClock,
  type RetrySleep,
} from "../http/retry";
import {
  parsePublicPlaylistUrl,
  type PublicPlaylistIdentity,
} from "./url";

/**
 * This is the only upstream target of the adapter. Keep the origin and path
 * fixed so neither browser input nor provider payload data can select a URL.
 */
export const SPOTIFY_EMBED_PLAYLIST_BASE_URL = "https://open.spotify.com";
export const SPOTIFY_EMBED_PLAYLIST_PATH = "/embed/playlist";

export const PUBLIC_PLAYLIST_TIMEOUT_MS = 8_000;
export const PUBLIC_PLAYLIST_MAX_RESPONSE_BYTES = 1_048_576;
export const SPOTIFY_EMBED_MAX_HTML_BYTES = PUBLIC_PLAYLIST_MAX_RESPONSE_BYTES;
export const SPOTIFY_EMBED_MAX_NEXT_DATA_BYTES = 512 * 1024;

const MAX_CONFIGURED_HTML_BYTES = 8 * 1024 * 1024;
const MAX_CONFIGURED_NEXT_DATA_BYTES = 4 * 1024 * 1024;
const MAX_TRACK_TEXT_LENGTH = 512;
const MAX_PLAYLIST_NAME_LENGTH = 200;
const MAX_PAYLOAD_SEARCH_DEPTH = 8;
const MAX_PAYLOAD_SEARCH_NODES = 128;
const MAX_QUERY_VARIANTS = 64;
const MIN_LRCLIB_DURATION_MS = 1_000;
const MAX_LRCLIB_DURATION_MS = 3_600_000;
const SPOTIFY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const SPOTIFY_TRACK_URI_PATTERN = /^spotify:track:([A-Za-z0-9_-]{1,128})$/u;
const SPOTIFY_PLAYLIST_URI_PATTERN = /^spotify:playlist:([A-Za-z0-9_-]{1,128})$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

export type PublicPlaylistResolverErrorKind =
  | "invalid_input"
  | "configuration"
  | "private"
  | "not_found"
  | "rate_limited"
  | "unavailable"
  | "invalid_response";

/**
 * Provider errors carry only a stable category. No provider URL, response
 * body, playlist ID, credentials, or exception detail is retained.
 */
export class PublicPlaylistResolverError extends Error {
  readonly kind: PublicPlaylistResolverErrorKind;

  constructor(kind: PublicPlaylistResolverErrorKind) {
    const messages: Readonly<
      Record<PublicPlaylistResolverErrorKind, string>
    > = {
      invalid_input: "Public playlist input is invalid.",
      configuration: "Public playlist provider configuration is invalid.",
      private: "Public playlist is not available.",
      not_found: "Public playlist is not available.",
      rate_limited: "Public playlist provider is rate limited.",
      unavailable: "Public playlist provider is unavailable.",
      invalid_response: "Public playlist provider returned an invalid response.",
    };

    super(messages[kind]);
    this.name = "PublicPlaylistResolverError";
    this.kind = kind;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type PublicPlaylistFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type ResolvedPublicPlaylist = Readonly<{
  /** Safe Spotify identity supplied by the URL parser, not provider output. */
  spotifyId: string;
  canonicalUrl: string;
  /** Provider metadata is optional presentation data. */
  name?: string;
  /** Only valid minimal TrackSummary records survive this boundary. */
  tracks: readonly TrackSummary[];
  /** True when the provider returned more than the bounded source sample. */
  sourceTruncated: boolean;
}>;

export type PublicPlaylistResolver = Readonly<{
  resolvePlaylist(
    input: string | PublicPlaylistIdentity,
  ): Promise<ResolvedPublicPlaylist>;
}>;

export type SpotifyEmbedPlaylistResolverOptions = Readonly<{
  fetch?: PublicPlaylistFetch;
  sleep?: RetrySleep;
  now?: RetryClock;
  timeoutMs?: number;
  maxHtmlBytes?: number;
  maxNextDataBytes?: number;
  /** Backward-compatible name for the bounded HTML response option. */
  maxResponseBytes?: number;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(kind: PublicPlaylistResolverErrorKind): never {
  throw new PublicPlaylistResolverError(kind);
}

function normalizePositiveInteger(
  value: unknown,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined) {
    return fallback;
  }

  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > maximum
  ) {
    return fail("configuration");
  }

  return value;
}

function normalizeIdentity(
  input: string | PublicPlaylistIdentity,
): PublicPlaylistIdentity {
  if (typeof input === "string") {
    try {
      return parsePublicPlaylistUrl(input);
    } catch {
      return fail("invalid_input");
    }
  }

  if (!isRecord(input)) {
    return fail("invalid_input");
  }

  let parsed: PublicPlaylistIdentity;

  try {
    parsed = parsePublicPlaylistUrl(input.canonicalUrl);
  } catch {
    return fail("invalid_input");
  }

  if (
    typeof input.playlistId !== "string" ||
    input.playlistId.trim() !== parsed.playlistId
  ) {
    return fail("invalid_input");
  }

  return parsed;
}

function normalizeText(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.trim().length > MAX_TRACK_TEXT_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return null;
  }

  return value.trim();
}

function readFirstString(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = normalizeText(record[key]);

    if (value !== null) {
      return value;
    }
  }

  return null;
}

function readSafeInteger(
  record: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "number" && Number.isSafeInteger(value)) {
      return value;
    }
  }

  return null;
}

function readArtistNames(record: Record<string, unknown>): readonly string[] {
  const direct = record.artistNames;

  if (Array.isArray(direct)) {
    const names = direct.map(normalizeText);

    if (names.every((name): name is string => name !== null)) {
      return Object.freeze(names);
    }

    return Object.freeze([]);
  }

  const artists = record.artists;

  if (Array.isArray(artists)) {
    const names = artists.map((artist) =>
      typeof artist === "string"
        ? normalizeText(artist)
        : isRecord(artist)
          ? readFirstString(artist, ["name", "title"])
          : null,
    );

    if (names.every((name): name is string => name !== null)) {
      return Object.freeze(names);
    }

    return Object.freeze([]);
  }

  const artist = record.artist;

  if (typeof artist === "string") {
    const name = normalizeText(artist);
    return name === null ? Object.freeze([]) : Object.freeze([name]);
  }

  if (isRecord(artist)) {
    const name = readFirstString(artist, ["name", "title"]);
    return name === null ? Object.freeze([]) : Object.freeze([name]);
  }

  const subtitle = normalizeText(record.subtitle);
  return subtitle === null ? Object.freeze([]) : Object.freeze([subtitle]);
}

/**
 * Normalize one application-shaped record into the existing TrackSummary.
 * Embed-specific aliases are translated by the adapter before this function
 * is called. Returning null intentionally drops incomplete entries.
 */
export function normalizePublicPlaylistTrack(value: unknown): TrackSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const candidate = isRecord(value.track) ? value.track : value;
  const spotifyId = readFirstString(candidate, ["spotifyId", "id"]);
  const name = readFirstString(candidate, ["name", "title", "trackName"]);
  const artistNames = readArtistNames(candidate);
  const durationMs = readSafeInteger(candidate, ["durationMs", "duration_ms"]);
  const isLocal = candidate.is_local;
  const isPlayable = candidate.is_playable;
  const restrictions = candidate.restrictions;

  const optionalBooleansValid =
    (isLocal === undefined || isLocal === null || typeof isLocal === "boolean") &&
    (isPlayable === undefined ||
      isPlayable === null ||
      typeof isPlayable === "boolean");
  const restrictionsValid =
    restrictions === undefined ||
    restrictions === null ||
    isRecord(restrictions);

  if (
    spotifyId === null ||
    !SPOTIFY_ID_PATTERN.test(spotifyId) ||
    name === null ||
    artistNames.length === 0 ||
    durationMs === null ||
    durationMs < MIN_LRCLIB_DURATION_MS ||
    durationMs > MAX_LRCLIB_DURATION_MS ||
    !optionalBooleansValid ||
    !restrictionsValid ||
    isLocal === true ||
    isPlayable === false ||
    (restrictions !== undefined && restrictions !== null)
  ) {
    return null;
  }

  return Object.freeze({
    spotifyId,
    name,
    artistNames: Object.freeze([...artistNames]),
    durationMs,
  });
}

function readSafePlaylistName(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  for (const key of ["name", "title"] as const) {
    const name = normalizeText(value[key]);

    if (name !== null && name.length <= MAX_PLAYLIST_NAME_LENGTH) {
      return name;
    }
  }

  return undefined;
}

function readPresentValue(
  record: Record<string, unknown>,
  keys: readonly string[],
): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key];
    }
  }

  return undefined;
}

function readSpotifyTrackId(record: Record<string, unknown>): string | null {
  for (const key of ["spotifyId", "id"] as const) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      const direct = normalizeText(record[key]);
      return direct !== null && SPOTIFY_ID_PATTERN.test(direct)
        ? direct
        : null;
    }
  }

  const uri = record.uri;

  if (typeof uri !== "string") {
    return null;
  }

  const match = SPOTIFY_TRACK_URI_PATTERN.exec(uri.trim());
  return match?.[1] ?? null;
}

function normalizeEmbedTrack(value: unknown): TrackSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  let candidate = value;

  for (const key of ["track", "item", "trackItem"] as const) {
    if (Object.prototype.hasOwnProperty.call(candidate, key)) {
      const nested = candidate[key];
      candidate = isRecord(nested) ? nested : {};
      break;
    }
  }

  if (isRecord(candidate.data)) {
    candidate = candidate.data;
  }

  const spotifyId = readSpotifyTrackId(candidate);
  const name = readFirstString(candidate, ["name", "title", "trackName"]);
  const artistNames = readArtistNames(candidate);
  const durationMs = readSafeInteger(candidate, [
    "durationMs",
    "duration_ms",
    "duration",
  ]);
  const isLocal = readPresentValue(candidate, ["isLocal", "is_local"]);
  const isPlayable = readPresentValue(candidate, ["isPlayable", "is_playable"]);
  const restrictions = readPresentValue(candidate, ["restrictions"]);
  const restricted = readPresentValue(candidate, ["restricted", "isRestricted"]);

  const restrictionsForNormalization =
    restricted === true
      ? {}
      : restricted === undefined || restricted === null || restricted === false
        ? restrictions
        : restricted;

  return normalizePublicPlaylistTrack({
    spotifyId,
    name,
    artistNames,
    durationMs,
    is_local: isLocal,
    is_playable: isPlayable,
    restrictions: restrictionsForNormalization,
  });
}

function isPlaylistLike(value: Record<string, unknown>): boolean {
  const marker = readPresentValue(value, ["type", "entityType", "kind"]);

  if (marker === "playlist") {
    return true;
  }

  const uri = value.uri;

  if (typeof uri === "string" && SPOTIFY_PLAYLIST_URI_PATTERN.test(uri.trim())) {
    return true;
  }

  return (
    typeof value.id === "string" &&
    (typeof value.name === "string" || typeof value.title === "string")
  );
}

function hasKnownTrackContainer(value: Record<string, unknown>): boolean {
  if (Object.prototype.hasOwnProperty.call(value, "trackList")) {
    return true;
  }

  if (Object.prototype.hasOwnProperty.call(value, "tracks")) {
    return true;
  }

  return (
    Object.prototype.hasOwnProperty.call(value, "items") &&
    isPlaylistLike(value)
  );
}

const PAYLOAD_CONTAINER_KEYS = [
  "props",
  "pageProps",
  "state",
  "data",
  "entity",
  "playlist",
  "payload",
  "result",
  "response",
  "content",
  "dehydratedState",
  "queries",
  "query",
] as const;

function findPlaylistContainer(payload: unknown): Record<string, unknown> | null {
  const queue: Array<{ value: unknown; depth: number }> = [
    { value: payload, depth: 0 },
  ];
  const visited = new Set<object>();
  let visitedCount = 0;

  while (queue.length > 0 && visitedCount < MAX_PAYLOAD_SEARCH_NODES) {
    const current = queue.shift();

    if (current === undefined) {
      break;
    }

    const value = current.value;

    if (!isRecord(value) || visited.has(value)) {
      continue;
    }

    visited.add(value);
    visitedCount += 1;

    if (hasKnownTrackContainer(value)) {
      return value;
    }

    if (current.depth >= MAX_PAYLOAD_SEARCH_DEPTH) {
      continue;
    }

    for (const key of PAYLOAD_CONTAINER_KEYS) {
      const nested = value[key];

      if (isRecord(nested)) {
        queue.push({ value: nested, depth: current.depth + 1 });
      } else if (key === "queries" && Array.isArray(nested)) {
        for (const query of nested.slice(0, MAX_QUERY_VARIANTS)) {
          if (isRecord(query)) {
            queue.push({ value: query, depth: current.depth + 1 });
          }
        }
      }
    }
  }

  return null;
}

function readTrackEntries(
  playlist: Record<string, unknown>,
): readonly unknown[] | null {
  if (Object.prototype.hasOwnProperty.call(playlist, "trackList")) {
    return Array.isArray(playlist.trackList) ? playlist.trackList : null;
  }

  if (Object.prototype.hasOwnProperty.call(playlist, "tracks")) {
    const tracks = playlist.tracks;

    if (Array.isArray(tracks)) {
      return tracks;
    }

    if (isRecord(tracks)) {
      if (Object.prototype.hasOwnProperty.call(tracks, "items")) {
        return Array.isArray(tracks.items) ? tracks.items : null;
      }

      if (Object.prototype.hasOwnProperty.call(tracks, "trackList")) {
        return Array.isArray(tracks.trackList) ? tracks.trackList : null;
      }
    }

    return null;
  }

  if (Object.prototype.hasOwnProperty.call(playlist, "items")) {
    return Array.isArray(playlist.items) ? playlist.items : null;
  }

  const content = playlist.content;

  if (isRecord(content)) {
    if (Object.prototype.hasOwnProperty.call(content, "items")) {
      return Array.isArray(content.items) ? content.items : null;
    }

    if (Object.prototype.hasOwnProperty.call(content, "trackList")) {
      return Array.isArray(content.trackList) ? content.trackList : null;
    }
  }

  return null;
}

function readProviderPlaylistId(
  playlist: Record<string, unknown>,
): string | null | undefined {
  const ids: string[] = [];

  for (const key of ["id", "playlistId"] as const) {
    if (Object.prototype.hasOwnProperty.call(playlist, key)) {
      const value = normalizeText(playlist[key]);

      if (value === null || !SPOTIFY_ID_PATTERN.test(value)) {
        return null;
      }

      ids.push(value);
    }
  }

  const uri = playlist.uri;

  if (uri !== undefined) {
    if (typeof uri !== "string") {
      return null;
    }

    const normalizedUri = uri.trim();
    const uriMatch = SPOTIFY_PLAYLIST_URI_PATTERN.exec(normalizedUri);

    if (uriMatch !== null) {
      ids.push(uriMatch[1]);
    } else if (
      normalizedUri.startsWith("spotify:") ||
      normalizedUri.includes("://")
    ) {
      return null;
    }
  }

  if (new Set(ids).size > 1) {
    return null;
  }

  return ids[0];
}

function validatePlaylistMetadata(
  playlist: Record<string, unknown>,
  identity: PublicPlaylistIdentity,
): void {
  for (const key of ["type", "entityType", "kind"] as const) {
    const marker = playlist[key];

    if (marker !== undefined && marker !== "playlist") {
      return fail("invalid_response");
    }
  }

  for (const key of ["public", "isPublic"] as const) {
    const value = playlist[key];

    if (value !== undefined && value !== null && typeof value !== "boolean") {
      return fail("invalid_response");
    }

    if (value === false) {
      return fail("private");
    }
  }

  const isPlayable = playlist.isPlayable;

  if (
    isPlayable !== undefined &&
    isPlayable !== null &&
    typeof isPlayable !== "boolean"
  ) {
    return fail("invalid_response");
  }

  if (isPlayable === false) {
    return fail("private");
  }

  const returnedId = readProviderPlaylistId(playlist);

  if (returnedId !== undefined && returnedId !== identity.playlistId) {
    return fail("invalid_response");
  }
}

function parsePlaylistPayload(
  payload: unknown,
  identity: PublicPlaylistIdentity,
): ResolvedPublicPlaylist {
  const playlist = findPlaylistContainer(payload);

  if (playlist === null) {
    return fail("invalid_response");
  }

  validatePlaylistMetadata(playlist, identity);

  const entries = readTrackEntries(playlist);

  if (entries === null) {
    return fail("invalid_response");
  }

  const sourceTruncated = entries.length > MAX_SOURCE_TRACK_POSITIONS;
  const tracks: TrackSummary[] = [];
  const seenIds = new Set<string>();

  for (const rawTrack of entries.slice(0, MAX_SOURCE_TRACK_POSITIONS)) {
    const track = normalizeEmbedTrack(rawTrack);

    if (track === null || seenIds.has(track.spotifyId)) {
      continue;
    }

    seenIds.add(track.spotifyId);
    tracks.push(track);
  }

  const name = readSafePlaylistName(playlist);

  return Object.freeze({
    spotifyId: identity.playlistId,
    canonicalUrl: identity.canonicalUrl,
    ...(name === undefined ? {} : { name }),
    tracks: Object.freeze(tracks),
    sourceTruncated,
  });
}

function readHtmlAttribute(tag: string, attributeName: string): string | null {
  const backtick = String.fromCharCode(96);
  const attributePattern = new RegExp(
    "(?:^|\\s)" +
      attributeName +
      "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'=<>"+ backtick + "]+))",
    "iu",
  );
  const match = attributePattern.exec(tag);

  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function decodeJsonHtmlEntities(value: string): string {
  return value.replace(
    /&(?:quot|apos|amp|lt|gt|#(?:39|34)|#x(?:27|22));/giu,
    (entity) => {
      switch (entity.toLowerCase()) {
        case "&quot;":
        case "&#34;":
        case "&#x22;":
          return "\"";
        case "&apos;":
        case "&#39;":
        case "&#x27;":
          return "'";
        case "&amp;":
          return "&";
        case "&lt;":
          return "<";
        case "&gt;":
          return ">";
        default:
          return entity;
      }
    },
  );
}

function extractNextDataJson(html: string, maxBytes: number): string {
  const lowerHtml = html.toLowerCase();
  let cursor = 0;
  let matchCount = 0;
  let payload: string | undefined;

  while (cursor < lowerHtml.length) {
    const scriptStart = lowerHtml.indexOf("<script", cursor);

    if (scriptStart < 0) {
      break;
    }

    const nameEnd = scriptStart + "<script".length;
    const nameFollowing = lowerHtml[nameEnd];

    if (nameFollowing !== undefined && !/[\s/>]/u.test(nameFollowing)) {
      cursor = nameEnd;
      continue;
    }

    const openingEnd = lowerHtml.indexOf(">", nameEnd);

    if (openingEnd < 0) {
      return fail("invalid_response");
    }

    const openingTag = html.slice(scriptStart, openingEnd + 1);
    const id = readHtmlAttribute(openingTag, "id");
    const type = readHtmlAttribute(openingTag, "type");

    if (
      id === "__NEXT_DATA__" &&
      type?.trim().toLowerCase() === "application/json"
    ) {
      matchCount += 1;

      if (matchCount > 1) {
        return fail("invalid_response");
      }

      const contentStart = openingEnd + 1;
      const closingStart = lowerHtml.indexOf("</script", contentStart);

      if (closingStart < 0) {
        return fail("invalid_response");
      }

      const closingEnd = lowerHtml.indexOf(
        ">",
        closingStart + "</script".length,
      );

      if (closingEnd < 0) {
        return fail("invalid_response");
      }

      payload = html.slice(contentStart, closingStart);
      if (new TextEncoder().encode(payload).byteLength > maxBytes) {
        return fail("invalid_response");
      }

      cursor = closingEnd + 1;
      continue;
    }

    cursor = openingEnd + 1;
  }

  if (matchCount !== 1 || payload === undefined) {
    return fail("invalid_response");
  }

  const decoded = decodeJsonHtmlEntities(payload);

  if (new TextEncoder().encode(decoded).byteLength > maxBytes) {
    return fail("invalid_response");
  }

  return decoded;
}

async function readBoundedHtml(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLength = response.headers.get("content-length");

  if (
    contentLength !== null &&
    (!/^(?:0|[1-9]\d*)$/u.test(contentLength) ||
      Number(contentLength) > maxBytes)
  ) {
    return fail("invalid_response");
  }

  if (response.body === null) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const next = await reader.read();

      if (next.done) {
        break;
      }

      totalBytes += next.value.byteLength;

      if (totalBytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Rejection is already deterministic; cancellation is best effort.
        }

        return fail("invalid_response");
      }

      chunks.push(next.value);
    }
  } catch (error) {
    if (error instanceof PublicPlaylistResolverError) {
      throw error;
    }

    return fail("unavailable");
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail("invalid_response");
  }
}

function classifyResponseStatus(status: number): PublicPlaylistResolverErrorKind {
  if (status === 401 || status === 403) {
    return "private";
  }

  if (status === 404) {
    return "not_found";
  }

  if (status === 429) {
    return "rate_limited";
  }

  if (status >= 500) {
    return "unavailable";
  }

  return "invalid_response";
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return fail("invalid_response");
  }
}

/**
 * AbortController is honored by the platform fetch, but the race also keeps
 * this boundary bounded when an injected/test fetch ignores the signal.
 */
function withTimeout<T>(
  operation: Promise<T>,
  controller: AbortController,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      controller.abort();
      reject(new PublicPlaylistResolverError("unavailable"));
    }, timeoutMs);

    operation.then(
      (value) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

/** Server-only resolver for the bounded Spotify Embed HTML contract. */
export class SpotifyEmbedPlaylistResolver implements PublicPlaylistResolver {
  private readonly fetchFunction: PublicPlaylistFetch;
  private readonly sleep: RetrySleep | undefined;
  private readonly now: RetryClock | undefined;
  private readonly timeoutMs: number;
  private readonly maxHtmlBytes: number;
  private readonly maxNextDataBytes: number;

  constructor(options: SpotifyEmbedPlaylistResolverOptions = {}) {
    const fetchFunction = options.fetch ?? globalThis.fetch;

    if (typeof fetchFunction !== "function") {
      throw new PublicPlaylistResolverError("configuration");
    }

    if (options.sleep !== undefined && typeof options.sleep !== "function") {
      throw new PublicPlaylistResolverError("configuration");
    }

    if (options.now !== undefined && typeof options.now !== "function") {
      throw new PublicPlaylistResolverError("configuration");
    }

    if (
      options.maxHtmlBytes !== undefined &&
      options.maxResponseBytes !== undefined &&
      options.maxHtmlBytes !== options.maxResponseBytes
    ) {
      throw new PublicPlaylistResolverError("configuration");
    }

    this.fetchFunction = fetchFunction;
    this.sleep = options.sleep;
    this.now = options.now;
    this.timeoutMs = normalizePositiveInteger(
      options.timeoutMs,
      PUBLIC_PLAYLIST_TIMEOUT_MS,
      60_000,
    );
    this.maxHtmlBytes = normalizePositiveInteger(
      options.maxHtmlBytes ?? options.maxResponseBytes,
      SPOTIFY_EMBED_MAX_HTML_BYTES,
      MAX_CONFIGURED_HTML_BYTES,
    );
    this.maxNextDataBytes = normalizePositiveInteger(
      options.maxNextDataBytes,
      SPOTIFY_EMBED_MAX_NEXT_DATA_BYTES,
      MAX_CONFIGURED_NEXT_DATA_BYTES,
    );

  }

  async resolvePlaylist(
    input: string | PublicPlaylistIdentity,
  ): Promise<ResolvedPublicPlaylist> {
    const identity = normalizeIdentity(input);
    const endpoint = new URL(
      SPOTIFY_EMBED_PLAYLIST_PATH +
        "/" +
        encodeURIComponent(identity.playlistId),
      SPOTIFY_EMBED_PLAYLIST_BASE_URL,
    );
    const controller = new AbortController();

    const operation = (async (): Promise<ResolvedPublicPlaylist> => {
      let response: Response;

      try {
        response = await fetchWithRetry(
          endpoint.toString(),
          {
            method: "GET",
            headers: { Accept: "text/html" },
            credentials: "omit",
            redirect: "error",
            signal: controller.signal,
          },
          {
            fetch: this.fetchFunction,
            sleep: this.sleep,
            now: this.now,
          },
        );
      } catch {
        return fail("unavailable");
      }

      if (!response.ok) {
        return fail(classifyResponseStatus(response.status));
      }

      const html = await readBoundedHtml(response, this.maxHtmlBytes);
      const nextData = extractNextDataJson(html, this.maxNextDataBytes);
      return parsePlaylistPayload(parseJson(nextData), identity);
    })();

    return withTimeout(operation, controller, this.timeoutMs);
  }
}

export function createSpotifyEmbedPlaylistResolver(
  options: SpotifyEmbedPlaylistResolverOptions = {},
): PublicPlaylistResolver {
  return new SpotifyEmbedPlaylistResolver(options);
}

/** Provider-neutral factory retained for the existing anonymous route seam. */
export const createPublicPlaylistResolver = createSpotifyEmbedPlaylistResolver;
