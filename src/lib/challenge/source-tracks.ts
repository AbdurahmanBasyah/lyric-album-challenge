import {
  getAlbumTracks,
  SpotifyAlbumTracksError,
  type SpotifyAlbumTracksInput,
  type SpotifyAlbumTracksPage,
} from "../spotify/album-tracks";
import {
  getPlaylistItems,
  SpotifyPlaylistItemsError,
  type SpotifyPlaylistItemsInput,
  type SpotifyPlaylistItemsPage,
} from "../spotify/playlist-items";
import type { TrackSummary } from "../../types/tracks";

/**
 * These are MVP policy limits. They bound provider work; they are not
 * assumptions about the size of a Spotify source.
 */
export const SOURCE_TRACKS_PAGE_SIZE = 50;
export const MAX_SOURCE_TRACK_PAGES = 4;
export const MAX_SOURCE_TRACK_POSITIONS =
  SOURCE_TRACKS_PAGE_SIZE * MAX_SOURCE_TRACK_PAGES;

// Descriptive aliases keep the policy discoverable at call sites and make it
// possible to tune the limits without changing the collection algorithm.
export const SOURCE_TRACK_PAGE_LIMIT = MAX_SOURCE_TRACK_PAGES;
export const SOURCE_TRACK_POSITION_LIMIT = MAX_SOURCE_TRACK_POSITIONS;

const SPOTIFY_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_SAFE_OFFSET = Number.MAX_SAFE_INTEGER;

/** A source already approved by trusted server code. */
export type ChallengeSource =
  | Readonly<{
      kind: "album";
      spotifyId: string;
      name: string;
    }>
  | Readonly<{
      kind: "playlist";
      spotifyId: string;
    }>;

/** The provider-neutral result of bounded source-track collection. */
export type SourceTrackCollection = Readonly<{
  tracks: readonly TrackSummary[];
  pagesFetched: number;
  sourceTruncated: boolean;
}>;

export type SourceTrackCollectionErrorKind =
  | "invalid_input"
  | "invalid_source"
  | "invalid_token"
  | "invalid_page"
  | "pagination_cycle";

/**
 * Collection errors contain only a stable category. In particular, they do
 * not retain cursors, provider URLs, response bodies, or access credentials.
 */
export class SourceTrackCollectionError extends Error {
  readonly kind: SourceTrackCollectionErrorKind;

