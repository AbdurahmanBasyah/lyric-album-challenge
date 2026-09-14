import type {
  AttemptNumber,
  LyricToken,
  RevealConfig,
  RevealTarget,
  TokenizedLyricWindow,
} from "@/types/game";

import { seededShuffle } from "./seeded-random";

const ATTEMPT_NUMBERS: readonly AttemptNumber[] = [1, 2, 3, 4];

/**
 * The default ratios are cumulative visible-word targets. The corrective
 * gameplay curve intentionally starts at 40% visible (60% masked), then
 * advances to 55%, 70%, and 80% visible (45%, 30%, and 20% masked).
 */
export const DEFAULT_REVEAL_CONFIG: RevealConfig = Object.freeze({
  1: 0.4,
  2: 0.55,
  3: 0.7,
  4: 0.8,
});

/**
 * A small set of low-information words used as early lyric anchors.
 * Content words are still revealed when the target exceeds this group.
 */
export const COMMON_WORD_ANCHORS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "the",
  "i",
  "me",
  "my",
  "mine",
  "you",
  "your",
  "yours",
  "we",
  "us",
  "our",
  "ours",
  "he",
  "him",
  "his",
  "she",
  "her",
  "hers",
  "it",
  "its",
  "they",
  "them",
  "their",
  "theirs",
  "this",
  "that",
  "these",
  "those",
  "and",
  "or",
  "but",
  "if",
  "so",
  "of",
  "to",
  "in",
  "on",
  "at",
  "by",
  "for",
  "from",
  "with",
  "as",
  "into",
  "about",
  "over",
  "under",
  "am",
  "is",
  "are",
  "be",
  "was",
  "were",
  "been",
  "being",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
  "can",
  "could",
  "will",
  "would",
  "should",
  "may",
  "might",
  "must",
  "not",
]);

export function isAttemptNumber(value: unknown): value is AttemptNumber {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= ATTEMPT_NUMBERS[0] &&
    value <= ATTEMPT_NUMBERS[ATTEMPT_NUMBERS.length - 1]
  );
}

function assertAttemptNumber(value: unknown): asserts value is AttemptNumber {
  if (!isAttemptNumber(value)) {
    throw new Error("Invalid attempt number: expected an integer from 1 through 4");
  }
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Validates a reveal curve without changing or normalizing the caller's
 * object. Every attempt entry is required so a partial curve cannot silently
 * fall back to an unintended ratio.
 */
export function validateRevealConfig(config: RevealConfig): RevealConfig {
  if (!isRecord(config)) {
    throw new Error("Invalid reveal config: expected an object");
  }

  let previousRatio = 0;

  for (const attempt of ATTEMPT_NUMBERS) {
    if (!Object.prototype.hasOwnProperty.call(config, attempt)) {
      throw new Error(`Invalid reveal config: missing ratio for attempt ${attempt}`);
    }

    const ratio = config[attempt];

    if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
      throw new Error(`Invalid reveal config: ratio for attempt ${attempt} must be between 0 and 1`);
    }

    if (attempt > 1 && ratio < previousRatio) {
      throw new Error("Invalid reveal config: ratios must be non-decreasing");
    }

    previousRatio = ratio;
  }

  return config;
}

function assertWordCount(totalWordCount: number): void {
  if (!Number.isFinite(totalWordCount) || !Number.isInteger(totalWordCount) || totalWordCount < 0) {
    throw new Error("Invalid word count: expected a finite non-negative integer");
  }
}

/**
 * Calculates a cumulative target using nearest-integer rounding. Before a
 * question is solved or failed, one word remains hidden whenever the window
 * has at least one eligible word. Multi-word windows also retain one visible
 * word even when a low configured ratio would otherwise round down to zero.
 */
export function getRevealTarget(
  totalWordCount: number,
  attempt: AttemptNumber,
  config: RevealConfig = DEFAULT_REVEAL_CONFIG,
): RevealTarget {
  assertAttemptNumber(attempt);
  assertWordCount(totalWordCount);
  const validatedConfig = validateRevealConfig(config);
  const roundedTarget = Math.round(totalWordCount * validatedConfig[attempt]);
  const minimumBeforeCompletion = totalWordCount >= 2 ? 1 : 0;
  const maximumBeforeCompletion = totalWordCount > 0 ? totalWordCount - 1 : 0;

  return Object.freeze({
    totalWordCount,
    targetVisibleWordCount: Math.min(
      Math.max(roundedTarget, minimumBeforeCompletion),
      maximumBeforeCompletion,
    ),
  });
}

