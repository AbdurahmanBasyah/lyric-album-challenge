import type { TrackSummary } from "../../types/tracks";
import {
  YouTubeClientError,
  YouTubeDataApiClient,
  YOUTUBE_MAX_DETAIL_IDS,
  YOUTUBE_MAX_SEARCH_QUERIES,
  type YouTubeFetch,
  type YouTubeSearchCandidate,
} from "./youtube-client";
import {
  youtubeResolutionCache,
  type YouTubeResolutionCache,
} from "./youtube-cache";
import {
  type YouTubeCandidateRejectionReason,
  type YouTubeCandidateScore,
  type YouTubeResolution,
  type YouTubeSourceType,
  type YouTubeVideoCandidate,
  type YouTubeUnavailableReason,
} from "./youtube-types";

export const YOUTUBE_RESOLVER_VERSION = "youtube-resolver-v1";
export const YOUTUBE_HIGH_CONFIDENCE_SCORE = 80;
export const YOUTUBE_MAX_TRACK_NAME_LENGTH = 512;
export const YOUTUBE_MAX_ARTIST_NAMES = 8;
export const YOUTUBE_MAX_ARTIST_NAME_LENGTH = 256;

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const SPOTIFY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const VERSION_KEYWORDS = [
  "live",
  "cover",
  "remix",
  "karaoke",
  "slowed",
  "sped up",
  "nightcore",
  "acoustic",
] as const;

export type YouTubeResolverOptions = Readonly<{
  /** Optional override; production defaults to the server-only env value. */
  apiKey?: unknown;
  fetch?: YouTubeFetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  cache?: YouTubeResolutionCache;
}>;

export type YouTubeResolver = Readonly<{
  resolveTrack(track: TrackSummary): Promise<YouTubeResolution>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function freezeUnavailable(
  reason: YouTubeUnavailableReason,
): YouTubeResolution {
  return Object.freeze({ status: "unavailable" as const, reason });
}

function freezeResolved(
  videoId: string,
  confidence: number,
  durationMs: number,
  durationDifferenceMs: number,
): YouTubeResolution {
  return Object.freeze({
    status: "resolved" as const,
    videoId,
    confidence,
    durationMs,
    durationDifferenceMs,
  });
}

function normalizeTrack(value: unknown): TrackSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const spotifyId = value.spotifyId;
  const name = value.name;
  const artistNames = value.artistNames;
  const durationMs = value.durationMs;

  if (
    typeof spotifyId !== "string" ||
    !SPOTIFY_ID_PATTERN.test(spotifyId.trim()) ||
    typeof name !== "string" ||
    name.trim().length === 0 ||
    name.trim().length > YOUTUBE_MAX_TRACK_NAME_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(name) ||
    !Array.isArray(artistNames) ||
    artistNames.length === 0 ||
    artistNames.length > YOUTUBE_MAX_ARTIST_NAMES ||
    artistNames.some(
      (artistName) =>
        typeof artistName !== "string" ||
        artistName.trim().length === 0 ||
        artistName.trim().length > YOUTUBE_MAX_ARTIST_NAME_LENGTH ||
        CONTROL_CHARACTER_PATTERN.test(artistName),
    ) ||
    typeof durationMs !== "number" ||
    !Number.isSafeInteger(durationMs) ||
    durationMs <= 0 ||
    durationMs > 3_600_000
  ) {
    return null;
  }

  return Object.freeze({
    spotifyId: spotifyId.trim(),
    name: name.trim(),
    artistNames: Object.freeze(
      artistNames.map((artistName) => (artistName as string).trim()),
    ),
    durationMs,
  });
}