  constructor(kind: SourceTrackCollectionErrorKind) {
    super(
      kind === "invalid_source"
        ? "Challenge source is invalid."
        : kind === "invalid_token"
          ? "Challenge source access token is invalid."
          : kind === "invalid_page"
            ? "Challenge source page is invalid."
            : kind === "pagination_cycle"
              ? "Challenge source pagination is invalid."
              : "Challenge source input is invalid.",
    );
    this.name = "SourceTrackCollectionError";
    this.kind = kind;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Alias for callers that use the longer challenge-oriented name. */
export const ChallengeSourceCollectionError = SourceTrackCollectionError;

export type AlbumTrackPageLoader = (
  input: SpotifyAlbumTracksInput,
) => Promise<SpotifyAlbumTracksPage>;

export type PlaylistItemPageLoader = (
  input: SpotifyPlaylistItemsInput,
) => Promise<SpotifyPlaylistItemsPage>;

/**
 * Injected page loaders are primarily for tests and future server seams. The
 * `load*Page` names are canonical; the aliases make the adapter dependency
 * explicit for consumers without introducing another implementation.
 */
export type SourceTrackCollectionDependencies = Readonly<{
  loadAlbumPage?: AlbumTrackPageLoader;
  loadPlaylistPage?: PlaylistItemPageLoader;
  albumTracks?: AlbumTrackPageLoader;
  playlistItems?: PlaylistItemPageLoader;
  getAlbumTracks?: AlbumTrackPageLoader;
  getPlaylistItems?: PlaylistItemPageLoader;
}>;

export type CollectSourceTracksInput = Readonly<{
  source: ChallengeSource;
  accessToken: string;
  dependencies?: SourceTrackCollectionDependencies;
  loaders?: SourceTrackCollectionDependencies;
}>;

type SourceTrackPage = Readonly<{
  items: readonly TrackSummary[];
  nextCursor: string | null;
}>;

type NormalizedRequest = Readonly<{
  source: ChallengeSource;
  accessToken: string;
  dependencies: SourceTrackCollectionDependencies;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function throwCollectionError(kind: SourceTrackCollectionErrorKind): never {
  throw new SourceTrackCollectionError(kind);
}

function normalizeSpotifyId(value: unknown): string {
  if (typeof value !== "string") {
    return throwCollectionError("invalid_source");
  }

  const normalized = value.trim();

  if (
    normalized.length === 0 ||
    !SPOTIFY_ID_PATTERN.test(normalized)
  ) {
    return throwCollectionError("invalid_source");
  }

  return normalized;
}

function normalizeSource(value: unknown): ChallengeSource {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return throwCollectionError("invalid_source");
  }

  const spotifyId = normalizeSpotifyId(value.spotifyId);

  if (value.kind === "album") {
    if (typeof value.name !== "string" || value.name.trim().length === 0) {
      return throwCollectionError("invalid_source");
    }

    return Object.freeze({
      kind: "album" as const,
      spotifyId,
      name: value.name.trim(),
    });
  }

  if (value.kind === "playlist") {
    return Object.freeze({
      kind: "playlist" as const,
      spotifyId,
    });
  }

  return throwCollectionError("invalid_source");
}

function normalizeDependencies(value: unknown): SourceTrackCollectionDependencies {
  if (value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    return throwCollectionError("invalid_input");
  }

  const dependencyNames = [
    "loadAlbumPage",
    "loadPlaylistPage",
    "albumTracks",
    "playlistItems",
    "getAlbumTracks",
    "getPlaylistItems",
  ] as const;

  for (const dependencyName of dependencyNames) {
    const dependency = value[dependencyName];

    if (dependency !== undefined && typeof dependency !== "function") {
      return throwCollectionError("invalid_input");
    }
  }

  return value as SourceTrackCollectionDependencies;
}

function normalizeRequest(
  sourceOrInput: ChallengeSource | CollectSourceTracksInput,
  positionalAccessToken?: string,
  positionalDependencies?: SourceTrackCollectionDependencies,
): NormalizedRequest {
  let source: unknown;
  let accessToken: unknown;
  let dependencyValue: unknown;

  if (
    isRecord(sourceOrInput) &&
    !Object.prototype.hasOwnProperty.call(sourceOrInput, "kind") &&
    Object.prototype.hasOwnProperty.call(sourceOrInput, "source") &&
    Object.prototype.hasOwnProperty.call(sourceOrInput, "accessToken")
  ) {
    const requestInput = sourceOrInput as CollectSourceTracksInput;
    source = requestInput.source;
    accessToken = requestInput.accessToken;

    if (
      requestInput.dependencies !== undefined &&
      requestInput.loaders !== undefined
    ) {
      return throwCollectionError("invalid_input");
    }

    dependencyValue =
      requestInput.dependencies ?? requestInput.loaders;
  } else {
    source = sourceOrInput;
    accessToken = positionalAccessToken;
    dependencyValue = positionalDependencies;
  }

  if (typeof accessToken !== "string" || accessToken.trim().length === 0) {
    return throwCollectionError("invalid_token");
  }

  const normalizedSource = normalizeSource(source);

  return {
    source: normalizedSource,
    // Do not retain a whitespace-padded credential in a downstream request.
    accessToken: accessToken.trim(),
    dependencies: normalizeDependencies(dependencyValue),
  };
}

function normalizeCursor(value: unknown): string | null {
  if (value === null) {
    return null;
  }

  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d*)$/.test(value)
  ) {
    return throwCollectionError("invalid_page");
  }

  const numericValue = Number(value);

  if (
    !Number.isSafeInteger(numericValue) ||
    numericValue < 0 ||
    numericValue > MAX_SAFE_OFFSET
  ) {
    return throwCollectionError("invalid_page");
  }

  return value;
}

function normalizeTrack(value: unknown): TrackSummary {
  if (!isRecord(value)) {
    return throwCollectionError("invalid_page");
  }

  const spotifyId = value.spotifyId;
  const name = value.name;
  const artistNames = value.artistNames;
  const durationMs = value.durationMs;

  if (
    typeof spotifyId !== "string" ||
    spotifyId.length === 0 ||
    !SPOTIFY_ID_PATTERN.test(spotifyId) ||
    typeof name !== "string" ||
    name.trim().length === 0 ||
    !Array.isArray(artistNames) ||
    artistNames.length === 0 ||
    artistNames.some(
      (artistName) =>
        typeof artistName !== "string" || artistName.trim().length === 0,
    ) ||
    typeof durationMs !== "number" ||
    !Number.isSafeInteger(durationMs) ||
    durationMs < 0
  ) {
    return throwCollectionError("invalid_page");
  }

  return {
    spotifyId,
    name: name.trim(),
    artistNames: artistNames.map((artistName) => artistName.trim()),
    durationMs,
  };
}

function normalizePage(value: unknown): SourceTrackPage {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return throwCollectionError("invalid_page");
  }

  // M5-01 adapters request 50 provider positions per page. A larger mapped
  // page would break the collector's 200-position bound and is rejected.
  if (value.items.length > SOURCE_TRACKS_PAGE_SIZE) {
    return throwCollectionError("invalid_page");
  }

  return {
    items: value.items.map(normalizeTrack),
    nextCursor: normalizeCursor(value.nextCursor),
  };
}

