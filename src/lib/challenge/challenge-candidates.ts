import type { FourLineLyricWindow, SyncedLyricLine } from "../../types/game";
import type { TrackSummary } from "../../types/tracks";
import { seededShuffle } from "../game/seeded-random";
import {
  collectSourceTracks,
  type ChallengeSource,
  type CollectSourceTracksInput,
  type SourceTrackCollection,
} from "./source-tracks";
import {
  resolveLrclibLyrics,
  type LrclibLyricsResult,
  type LrclibPipelineOptions,
} from "../lrclib/pipeline";
import { parsePublicPlaylistUrl } from "../public-playlist/url";

/** MVP bounds for challenge construction. These are policy limits, not provider limits. */
export const MAX_LYRIC_TRACKS_TO_SCAN = 25;
export const DEFAULT_CHALLENGE_TARGET_COUNT = 5;
export const MIN_CHALLENGE_TARGET_COUNT = 1;
export const MAX_CHALLENGE_TARGET_COUNT = 5;

// Descriptive aliases keep the bounded-work policy easy to discover at call sites.
export const LYRIC_SCAN_LIMIT = MAX_LYRIC_TRACKS_TO_SCAN;
export const MAX_LYRIC_SCAN_TRACKS = MAX_LYRIC_TRACKS_TO_SCAN;
export const CHALLENGE_TARGET_LIMIT = MAX_CHALLENGE_TARGET_COUNT;

const SPOTIFY_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const LYRIC_MISS_REASONS = new Set([
  "not_found",
  "metadata_mismatch",
  "instrumental",
  "no_synced_lyrics",
  "invalid_lrc",
  "insufficient_lines",
  "no_eligible_window",
]);

/** Exactly one quality-approved four-line fragment is exposed per candidate. */
export type ChallengeCandidate = Readonly<{
  track: TrackSummary;
  window: FourLineLyricWindow;
}>;

export type ChallengeCandidateReadyResult = Readonly<{
  status: "ready";
  candidates: readonly ChallengeCandidate[];
  tracksScanned: number;
  sourceTruncated: boolean;
  lyricScanLimitReached: boolean;
}>;

export type ChallengeCandidateInsufficientLyricsResult = Readonly<{
  status: "insufficient_lyrics";
  candidates: readonly [];
  tracksScanned: number;
  sourceTruncated: boolean;
  lyricScanLimitReached: boolean;
}>;

export type ChallengeCandidateResult =
  | ChallengeCandidateReadyResult
  | ChallengeCandidateInsufficientLyricsResult;

export type ChallengeCandidateErrorKind =
  | "invalid_input"
  | "invalid_source"
  | "invalid_token"
  | "invalid_seed"
  | "invalid_target"
  | "invalid_lyrics_options"
  | "invalid_collection"
  | "invalid_lyrics_result";

/**
 * Candidate-boundary errors contain only stable categories. They deliberately
 * retain no source, credential, provider response, cursor, or lyric detail.
 */
export class ChallengeCandidateError extends Error {
  readonly kind: ChallengeCandidateErrorKind;