/** Stable comparison normalization used by query construction and scoring. */
export function normalizeYouTubeMetadata(value: string): string {
  if (typeof value !== "string") {
    throw new TypeError("YouTube metadata must be a string");
  }

  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function metadataTokens(value: string): readonly string[] {
  const normalized = normalizeYouTubeMetadata(value);
  return normalized.length === 0 ? [] : normalized.split(" ");
}

function uniqueTokens(value: string): readonly string[] {
  return Object.freeze([...new Set(metadataTokens(value))]);
}

function includesPhrase(tokens: readonly string[], phrase: string): boolean {
  const phraseTokens = metadataTokens(phrase);

  if (phraseTokens.length === 0 || phraseTokens.length > tokens.length) {
    return false;
  }

  for (let index = 0; index <= tokens.length - phraseTokens.length; index += 1) {
    if (
      phraseTokens.every((token, phraseIndex) =>
        tokens[index + phraseIndex] === token,
      )
    ) {
      return true;
    }
  }

  return false;
}

function versionLabels(value: string): ReadonlySet<string> {
  const tokens = metadataTokens(value);
  return new Set(
    VERSION_KEYWORDS.filter((keyword) => includesPhrase(tokens, keyword)),
  );
}

function hasVersionMismatch(
  track: TrackSummary,
  candidate: YouTubeVideoCandidate,
): boolean {
  const canonicalLabels = versionLabels(track.name);
  const candidateLabels = versionLabels(candidate.title);

  return [...candidateLabels].some((label) => !canonicalLabels.has(label));
}

function overlapScore(
  expectedValue: string,
  candidateValue: string,
  maximum: number,
): number {
  const expectedTokens = uniqueTokens(expectedValue);
  const candidateTokens = new Set(metadataTokens(candidateValue));

  if (expectedTokens.length === 0 || candidateTokens.size === 0) {
    return 0;
  }

  const matched = expectedTokens.filter((token) => candidateTokens.has(token)).length;
  return Math.round((matched / expectedTokens.length) * maximum);
}

function primaryArtist(track: TrackSummary): string {
  return track.artistNames[0] ?? "";
}

function durationSimilarity(
  trackDurationMs: number,
  candidateDurationMs: number,
): Readonly<{ score: number; differenceMs: number }> | null {
  if (
    !Number.isSafeInteger(trackDurationMs) ||
    trackDurationMs <= 0 ||
    !Number.isSafeInteger(candidateDurationMs) ||
    candidateDurationMs <= 0
  ) {
    return null;
  }

  const differenceMs = Math.abs(trackDurationMs - candidateDurationMs);

  if (differenceMs > 10_000) {
    return null;
  }

  const score =
    differenceMs <= 2_000 ? 30 : differenceMs <= 5_000 ? 20 : 8;

  return { score, differenceMs };
}

function invalidScore(
  rejectionReason: YouTubeCandidateRejectionReason,
  durationDifferenceMs: number | null = null,
): YouTubeCandidateScore {
  return Object.freeze({
    eligible: false,
    score: 0,
    titleScore: 0,
    artistScore: 0,
    durationScore: 0,
    sourceScore: 0,
    durationDifferenceMs,
    rejectionReason,
  });
}

function isSourceType(value: unknown): value is YouTubeSourceType {
  return (
    value === "art_track" ||
    value === "official_audio" ||
    value === "official_lyrics" ||
    value === "official_video" ||
    value === "other"
  );
}

function sourceScore(candidate: YouTubeVideoCandidate): number {
  return candidate.sourceType === "art_track" ||
    candidate.sourceType === "official_audio"
    ? 10
    : 0;
}

/**
 * Scores one provider-private candidate with the locked 35/25/30/10 weights.
 * Title and artist gates must be complete before a score can be eligible.
 */
export function scoreYouTubeCandidate(
  track: TrackSummary,
  candidate: YouTubeVideoCandidate,
): YouTubeCandidateScore {
  if (
    !isRecord(candidate) ||
    typeof candidate.videoId !== "string" ||
    !SPOTIFY_ID_PATTERN.test(candidate.videoId) ||
    typeof candidate.title !== "string" ||
    candidate.title.trim().length === 0 ||
    typeof candidate.channelTitle !== "string" ||
    candidate.channelTitle.trim().length === 0 ||
    typeof candidate.durationMs !== "number" ||
    !Number.isSafeInteger(candidate.durationMs) ||
    typeof candidate.embeddable !== "boolean" ||
    !isSourceType(candidate.sourceType)
  ) {
    return invalidScore("invalid_candidate");
  }

  if (!candidate.embeddable) {
    return invalidScore("not_embeddable");
  }

  if (hasVersionMismatch(track, candidate)) {
    return invalidScore("version_mismatch");
  }

  const titleScore = overlapScore(track.name, candidate.title, 35);

  if (titleScore < 35) {
    return Object.freeze({
      ...invalidScore("title_mismatch"),
      titleScore,
    });
  }

  const artistScore = overlapScore(
    primaryArtist(track),
    `${candidate.title} ${candidate.channelTitle}`,
    25,
  );

  if (artistScore < 25) {
    return Object.freeze({
      ...invalidScore("artist_mismatch"),
      titleScore,
      artistScore,
    });
  }

  const duration = durationSimilarity(track.durationMs, candidate.durationMs);

  if (duration === null) {
    const durationDifferenceMs =
      Number.isSafeInteger(track.durationMs) &&
      Number.isSafeInteger(candidate.durationMs)
        ? Math.abs(track.durationMs - candidate.durationMs)
        : null;

    return Object.freeze({
      ...invalidScore("duration_mismatch", durationDifferenceMs),
      titleScore,
      artistScore,
    });
  }

  const candidateSourceScore = sourceScore(candidate);
  const score =
    titleScore + artistScore + duration.score + candidateSourceScore;

  return Object.freeze({
    eligible: true,
    score,
    titleScore,
    artistScore,
    durationScore: duration.score,
    sourceScore: candidateSourceScore,
    durationDifferenceMs: duration.differenceMs,
  });
}

function inferSourceType(
  track: TrackSummary,
  candidate: YouTubeVideoCandidate,
): YouTubeSourceType {
  const titleTokens = metadataTokens(candidate.title);
  const channelTokens = metadataTokens(candidate.channelTitle);
  const artistTokens = uniqueTokens(primaryArtist(track));
  const channelHasArtist = artistTokens.every((token) =>
    channelTokens.includes(token),
  );

  if (channelHasArtist && channelTokens.includes("topic")) {
    return "art_track";
  }

  if (includesPhrase(titleTokens, "official audio") ||
      includesPhrase(channelTokens, "official audio")) {
    return "official_audio";
  }

  if (includesPhrase(titleTokens, "official lyrics")) {
    return "official_lyrics";
  }

  if (
    includesPhrase(titleTokens, "official music video") ||
    includesPhrase(titleTokens, "official video") ||
    includesPhrase(titleTokens, "music video")
  ) {
    return "official_video";
  }

  return "other";
}

function enrichSourceType(
  track: TrackSummary,
  candidate: YouTubeVideoCandidate,
): YouTubeVideoCandidate {
  return Object.freeze({
    ...candidate,
    sourceType: inferSourceType(track, candidate),
  });
}

function queryPart(value: string): string {
  return value.replace(/\s+/gu, " ").trim().slice(0, 256);
}

/** Returns at most two deterministic search queries for one track. */
export function buildYouTubeSearchQueries(
  track: TrackSummary,
): readonly string[] {
  const artist = primaryArtist(track);
  const first = queryPart(`${artist} ${track.name}`);
  const second = queryPart(`${track.name} ${artist} official audio`);
  const queries = [first, second].filter(
    (query, index, all) => query.length > 0 && all.indexOf(query) === index,
  );

  return Object.freeze(queries.slice(0, YOUTUBE_MAX_SEARCH_QUERIES));
}

function mapClientError(error: YouTubeClientError): YouTubeUnavailableReason {
  switch (error.kind) {
    case "invalid_input":
      return "invalid_input";
    case "configuration":
      return "configuration";
    case "rate_limited":
      return "rate_limited";
    case "timeout":
      return "timeout";
    case "invalid_response":
      return "invalid_response";
    case "forbidden":
    case "unavailable":
      return "unavailable";
  }
}

function normalizedApiKey(value: unknown): Readonly<{
  value: string | null;
  valid: boolean;
}> {
  if (value === undefined || value === null) {
    return { value: null, valid: true };
  }

  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.trim().length > 256 ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return { value: null, valid: false };
  }

  return { value: value.trim(), valid: true };
}