export function getRevealTargetCount(
  totalWordCount: number,
  attempt: AttemptNumber,
  config: RevealConfig = DEFAULT_REVEAL_CONFIG,
): number {
  return getRevealTarget(totalWordCount, attempt, config).targetVisibleWordCount;
}

function collectWordTokens(window: TokenizedLyricWindow): LyricToken[] {
  return window.flatMap((line) =>
    line.tokens.filter((token) => token.isWord && token.state !== "static"),
  );
}

/**
 * Build one canonical reveal order for the whole question. The order is
 * independent of token state, so applying it again for Hard/Medium/Easy can
 * only reveal later members of the same seeded plan.
 *
 * A meaningful anchor is approximated conservatively as a lexical word that
 * is not in COMMON_WORD_ANCHORS. We choose up to two per semantic line, in
 * seeded order, then interleave the first anchor from each eligible line
 * before distributing second anchors. Lines without a content word use their
 * first lexical word as a deterministic fallback. Remaining words are
 * seeded after the anchor floor.
 */
function getRevealOrder(
  window: TokenizedLyricWindow,
  seed: string,
): LyricToken[] {
  const lineWords = window.map((line) =>
    line.tokens.filter(
      (token) => token.isWord && token.state !== "static",
    ),
  );
  const preferredByLine: LyricToken[][] = lineWords.map((words, lineIndex) => {
    if (words.length === 0) {
      return [];
    }

    const contentWords = words.filter(
      (token) => !COMMON_WORD_ANCHORS.has(token.normalized),
    );

    if (contentWords.length === 0) {
      // A common-word-only line still gets one playable, deterministic clue.
      return [
        seededShuffle(words, `${seed}:lyric-reveal:fallback:${lineIndex}`)[0],
      ].filter((token): token is LyricToken => token !== undefined);
    }

    return seededShuffle(
      contentWords,
      `${seed}:lyric-reveal:content:${lineIndex}`,
    ).slice(0, 2);
  });

  const preferredIds = new Set<string>();
  const orderedPreferred: LyricToken[] = [];

  for (let rank = 0; rank < 2; rank += 1) {
    for (const line of preferredByLine) {
      const token = line[rank];

      if (token !== undefined && !preferredIds.has(token.id)) {
        preferredIds.add(token.id);
        orderedPreferred.push(token);
      }
    }
  }

  const remaining = seededShuffle(
    collectWordTokens(window).filter((token) => !preferredIds.has(token.id)),
    `${seed}:lyric-reveal:remaining`,
  );

  return [...orderedPreferred, ...remaining];
}

/**
 * Applies a cumulative, deterministic reveal target to a tokenized window.
 * Existing solved/revealed tokens are never hidden again, and source objects
 * are copied only where a hidden token changes state.
 */
export function applyRevealForAttempt(
  window: TokenizedLyricWindow,
  attempt: AttemptNumber,
  seed: string,
  config: RevealConfig = DEFAULT_REVEAL_CONFIG,
): TokenizedLyricWindow {
  assertAttemptNumber(attempt);

  if (typeof seed !== "string") {
    throw new Error("Invalid reveal seed: expected a string");
  }

  const wordTokens = collectWordTokens(window);
  const targetCount = getRevealTargetCount(wordTokens.length, attempt, config);
  const visibleIds = new Set(
    wordTokens
      .filter((token) => token.state === "solved" || token.state === "revealed")
      .map((token) => token.id),
  );
  const additionalCount = Math.max(0, targetCount - visibleIds.size);
  const scheduledIds = new Set(
    getRevealOrder(window, seed)
      .filter((token) => !visibleIds.has(token.id))
      .slice(0, additionalCount)
      .map((token) => token.id),
  );

  return window.map((line) => {
    let lineChanged = false;
    const tokens = line.tokens.map((token) => {
      if (
        !token.isWord ||
        token.state === "static" ||
        token.state === "solved" ||
        token.state === "revealed"
      ) {
        return token;
      }

      if (!scheduledIds.has(token.id)) {
        return token;
      }

      lineChanged = true;
      return { ...token, state: "revealed" as const };
    });

    return lineChanged ? { ...line, tokens } : line;
  }) as TokenizedLyricWindow;
}
