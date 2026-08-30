import type { MatchResult } from "@/types/game";

const CURLY_APOSTROPHE_PATTERN = /[\u2018\u2019]/g;
const REPEATED_WHITESPACE_PATTERN = /\s+/g;

/**
 * Normalizes one player answer for exact, positional lyric matching.
 *
 * This intentionally keeps meaningful punctuation and diacritics intact. It
 * only applies the canonicalization shared by the lyric tokenizer and the
 * answer input boundary; fuzzy matching belongs behind this seam later.
 */
export function normalizeAnswer(value: string): string {
  if (typeof value !== "string") {
    throw new TypeError("Answer must be a string");
  }

  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(CURLY_APOSTROPHE_PATTERN, "'")
    .trim()
    .replace(REPEATED_WHITESPACE_PATTERN, " ");
}

/**
 * Compares expected and submitted words using normalized exact equality.
 * No submitted value is returned, logged, or otherwise echoed.
 */
export function compareToken(expected: string, actual: string): MatchResult {
  if (typeof expected !== "string") {
    throw new TypeError("Expected token value must be a string");
  }

  return Object.freeze({ matched: normalizeAnswer(expected) === normalizeAnswer(actual) });
}