function makeCandidateSortKey(
  candidate: YouTubeVideoCandidate,
  score: YouTubeCandidateScore,
): Readonly<{ candidate: YouTubeVideoCandidate; score: YouTubeCandidateScore }> {
  return { candidate, score };
}

/**
 * Namespaces the process-local cache by resolver version and every lookup
 * field, preventing a Spotify ID collision across metadata revisions.
 */
export function makeYouTubeCacheKey(track: TrackSummary): string {
  const artists = track.artistNames
    .map((artistName) => normalizeYouTubeMetadata(artistName))
    .join("\u0001");

  return [
    YOUTUBE_RESOLVER_VERSION,
    track.spotifyId,
    normalizeYouTubeMetadata(track.name),
    artists,
    String(track.durationMs),
  ].join("\u0000");
}

export class YouTubeCandidateResolver implements YouTubeResolver {
  private readonly apiKey: string | null;
  private readonly configurationValid: boolean;
  private readonly fetchFunction: YouTubeFetch | undefined;
  private readonly timeoutMs: number | undefined;
  private readonly maxResponseBytes: number | undefined;
  private readonly cache: YouTubeResolutionCache;

  constructor(options: YouTubeResolverOptions = {}) {
    const configuredKey =
      options.apiKey !== undefined ? options.apiKey : process.env.YOUTUBE_API_KEY;
    const apiKey = normalizedApiKey(configuredKey);

    this.apiKey = apiKey.value;
    this.configurationValid = apiKey.valid;
    this.fetchFunction = options.fetch;
    this.timeoutMs = options.timeoutMs;
    this.maxResponseBytes = options.maxResponseBytes;
    this.cache = options.cache ?? youtubeResolutionCache;
  }