function freezeTrack(track: TrackSummary): TrackSummary {
  return Object.freeze({
    spotifyId: track.spotifyId,
    name: track.name,
    artistNames: Object.freeze([...track.artistNames]),
    durationMs: track.durationMs,
  });
}

function freezeCollection(
  tracks: readonly TrackSummary[],
  pagesFetched: number,
  sourceTruncated: boolean,
): SourceTrackCollection {
  const frozenTracks = Object.freeze(tracks.map(freezeTrack));

  return Object.freeze({
    tracks: frozenTracks,
    pagesFetched,
    sourceTruncated,
  });
}

function resolveAlbumLoader(
  dependencies: SourceTrackCollectionDependencies,
): AlbumTrackPageLoader {
  return (
    dependencies.loadAlbumPage ??
    dependencies.albumTracks ??
    dependencies.getAlbumTracks ??
    ((input) => getAlbumTracks(input))
  );
}

function resolvePlaylistLoader(
  dependencies: SourceTrackCollectionDependencies,
): PlaylistItemPageLoader {
  return (
    dependencies.loadPlaylistPage ??
    dependencies.playlistItems ??
    dependencies.getPlaylistItems ??
    ((input) => getPlaylistItems(input))
  );
}

/**
 * Collects a bounded source sample using only application-owned cursors.
 *
 * The source must have been authorized by trusted server code before reaching
 * this internal boundary. In particular, an album ID/name from a browser is
 * not evidence that the album is saved in the user's library.
 */
export function collectSourceTracks(
  source: ChallengeSource,
  accessToken: string,
  dependencies?: SourceTrackCollectionDependencies,
): Promise<SourceTrackCollection>;
export function collectSourceTracks(
  input: CollectSourceTracksInput,
): Promise<SourceTrackCollection>;
export async function collectSourceTracks(
  sourceOrInput: ChallengeSource | CollectSourceTracksInput,
  positionalAccessToken?: string,
  positionalDependencies?: SourceTrackCollectionDependencies,
): Promise<SourceTrackCollection> {
  const request = normalizeRequest(
    sourceOrInput,
    positionalAccessToken,
    positionalDependencies,
  );
  const albumLoader = resolveAlbumLoader(request.dependencies);
  const playlistLoader = resolvePlaylistLoader(request.dependencies);
  const seenCursors = new Set<string>(["0"]);
  const seenTrackIds = new Set<string>();
  const tracks: TrackSummary[] = [];
  let cursor: string | undefined;
  let pagesFetched = 0;
  let sourceTruncated = false;

  while (pagesFetched < MAX_SOURCE_TRACK_PAGES) {
    let page: SpotifyAlbumTracksPage | SpotifyPlaylistItemsPage;

    try {
      page =
        request.source.kind === "album"
          ? await albumLoader({
              accessToken: request.accessToken,
              albumId: request.source.spotifyId,
              albumName: request.source.name,
              ...(cursor === undefined ? {} : { cursor }),
            })
          : await playlistLoader({
              accessToken: request.accessToken,
              playlistId: request.source.spotifyId,
              ...(cursor === undefined ? {} : { cursor }),
            });
    } catch (error) {
      // Default Spotify adapters expose only typed, provider-neutral errors.
      // Sanitize unexpected injected/implementation errors so a raw provider
      // body or exception detail cannot cross this boundary.
      if (
        error instanceof SpotifyAlbumTracksError ||
        error instanceof SpotifyPlaylistItemsError
      ) {
        throw error;
      }

      throw new SourceTrackCollectionError("invalid_page");
    }

    const normalizedPage = normalizePage(page);
    pagesFetched += 1;

    for (const track of normalizedPage.items) {
      if (seenTrackIds.has(track.spotifyId)) {
        continue;
      }

      seenTrackIds.add(track.spotifyId);
      tracks.push(track);
    }

    if (normalizedPage.nextCursor === null) {
      break;
    }

    if (seenCursors.has(normalizedPage.nextCursor)) {
      throw new SourceTrackCollectionError("pagination_cycle");
    }

    seenCursors.add(normalizedPage.nextCursor);

    if (pagesFetched === MAX_SOURCE_TRACK_PAGES) {
      sourceTruncated = true;
      break;
    }

    cursor = normalizedPage.nextCursor;
  }

  return freezeCollection(tracks, pagesFetched, sourceTruncated);
}

/** Descriptive alias for callers that name the operation as collection. */
export const collectChallengeSourceTracks = collectSourceTracks;