  constructor(kind: ChallengeCandidateErrorKind) {
    super(
      kind === "invalid_source"
        ? "Challenge candidate source is invalid."
        : kind === "invalid_token"
          ? "Challenge candidate access token is invalid."
          : kind === "invalid_seed"
            ? "Challenge candidate seed is invalid."
            : kind === "invalid_target"
              ? "Challenge candidate target is invalid."
              : kind === "invalid_lyrics_options"
                ? "Challenge candidate lyrics options are invalid."
                : kind === "invalid_collection"
                  ? "Challenge source collection is invalid."
                  : kind === "invalid_lyrics_result"
                    ? "Challenge lyrics result is invalid."
                    : "Challenge candidate input is invalid.",
    );
    this.name = "ChallengeCandidateError";
    this.kind = kind;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type ChallengeSourceCollector = (
  input: CollectSourceTracksInput,
) => Promise<SourceTrackCollection>;

export type ChallengeLyricsResolver = (
  track: TrackSummary,
  options: LrclibPipelineOptions,
) => Promise<LrclibLyricsResult>;

export type ChallengeCandidateDependencies = Readonly<{
  /** Canonical injected source collector used by tests and server callers. */
  collectSourceTracks?: ChallengeSourceCollector;
  /** Alias for callers that prefer the shorter dependency name. */
  sourceCollector?: ChallengeSourceCollector;
  /**
   * Anonymous public-playlist collection seam. It deliberately has no access
   * token argument; the resolver has already performed provider work at the
   * server boundary.
   */
  collectPublicPlaylistTracks?: PublicPlaylistSourceCollector;
  /** Canonical injected LRCLIB pipeline used by tests and server callers. */
  resolveLrclibLyrics?: ChallengeLyricsResolver;
  /** Alias for callers that prefer the shorter dependency name. */
  lyricResolver?: ChallengeLyricsResolver;
}>;

export type PublicPlaylistChallengeSource = Readonly<{
  kind: "public-playlist";
  spotifyId: string;
  displayName?: string;
  canonicalUrl: string;
}>;

export type ChallengeCandidateSource = ChallengeSource | PublicPlaylistChallengeSource;

export type PublicPlaylistSourceCollector = (input: Readonly<{
  source: PublicPlaylistChallengeSource;
}>) => Promise<SourceTrackCollection>;

/**
 * Internal input. `lyricsOptions` is canonical; the option aliases are kept
 * for compatibility with server callers while still requiring one options
 * object and rejecting ambiguous input.
 */
export type ChallengeCandidateInput = Readonly<{
  source: ChallengeCandidateSource;
  accessToken?: string;
  seed: string;
  targetCount?: number;
  lyricsOptions?: LrclibPipelineOptions;
  lrclibOptions?: LrclibPipelineOptions;
  pipelineOptions?: LrclibPipelineOptions;
  options?: LrclibPipelineOptions;
  dependencies?: ChallengeCandidateDependencies;
}>;

type NormalizedRequest = Readonly<{
  source: ChallengeCandidateSource;
  accessToken: string | null;
  seed: string;
  targetCount: number;
  lyricsOptions: LrclibPipelineOptions;
  dependencies: ChallengeCandidateDependencies;
  publicPlaylistCollector: PublicPlaylistSourceCollector | null;
}>;

type CandidateCollection = Readonly<{
  tracks: readonly TrackSummary[];
  sourceTruncated: boolean;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function throwCandidateError(kind: ChallengeCandidateErrorKind): never {
  throw new ChallengeCandidateError(kind);
}

function normalizeSpotifyId(value: unknown, kind: "source" | "track"): string {
  if (typeof value !== "string") {
    return throwCandidateError(kind === "source" ? "invalid_source" : "invalid_collection");
  }

  const normalized = value.trim();

  if (normalized.length === 0 || !SPOTIFY_ID_PATTERN.test(normalized)) {
    return throwCandidateError(kind === "source" ? "invalid_source" : "invalid_collection");
  }

  return normalized;
}

function normalizeSource(value: unknown): ChallengeCandidateSource {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return throwCandidateError("invalid_source");
  }

  const spotifyId = normalizeSpotifyId(value.spotifyId, "source");

  if (value.kind === "album") {
    if (typeof value.name !== "string" || value.name.trim().length === 0) {
      return throwCandidateError("invalid_source");
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

  if (value.kind === "public-playlist") {
    if (typeof value.canonicalUrl !== "string") {
      return throwCandidateError("invalid_source");
    }

    let canonicalUrl: string;

    try {
      const parsed = parsePublicPlaylistUrl(value.canonicalUrl);

      if (parsed.playlistId !== spotifyId) {
        return throwCandidateError("invalid_source");
      }

      canonicalUrl = parsed.canonicalUrl;
    } catch {
      return throwCandidateError("invalid_source");
    }

    if (value.displayName !== undefined) {
      if (
        typeof value.displayName !== "string" ||
        value.displayName.trim().length === 0
      ) {
        return throwCandidateError("invalid_source");
      }
    }

    return Object.freeze({
      kind: "public-playlist" as const,
      spotifyId,
      ...(value.displayName === undefined
        ? {}
        : { displayName: value.displayName.trim() }),
      canonicalUrl,
    });
  }

  return throwCandidateError("invalid_source");
}

function normalizeTarget(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_CHALLENGE_TARGET_COUNT;
  }

  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < MIN_CHALLENGE_TARGET_COUNT ||
    value > MAX_CHALLENGE_TARGET_COUNT
  ) {
    return throwCandidateError("invalid_target");
  }

  return value;
}

function normalizeLyricsOptions(value: unknown): LrclibPipelineOptions {
  if (!isRecord(value)) {
    return throwCandidateError("invalid_lyrics_options");
  }

  const clientIdentifier = value.clientIdentifier;
  const fetchFunction = value.fetch;

  if (
    typeof clientIdentifier !== "string" ||
    clientIdentifier.trim().length === 0 ||
    /[\r\n]/.test(clientIdentifier) ||
    (fetchFunction !== undefined && typeof fetchFunction !== "function")
  ) {
    return throwCandidateError("invalid_lyrics_options");
  }

  return {
    ...value,
    clientIdentifier: clientIdentifier.trim(),
  } as LrclibPipelineOptions;
}

function normalizeDependencies(value: unknown): ChallengeCandidateDependencies {
  if (value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    return throwCandidateError("invalid_input");
  }

  const dependencyNames = [
    "collectSourceTracks",
    "sourceCollector",
    "collectPublicPlaylistTracks",
    "resolveLrclibLyrics",
    "lyricResolver",
  ] as const;

  for (const dependencyName of dependencyNames) {
    const dependency = value[dependencyName];

    if (dependency !== undefined && typeof dependency !== "function") {
      return throwCandidateError("invalid_input");
    }
  }

  if (
    value.collectSourceTracks !== undefined &&
    value.sourceCollector !== undefined
  ) {
    return throwCandidateError("invalid_input");
  }

  if (
    value.collectPublicPlaylistTracks !== undefined &&
    typeof value.collectPublicPlaylistTracks !== "function"
  ) {
    return throwCandidateError("invalid_input");
  }

  if (
    value.resolveLrclibLyrics !== undefined &&
    value.lyricResolver !== undefined
  ) {
    return throwCandidateError("invalid_input");
  }

  return value as ChallengeCandidateDependencies;
}

function extractLyricsOptions(input: Record<string, unknown>): unknown {
  const optionNames = [
    "lyricsOptions",
    "lrclibOptions",
    "pipelineOptions",
    "options",
  ] as const;
  const supplied = optionNames.filter((name) => input[name] !== undefined);

  if (supplied.length !== 1) {
    return throwCandidateError("invalid_lyrics_options");
  }

  return input[supplied[0]];
}

function normalizeRequest(input: unknown): NormalizedRequest {
  if (!isRecord(input)) {
    return throwCandidateError("invalid_input");
  }

  const source = normalizeSource(input.source);
  const accessToken = input.accessToken;
  const isPublicPlaylist = source.kind === "public-playlist";

  if (
    !isPublicPlaylist &&
    (typeof accessToken !== "string" ||
      accessToken.trim().length === 0 ||
      /[\r\n]/.test(accessToken))
  ) {
    return throwCandidateError("invalid_token");
  }

  if (
    isPublicPlaylist &&
    accessToken !== undefined &&
    (typeof accessToken !== "string" ||
      accessToken.trim().length === 0 ||
      /[\r\n]/.test(accessToken))
  ) {
    return throwCandidateError("invalid_token");
  }

  const seed = input.seed;

  if (typeof seed !== "string" || seed.trim().length === 0) {
    return throwCandidateError("invalid_seed");
  }

  const dependencies = normalizeDependencies(input.dependencies);
  const publicPlaylistCollector =
    dependencies.collectPublicPlaylistTracks ?? null;

  if (isPublicPlaylist && publicPlaylistCollector === null) {
    return throwCandidateError("invalid_source");
  }

  if (!isPublicPlaylist && publicPlaylistCollector !== null) {
    return throwCandidateError("invalid_input");
  }

  return {
    source,
    accessToken:
      typeof accessToken === "string" ? accessToken.trim() : null,
    seed: seed.trim(),
    targetCount: normalizeTarget(input.targetCount),
    lyricsOptions: normalizeLyricsOptions(extractLyricsOptions(input)),
    dependencies,
    publicPlaylistCollector,
  };
}

function normalizeTrack(value: unknown): TrackSummary {
  if (!isRecord(value)) {
    return throwCandidateError("invalid_collection");
  }

  const spotifyId = normalizeSpotifyId(value.spotifyId, "track");
  const name = value.name;
  const artistNames = value.artistNames;
  const durationMs = value.durationMs;

  if (
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
    return throwCandidateError("invalid_collection");
  }

  return {
    spotifyId,
    name: name.trim(),
    artistNames: artistNames.map((artistName) => (artistName as string).trim()),
    durationMs,
  };
}

function normalizeCollection(value: unknown): CandidateCollection {
  if (!isRecord(value) || !Array.isArray(value.tracks)) {
    return throwCandidateError("invalid_collection");
  }

  if (
    typeof value.pagesFetched !== "number" ||
    !Number.isSafeInteger(value.pagesFetched) ||
    value.pagesFetched < 0 ||
    typeof value.sourceTruncated !== "boolean"
  ) {
    return throwCandidateError("invalid_collection");
  }

  const seenIds = new Set<string>();
  const tracks: TrackSummary[] = [];

  for (const rawTrack of value.tracks) {
    const track = normalizeTrack(rawTrack);

    if (seenIds.has(track.spotifyId)) {
      continue;
    }

    seenIds.add(track.spotifyId);
    tracks.push(track);
  }

  return {
    tracks: Object.freeze(tracks.map(freezeTrack)),
    sourceTruncated: value.sourceTruncated,
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

function normalizeLine(value: unknown): SyncedLyricLine {
  if (!isRecord(value)) {
    return throwCandidateError("invalid_lyrics_result");
  }

  if (
    typeof value.timestampMs !== "number" ||
    !Number.isSafeInteger(value.timestampMs) ||
    value.timestampMs < 0 ||
    typeof value.text !== "string"
  ) {
    return throwCandidateError("invalid_lyrics_result");
  }

  return {
    timestampMs: value.timestampMs,
    text: value.text,
  };
}

function normalizeWindow(value: unknown): FourLineLyricWindow {
  if (!Array.isArray(value) || value.length !== 4) {
    return throwCandidateError("invalid_lyrics_result");
  }

  return value.map(normalizeLine) as FourLineLyricWindow;
}

function freezeLine(line: SyncedLyricLine): SyncedLyricLine {
  return Object.freeze({
    timestampMs: line.timestampMs,
    text: line.text,
  });
}

function freezeWindow(window: FourLineLyricWindow): FourLineLyricWindow {
  return Object.freeze(window.map(freezeLine)) as unknown as FourLineLyricWindow;
}

function freezeCandidate(
  track: TrackSummary,
  window: FourLineLyricWindow,
): ChallengeCandidate {
  return Object.freeze({
    track: freezeTrack(track),
    window: freezeWindow(window),
  });
}

function isLyricMiss(value: unknown): value is Extract<LrclibLyricsResult, { status: "miss" }> {
  if (!isRecord(value) || value.status !== "miss") {
    return false;
  }

  return typeof value.reason === "string" && LYRIC_MISS_REASONS.has(value.reason);
}

function selectWindow(
  result: LrclibLyricsResult,
  seed: string,
  track: TrackSummary,
): FourLineLyricWindow {
  if (
    !isRecord(result) ||
    result.status !== "eligible" ||
    !Array.isArray(result.candidateWindows) ||
    result.candidateWindows.length === 0
  ) {
    return throwCandidateError("invalid_lyrics_result");
  }

  const windows = result.candidateWindows.map(normalizeWindow);
  const shuffledWindows = seededShuffle(
    windows,
    `${seed}:track:${track.spotifyId}:window`,
  );
  const selected = shuffledWindows[0];

  if (selected === undefined) {
    return throwCandidateError("invalid_lyrics_result");
  }

  return selected;
}

function resolveSourceCollector(
  dependencies: ChallengeCandidateDependencies,
): ChallengeSourceCollector {
  return dependencies.collectSourceTracks ?? dependencies.sourceCollector ?? collectSourceTracks;
}

function resolveLyricsResolver(
  dependencies: ChallengeCandidateDependencies,
): ChallengeLyricsResolver {
  return dependencies.resolveLrclibLyrics ?? dependencies.lyricResolver ?? resolveLrclibLyrics;
}

function freezeResult(
  candidates: readonly ChallengeCandidate[],
  tracksScanned: number,
  sourceTruncated: boolean,
  lyricScanLimitReached: boolean,
): ChallengeCandidateResult {
  const frozenCandidates = Object.freeze([...candidates]);

  if (frozenCandidates.length === 0) {
    return Object.freeze({
      status: "insufficient_lyrics" as const,
      candidates: Object.freeze([]) as readonly [],
      tracksScanned,
      sourceTruncated,
      lyricScanLimitReached,
    });
  }

  return Object.freeze({
    status: "ready" as const,
    candidates: frozenCandidates,
    tracksScanned,
    sourceTruncated,
    lyricScanLimitReached,
  });
}

/**
 * Builds reduced, deterministic candidates from a server-approved source.
 * The caller must verify saved-album membership before exposing this internal
 * boundary to browser input. Playlist accessibility remains the collector's
 * typed responsibility.
 */
export function buildChallengeCandidates(
  input: ChallengeCandidateInput,
): Promise<ChallengeCandidateResult>;
export function buildChallengeCandidates(
  source: ChallengeSource,
  accessToken: string,
  seed: string,
  lyricsOptions: LrclibPipelineOptions,
  targetCount?: number,
  dependencies?: ChallengeCandidateDependencies,
): Promise<ChallengeCandidateResult>;
export async function buildChallengeCandidates(
  inputOrSource: ChallengeCandidateInput | ChallengeSource,
  positionalAccessToken?: string,
  positionalSeed?: string,
  positionalLyricsOptions?: LrclibPipelineOptions,
  positionalTargetCount?: number,
  positionalDependencies?: ChallengeCandidateDependencies,
): Promise<ChallengeCandidateResult> {
  const input =
    isRecord(inputOrSource) &&
    Object.prototype.hasOwnProperty.call(inputOrSource, "source")
      ? inputOrSource
      : {
          source: inputOrSource,
          accessToken: positionalAccessToken,
          seed: positionalSeed,
          lyricsOptions: positionalLyricsOptions,
          targetCount: positionalTargetCount,
          dependencies: positionalDependencies,
        };
  const request = normalizeRequest(input);
  const lyricResolver = resolveLyricsResolver(request.dependencies);
  let collection: CandidateCollection;

  if (request.source.kind === "public-playlist") {
    // Public imports have no access-token path. The collector is required by
    // normalizeRequest and receives only the canonical, server-validated
    // source identity.
    const publicPlaylistCollector = request.publicPlaylistCollector;

    if (publicPlaylistCollector === null) {
      return throwCandidateError("invalid_source");
    }

    collection = normalizeCollection(
      await publicPlaylistCollector({ source: request.source }),
    );
  } else {
    const sourceCollector = resolveSourceCollector(request.dependencies);
    const accessToken = request.accessToken;

    if (accessToken === null) {
      return throwCandidateError("invalid_token");
    }

    collection = normalizeCollection(
      await sourceCollector({
        source: request.source,
        accessToken,
      }),
    );
  }
  const shuffledTracks = seededShuffle(collection.tracks, `${request.seed}:tracks`);
  const candidates: ChallengeCandidate[] = [];
  const tracksToInspect = Math.min(
    shuffledTracks.length,
    MAX_LYRIC_TRACKS_TO_SCAN,
  );
  let tracksScanned = 0;

  for (const track of shuffledTracks.slice(0, tracksToInspect)) {
    tracksScanned += 1;
    const lyrics = await lyricResolver(track, request.lyricsOptions);

    if (isLyricMiss(lyrics)) {
      continue;
    }

    if (!isRecord(lyrics) || lyrics.status !== "eligible") {
      return throwCandidateError("invalid_lyrics_result");
    }

    const selectedWindow = selectWindow(lyrics, request.seed, track);
    candidates.push(freezeCandidate(track, selectedWindow));

    if (candidates.length === request.targetCount) {
      break;
    }
  }

  const lyricScanLimitReached =
    tracksScanned === MAX_LYRIC_TRACKS_TO_SCAN &&
    candidates.length < request.targetCount &&
    shuffledTracks.length > tracksScanned;

  return freezeResult(
    candidates,
    tracksScanned,
    collection.sourceTruncated,
    lyricScanLimitReached,
  );
}

/** Descriptive aliases for callers that use construction or selection terminology. */
export const createChallengeCandidates = buildChallengeCandidates;
export const constructChallengeCandidates = buildChallengeCandidates;
export const selectChallengeCandidates = buildChallengeCandidates;
export const resolveChallengeCandidates = buildChallengeCandidates;