  private async resolveUncached(
    track: TrackSummary,
  ): Promise<YouTubeResolution> {
    if (!this.configurationValid || this.apiKey === null) {
      return freezeUnavailable("configuration");
    }

    let client: YouTubeDataApiClient;

    try {
      client = new YouTubeDataApiClient({
        apiKey: this.apiKey,
        ...(this.fetchFunction === undefined
          ? {}
          : { fetch: this.fetchFunction }),
        ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
        ...(this.maxResponseBytes === undefined
          ? {}
          : { maxResponseBytes: this.maxResponseBytes }),
      });
    } catch (error) {
      return error instanceof YouTubeClientError
        ? freezeUnavailable(mapClientError(error))
        : freezeUnavailable("configuration");
    }

    const queries = buildYouTubeSearchQueries(track);
    const searchResults: YouTubeSearchCandidate[] = [];
    const seenSearchIds = new Set<string>();

    try {
      for (const query of queries) {
        const results = await client.searchVideos(query);

        for (const result of results) {
          if (seenSearchIds.has(result.videoId)) {
            continue;
          }

          seenSearchIds.add(result.videoId);
          searchResults.push(result);

          if (searchResults.length >= YOUTUBE_MAX_DETAIL_IDS) {
            break;
          }
        }

        if (searchResults.length >= YOUTUBE_MAX_DETAIL_IDS) {
          break;
        }
      }

      if (searchResults.length === 0) {
        return freezeUnavailable("no_candidate");
      }

      const details = await client.getVideoDetails(
        searchResults.map((result) => result.videoId).slice(0, YOUTUBE_MAX_DETAIL_IDS),
      );
      const ranked = details
        .map((candidate) => {
          const enriched = enrichSourceType(track, candidate);
          return makeCandidateSortKey(
            enriched,
            scoreYouTubeCandidate(track, enriched),
          );
        })
        .filter((entry) => entry.score.eligible)
        .sort((left, right) => {
          if (right.score.score !== left.score.score) {
            return right.score.score - left.score.score;
          }

          const leftDuration = left.score.durationDifferenceMs ?? Number.MAX_SAFE_INTEGER;
          const rightDuration = right.score.durationDifferenceMs ?? Number.MAX_SAFE_INTEGER;

          if (leftDuration !== rightDuration) {
            return leftDuration - rightDuration;
          }

          return left.candidate.videoId.localeCompare(right.candidate.videoId);
        });
      const best = ranked[0];

      if (best === undefined) {
        return freezeUnavailable(
          details.length === 0 ? "no_candidate" : "low_confidence",
        );
      }

      if (best.score.score < YOUTUBE_HIGH_CONFIDENCE_SCORE) {
        return freezeUnavailable("low_confidence");
      }

      return freezeResolved(
        best.candidate.videoId,
        best.score.score,
        best.candidate.durationMs,
        best.score.durationDifferenceMs ?? 0,
      );
    } catch (error) {
      if (error instanceof YouTubeClientError) {
        return freezeUnavailable(mapClientError(error));
      }

      return freezeUnavailable("unavailable");
    }
  }

  resolveTrack(track: TrackSummary): Promise<YouTubeResolution> {
    const normalizedTrack = normalizeTrack(track);

    if (normalizedTrack === null) {
      return Promise.resolve(freezeUnavailable("invalid_input"));
    }

    return this.cache.resolve(
      makeYouTubeCacheKey(normalizedTrack),
      () => this.resolveUncached(normalizedTrack),
    );
  }
}

export function createYouTubeResolver(
  options: YouTubeResolverOptions = {},
): YouTubeResolver {
  return new YouTubeCandidateResolver(options);
}

/** Descriptive aliases for future server playback callers. */
export const YouTubeResolverService = YouTubeCandidateResolver;
export const resolveYouTubeTrack = async (
  track: TrackSummary,
  options: YouTubeResolverOptions = {},
): Promise<YouTubeResolution> =>
  new YouTubeCandidateResolver(options).resolveTrack(track);
