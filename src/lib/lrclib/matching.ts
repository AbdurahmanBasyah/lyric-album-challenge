import type { LrclibTrackRecord } from "./client";
import type { TrackSummary } from "@/types/tracks";

const SMART_APOSTROPHE_PATTERN = /[\u02BC\u2018\u2019]/g;
const REPEATED_WHITESPACE_PATTERN = /\s+/gu;

/** LRCLIB's documented duration tolerance, expressed in milliseconds. */
export const LRCLIB_DURATION_TOLERANCE_MS = 2_000;

export type LrclibMatchReason =
  | "match"
  | "track_mismatch"
  | "artist_mismatch"
  | "duration_mismatch";

export type LrclibMatchResult = Readonly<{
  matched: boolean;
  reason: LrclibMatchReason;
  durationDifferenceMs: number | null;
}>;

/**
 * Canonicalizes metadata for exact provider matching.
 *
 * Compatibility normalization is deliberately limited to NFKC, typographic
 * apostrophe forms, case, and whitespace. Meaningful punctuation, diacritics,
 * and version labels remain part of the identity.
 */
export function normalizeMatchMetadata(value: string): string {
  if (typeof value !== "string") {
    throw new TypeError("Metadata value must be a string");
  }

  return value
    .normalize("NFKC")
    .replace(SMART_APOSTROPHE_PATTERN, "'")
    .toLowerCase()
    .trim()
    .replace(REPEATED_WHITESPACE_PATTERN, " ");
}

function normalizeUnknownMetadata(value: unknown): string {
  return typeof value === "string" ? normalizeMatchMetadata(value) : "";
}

function primaryArtist(track: TrackSummary): string {
  const artistNames = track.artistNames;

  if (!Array.isArray(artistNames)) {
    return "";
  }

  return normalizeUnknownMetadata(artistNames[0]);
}

function durationDifferenceMs(
  spotifyDurationMs: unknown,
  lrclibDurationSeconds: unknown,
): number | null {
  if (
    typeof spotifyDurationMs !== "number" ||
    !Number.isFinite(spotifyDurationMs) ||
    spotifyDurationMs <= 0 ||
    typeof lrclibDurationSeconds !== "number" ||
    !Number.isFinite(lrclibDurationSeconds) ||
    lrclibDurationSeconds <= 0
  ) {
    return null;
  }

  const lrclibDurationMs = lrclibDurationSeconds * 1000;

  if (!Number.isFinite(lrclibDurationMs) || lrclibDurationMs <= 0) {
    return null;
  }

  const difference = Math.abs(spotifyDurationMs - lrclibDurationMs);

  return Number.isFinite(difference) ? difference : null;
}

function createResult(
  reason: LrclibMatchReason,
  durationDifference: number | null,
): LrclibMatchResult {
  return Object.freeze({
    matched: reason === "match",
    reason,
    durationDifferenceMs: durationDifference,
  });
}

/**
 * Evaluates one validated LRCLIB record against one Spotify track summary.
 * Gate ordering is deterministic: title, primary artist, then duration.
 * Album identity is intentionally not part of this match boundary. The
 * title, primary artist, and duration gates are sufficient for this product.
 */
export function matchLrclibTrack(
  spotifyTrack: TrackSummary,
  lrclibTrack: LrclibTrackRecord,
): LrclibMatchResult {
  const durationDifference = durationDifferenceMs(
    spotifyTrack?.durationMs,
    lrclibTrack?.duration,
  );
  const normalizedSpotifyTitle = normalizeUnknownMetadata(spotifyTrack?.name);
  const normalizedLrclibTitle = normalizeUnknownMetadata(lrclibTrack?.trackName);

  if (
    normalizedSpotifyTitle.length === 0 ||
    normalizedLrclibTitle.length === 0 ||
    normalizedSpotifyTitle !== normalizedLrclibTitle
  ) {
    return createResult("track_mismatch", durationDifference);
  }

  const normalizedSpotifyArtist = primaryArtist(spotifyTrack);
  const normalizedLrclibArtist = normalizeUnknownMetadata(
    lrclibTrack?.artistName,
  );

  if (
    normalizedSpotifyArtist.length === 0 ||
    normalizedLrclibArtist.length === 0 ||
    normalizedSpotifyArtist !== normalizedLrclibArtist
  ) {
    return createResult("artist_mismatch", durationDifference);
  }

  if (
    durationDifference === null ||
    durationDifference > LRCLIB_DURATION_TOLERANCE_MS
  ) {
    return createResult("duration_mismatch", durationDifference);
  }

  return createResult("match", durationDifference);
}

/** Descriptive alias for callers that prefer evaluator terminology. */
export const evaluateLrclibMatch = matchLrclibTrack;
