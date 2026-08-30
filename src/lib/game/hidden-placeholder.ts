/**
 * Keep the browser representation of a hidden word bounded. Lyric source
 * lines are already bounded at the challenge boundary, and this limit keeps
 * a malformed or unexpectedly long token from creating an unbounded DTO.
 */
export const MAX_HIDDEN_PLACEHOLDER_LENGTH = 4_096 as const;

/**
 * Derive a presentation-only blank for one lexical lyric token.
 *
 * The caller must provide the lexical token itself; punctuation and whitespace
 * are separate static tokens in the lyric tokenizer. Array.from counts
 * Unicode code points rather than UTF-16 code units, so accented and
 * supplementary characters occupy the same number of blanks as the player
 * sees in the source word. The source word is never returned.
 */
export function getHiddenTokenPlaceholder(value: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("A hidden lexical token must not be empty.");
  }

  const codePointLength = Array.from(value).length;

  if (
    codePointLength === 0 ||
    codePointLength > MAX_HIDDEN_PLACEHOLDER_LENGTH
  ) {
    throw new RangeError("A hidden lexical token is outside the supported length.");
  }

  return "_".repeat(codePointLength);
}
