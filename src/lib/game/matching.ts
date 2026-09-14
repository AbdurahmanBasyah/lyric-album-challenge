import type { MatchResult } from "@/types/game";

/**
 * Apostrophe glyphs accepted as formatting variants at the answer boundary.
 * NFKC already folds the fullwidth form, but keeping it here makes the
 * accepted set explicit and covers modifier/quotation glyphs used by lyric
 * sources and mobile keyboards.
 */
const APOSTROPHE_VARIANTS_PATTERN = /['\u2018\u2019\u201a\u201b\u02b9\u02bc\u275b\u275c\uff07]/gu;
const REPEATED_WHITESPACE_PATTERN = /\s+/g;

/**
 * Normalizes one player answer for exact, positional lyric matching.
 *
 * This intentionally keeps meaningful punctuation and diacritics intact. The
 * only punctuation variance accepted by gameplay is apostrophe formatting:
 * apostrophes are optional, so `dont`, `don't`, and curly/modifier variants
 * compare equally. Fuzzy matching belongs behind this seam later.
 */
export function normalizeAnswer(value: string): string {
  if (typeof value !== "string") {
    throw new TypeError("Answer must be a string");
  }

  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(APOSTROPHE_VARIANTS_PATTERN, "")
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
