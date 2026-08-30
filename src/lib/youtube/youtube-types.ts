import type { TrackSummary } from "../../types/tracks";

/** Provider-private source labels used only while ranking candidates. */
export type YouTubeSourceType =
  | "art_track"
  | "official_audio"
  | "official_lyrics"
  | "official_video"
  | "other";

/**
 * The reduced candidate assembled from YouTube search and video details.
 * This type never crosses into a client response or gameplay state.
 */
export type YouTubeVideoCandidate = Readonly<{
  videoId: string;
  title: string;
  channelTitle: string;
  durationMs: number;
  embeddable: boolean;
  licensedContent: boolean | null;
  sourceType: YouTubeSourceType;
}>;

export type YouTubeCandidateRejectionReason =
  | "invalid_candidate"
  | "version_mismatch"
  | "title_mismatch"
  | "artist_mismatch"
  | "duration_mismatch"
  | "not_embeddable";

/** Provider-neutral score details; raw provider text is intentionally absent. */
export type YouTubeCandidateScore = Readonly<{
  eligible: boolean;
  score: number;
  titleScore: number;
  artistScore: number;
  durationScore: number;
  sourceScore: number;
  durationDifferenceMs: number | null;
  rejectionReason?: YouTubeCandidateRejectionReason;
}>;

export type YouTubeUnavailableReason =
  | "invalid_input"
  | "configuration"
  | "rate_limited"
  | "unavailable"
  | "invalid_response"
  | "timeout"
  | "no_candidate"
  | "low_confidence";

/**
 * Reduced resolver output. A resolved value contains only the selected video
 * identity and derivations needed by a future server playback boundary.
 */
export type YouTubeResolution =
  | Readonly<{
      status: "resolved";
      videoId: string;
      confidence: number;
      durationMs: number;
      durationDifferenceMs: number;
    }>
  | Readonly<{
      status: "unavailable";
      reason: YouTubeUnavailableReason;
    }>;

export type YouTubeResolverTrack = TrackSummary;

