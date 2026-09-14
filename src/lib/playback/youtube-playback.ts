import type {
  ChallengePlaybackResponse,
  ChallengePlaybackUnavailableReason,
  ChallengePlaybackView,
} from "../../types/challenge";
import type { ChallengeQuestionState } from "../challenge/challenge-state";
import { calculatePlaybackStartAtMs } from "./playback-provider";
import {
  YOUTUBE_HIGH_CONFIDENCE_SCORE,
  type YouTubeResolver,
} from "../youtube/youtube-resolver";
import type { YouTubeResolution } from "../youtube/youtube-types";

/** YouTube's canonical opaque video identifier shape. */
export const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/u;

export type ChallengePlaybackResolver = Pick<YouTubeResolver, "resolveTrack">;

type MappedChallengePlaybackView =
  | Readonly<{
      provider: "youtube";
      status: "available";
      videoId: string;
    }>
  | Extract<ChallengePlaybackView, { status: "unavailable" }>;

const PLAYBACK_UNAVAILABLE_REASONS: readonly ChallengePlaybackUnavailableReason[] = [
  "configuration",
  "no-candidate",
  "low-confidence",
  "rate-limited",
  "timeout",
  "unavailable",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlaybackUnavailableReason(
  value: unknown,
): value is ChallengePlaybackUnavailableReason {
  return (
    typeof value === "string" &&
    PLAYBACK_UNAVAILABLE_REASONS.includes(
      value as ChallengePlaybackUnavailableReason,
    )
  );
}

function unavailable(
  reason: ChallengePlaybackUnavailableReason = "unavailable",
): ChallengePlaybackView {
  return Object.freeze({
    provider: "youtube" as const,
    status: "unavailable" as const,
    reason,
  });
}

function mapResolverUnavailableReason(
  reason: unknown,
): ChallengePlaybackUnavailableReason {
  if (isPlaybackUnavailableReason(reason)) {
    return reason;
  }

  // Resolver internals use underscore names; the browser contract uses the
  // readable hyphenated categories.
  if (reason === "no_candidate") {
    return "no-candidate";
  }

  if (reason === "low_confidence") {
    return "low-confidence";
  }

  if (reason === "rate_limited") {
    return "rate-limited";
  }

  // These resolver-only details are deliberately collapsed at the playback
  // boundary so provider diagnostics never become a browser contract.
  return "unavailable";
}

/**
 * Reduces provider-private resolver output to the only playback data the
 * browser may receive. Runtime validation remains in place for mocked or
 * future resolver implementations, too.
 */
export function mapYouTubeResolutionToPlayback(
  resolution: unknown,
): MappedChallengePlaybackView {
  if (!isRecord(resolution)) {
    return unavailable();
  }

  if (resolution.status === "unavailable") {
    return unavailable(mapResolverUnavailableReason(resolution.reason));
  }

  if (resolution.status !== "resolved") {
    return unavailable();
  }

  if (
    typeof resolution.videoId !== "string" ||
    !YOUTUBE_VIDEO_ID_PATTERN.test(resolution.videoId)
  ) {
    return unavailable();
  }

  if (
    typeof resolution.confidence !== "number" ||
    !Number.isSafeInteger(resolution.confidence) ||
    resolution.confidence < 0 ||
    resolution.confidence > 100
  ) {
    return unavailable();
  }

  if (resolution.confidence < YOUTUBE_HIGH_CONFIDENCE_SCORE) {
    return unavailable("low-confidence");
  }

  return Object.freeze({
    provider: "youtube" as const,
    status: "available" as const,
    videoId: resolution.videoId,
  });
}

/**
 * Resolves only a server-owned terminal question. The route performs the
 * terminal-state check before calling this helper; keeping the guard here as
 * well prevents accidental resolver calls if another server caller reuses it.
 */
export async function resolveChallengeQuestionPlayback(
  question: Pick<ChallengeQuestionState, "status" | "track"> &
    Partial<Pick<ChallengeQuestionState, "window">>,
  resolver: ChallengePlaybackResolver,
): Promise<ChallengePlaybackResponse> {
  if (question.status === "active") {
    return Object.freeze({ playback: unavailable() });
  }

  let resolution: YouTubeResolution;

  try {
    resolution = await resolver.resolveTrack(question.track);
  } catch {
    // Resolver messages and provider error bodies are intentionally discarded.
    resolution = { status: "unavailable", reason: "unavailable" };
  }

  const playback = mapYouTubeResolutionToPlayback(resolution);

  if (playback.status === "unavailable") {
    return Object.freeze({ playback });
  }

  // The question window is server-owned.  A missing or malformed boundary is
  // treated as optional-provider unavailability rather than guessed from lyric
  // text or a fabricated end timestamp.
  const firstLine = question.window?.[0];
  if (firstLine === undefined) {
    return Object.freeze({ playback: unavailable() });
  }

  let startAtMs: number;
  try {
    startAtMs = calculatePlaybackStartAtMs(firstLine.timestampMs);
  } catch {
    return Object.freeze({ playback: unavailable() });
  }

  return Object.freeze({
    playback: Object.freeze({
      ...playback,
      startAtMs,
    }),
  });
}
