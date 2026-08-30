import type { AttemptNumber, TokenState } from "./game";

/**
 * The presentation-only source identity returned by challenge APIs.  The
 * Spotify ID has already been authorized by the server; displayName is never
 * used for authorization.
 */
export type ChallengeSourceView =
  | Readonly<{
      kind: "album" | "playlist";
      spotifyId: string;
      displayName?: string;
    }>
  | Readonly<{
      /** Anonymous URL-imported playlist; distinct from a library playlist. */
      kind: "public-playlist";
      spotifyId: string;
      displayName?: string;
      canonicalUrl: string;
    }>;

export type ChallengeRenderedToken = Readonly<{
  id: string;
  text: string;
  state: TokenState;
}>;

export type ChallengeRenderedLine = Readonly<{
  timestampMs: number;
  tokens: readonly ChallengeRenderedToken[];
}>;

export type ChallengeProgressView = Readonly<{
  solved: number;
  revealed: number;
  totalAnswerTokens: number;
}>;

/**
 * Presentation-safe score facts. The scoring multiplier remains server
 * internal and is intentionally absent from this DTO.
 */
export type ChallengeSongScoreView = Readonly<{
  questionId: string;
  score: number;
}>;

export type ChallengeScoreView = Readonly<{
  total: number;
  songs: readonly ChallengeSongScoreView[];
}>;

export type ChallengeRevealView = Readonly<{
  lines: readonly string[];
  trackName: string;
  artistNames: readonly string[];
  startTimestampMs: number;
}>;

/**
 * Optional, provider-neutral playback result returned after a question has
 * been revealed. Provider credentials, URLs, timestamps, and resolver
 * metadata never cross this boundary.
 */
export type ChallengePlaybackUnavailableReason =
  | "configuration"
  | "no-candidate"
  | "low-confidence"
  | "rate-limited"
  | "timeout"
  | "unavailable";

export type ChallengePlaybackAvailableView = Readonly<{
  provider: "youtube";
  status: "available";
  videoId: string;
  /**
   * Optional best-effort position derived from the revealed lyric window.
   * This is a bounded server value, not an end boundary or sync guarantee.
   */
  startAtMs: number;
}>;

export type ChallengePlaybackUnavailableView = Readonly<{
  provider: "youtube";
  status: "unavailable";
  reason: ChallengePlaybackUnavailableReason;
}>;

export type ChallengePlaybackView =
  | ChallengePlaybackAvailableView
  | ChallengePlaybackUnavailableView;

export type ChallengePlaybackResponse = Readonly<{
  playback: ChallengePlaybackView;
}>;

export type ChallengeQuestionView = Readonly<{
  id: string;
  attempt: AttemptNumber;
  maxAttempts: 4;
  status: "active" | "solved" | "failed";
  /** Present only while the fourth attempt is active. */
  titleHint?: string;
  lines: readonly ChallengeRenderedLine[];
  hiddenTokenIds: readonly string[];
  progress: ChallengeProgressView;
  reveal?: ChallengeRevealView;
}>;

export type ChallengeView = Readonly<{
  id: string;
  seed: string;
  source: ChallengeSourceView;
  questions: readonly ChallengeQuestionView[];
  questionCount: number;
  completedQuestionCount: number;
  complete: boolean;
  /** Present only for a completed challenge. */
  score?: ChallengeScoreView;
}>;

export type ChallengeApiErrorCode =
  | "AUTH_UNAVAILABLE"
  | "SPOTIFY_AUTH_REQUIRED"
  | "SPOTIFY_SCOPE_REQUIRED"
  | "SPOTIFY_RATE_LIMITED"
  | "SPOTIFY_UNAVAILABLE"
  | "SOURCE_NOT_IN_LIBRARY"
  | "SOURCE_INACCESSIBLE"
  | "LYRICS_RATE_LIMITED"
  | "LYRICS_PROVIDER_UNAVAILABLE"
  | "INSUFFICIENT_LYRICS"
  | "INVALID_INPUT"
  | "INVALID_GUESS"
  | "CHALLENGE_NOT_FOUND"
  | "QUESTION_NOT_ACTIVE";

export type ChallengeGuessContinueView = Readonly<{
  result: "continue";
  questionId: string;
  attempt: AttemptNumber;
  maxAttempts: 4;
  status: "active";
  /** Present only while the fourth attempt is active. */
  titleHint?: string;
  progress: ChallengeProgressView;
  lines: readonly ChallengeRenderedLine[];
  hiddenTokenIds: readonly string[];
  questionCount: number;
  completedQuestionCount: number;
  complete: boolean;
}>;

export type ChallengeGuessFinishedView = Readonly<{
  result: "solved" | "failed";
  questionId: string;
  attemptsUsed: AttemptNumber;
  progress: ChallengeProgressView;
  reveal: ChallengeRevealView;
  /** Safe celebration facts; no numeric multiplier crosses this boundary. */
  perfect: boolean;
  streak: number;
  questionCount: number;
  completedQuestionCount: number;
  complete: boolean;
}>;

export type ChallengeGuessView =
  | ChallengeGuessContinueView
  | ChallengeGuessFinishedView;
