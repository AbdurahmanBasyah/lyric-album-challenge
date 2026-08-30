/**
 * Replaceable, pure scoring boundary for completed challenge questions.
 *
 * This module intentionally knows only safe progress counts.  It does not
 * accept lyric text, track metadata, playback state, or answer values.
 */

export const MAX_SCORE = 100 as const;
export const MAX_STREAK = 5 as const;

export type SongScoreStatus = "solved" | "failed";

export type SongScoreInput = Readonly<{
  status: SongScoreStatus;
  solved: number;
  revealed: number;
  totalAnswerTokens: number;
  initiallyHiddenAnswerTokens: number;
  /** Zero for a failed song; otherwise the 1-based solved-song streak. */
  streak: number;
}>;

export type ChallengeSongScoreInput = Readonly<
  SongScoreInput & {
    questionId: string;
  }
>;

export type ChallengeSongScore = Readonly<{
  questionId: string;
  score: number;
}>;

export type ChallengeScore = Readonly<{
  total: number;
  songs: readonly ChallengeSongScore[];
}>;

/**
 * The multiplier is deliberately kept inside the scoring boundary.  It is
 * not part of a response/view model and should not be rendered by clients.
 */
function normalizeCount(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.min(Math.floor(value), maximum);
}

function normalizeStreak(value: unknown): number {
  return normalizeCount(value, MAX_STREAK);
}

/**
 * Return the internal multiplier for a solved-song streak position.  Invalid
 * and zero positions are intentionally treated as the no-streak multiplier.
 */
export function getStreakMultiplier(streak: number): number {
  const position = normalizeStreak(streak);

  switch (position) {
    case 2:
      return 1.05;
    case 3:
      return 1.1;
    case 4:
      return 1.15;
    case 5:
      return 1.2;
    case 1:
    case 0:
    default:
      return 1;
  }
}

/** Alias kept explicit for callers that name this as a position mapping. */
export const streakMultiplier = getStreakMultiplier;

function normalizeSongInput(value: unknown): SongScoreInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const input = value as Record<string, unknown>;

  if (input.status !== "solved" && input.status !== "failed") {
    return null;
  }

  const totalAnswerTokens = normalizeCount(input.totalAnswerTokens);
  const initiallyHiddenAnswerTokens = Math.min(
    normalizeCount(input.initiallyHiddenAnswerTokens),
    totalAnswerTokens,
  );
  const solved = Math.min(
    normalizeCount(input.solved),
    totalAnswerTokens,
    initiallyHiddenAnswerTokens,
  );
  const revealed = Math.min(
    normalizeCount(input.revealed),
    Math.max(0, totalAnswerTokens - solved),
  );

  return {
    status: input.status,
    solved,
    revealed,
    totalAnswerTokens,
    initiallyHiddenAnswerTokens,
    streak: input.status === "failed" ? 0 : normalizeStreak(input.streak),
  };
}

/**
 * Calculate one bounded integer song score.
 *
 * Player credit is based only on solved words.  The revealed count is
 * normalized as part of the input invariant but never contributes credit.
 * Consequently baseline and later system hints cannot earn points.
 */
export function calculateSongScore(input: SongScoreInput): number {
  const normalized = normalizeSongInput(input);

  if (
    normalized === null ||
    normalized.initiallyHiddenAnswerTokens <= 0 ||
    normalized.totalAnswerTokens <= 0
  ) {
    return 0;
  }

  const baseScore =
    (MAX_SCORE * normalized.solved) /
    normalized.initiallyHiddenAnswerTokens;
  const weightedScore = baseScore * getStreakMultiplier(normalized.streak);

  if (!Number.isFinite(weightedScore) || weightedScore <= 0) {
    return 0;
  }

  return Math.min(MAX_SCORE, Math.max(0, Math.round(weightedScore)));
}

/** Alias for strategy callers that prefer an imperative verb. */
export const scoreSong = calculateSongScore;

function normalizeSongScores(value: unknown): readonly number[] {
  if (!Array.isArray(value)) {
    return Object.freeze([]);
  }

  const scores = value.map((score) => {
    if (typeof score !== "number" || !Number.isFinite(score)) {
      return 0;
    }

    return Math.min(MAX_SCORE, Math.max(0, Math.round(score)));
  });

  return Object.freeze(scores);
}

/**
 * Average the scores for the actual number of challenge questions.  Empty or
 * malformed score collections safely produce zero rather than NaN.
 */
export function calculateChallengeScore(
  scores: readonly number[],
): number {
  const normalizedScores = normalizeSongScores(scores);

  if (normalizedScores.length === 0) {
    return 0;
  }

  const total = normalizedScores.reduce((sum, score) => sum + score, 0);
  const average = total / normalizedScores.length;

  if (!Number.isFinite(average) || average <= 0) {
    return 0;
  }

  return Math.min(MAX_SCORE, Math.max(0, Math.round(average)));
}

/** Alias for the aggregation name used by result projections. */
export const aggregateChallengeScore = calculateChallengeScore;

/**
 * Score question inputs and return the safe presentation-shaped result.  The
 * caller owns the question IDs; this function does not expose multiplier
 * details or any source/lyric data.
 */
export function calculateChallengeScoreView(
  songs: readonly ChallengeSongScoreInput[],
): ChallengeScore {
  const scoredSongs: ChallengeSongScore[] = [];

  if (Array.isArray(songs)) {
    for (const song of songs) {
      if (
        typeof song !== "object" ||
        song === null ||
        Array.isArray(song) ||
        typeof song.questionId !== "string" ||
        song.questionId.length === 0
      ) {
        continue;
      }

      scoredSongs.push(
        Object.freeze({
          questionId: song.questionId,
          score: calculateSongScore(song),
        }),
      );
    }
  }

  const songsView = Object.freeze(scoredSongs);

  return Object.freeze({
    total: calculateChallengeScore(songsView.map((song) => song.score)),
    songs: songsView,
  });
}

/** Alias kept concise for server-side challenge projections. */
export const scoreChallenge = calculateChallengeScoreView;

