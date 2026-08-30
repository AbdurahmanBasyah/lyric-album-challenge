import type {
  FourLineLyricWindow,
  LyricToken,
  TokenizedLyricLine,
  TokenizedLyricWindow,
} from "@/types/game";

const LEXICAL_CHARACTER_PATTERN = /[\p{L}\p{N}\p{M}]/u;
const APOSTROPHE_PATTERN = /['\u2018\u2019]/u;

function isLexicalCharacter(value: string | undefined): boolean {
  return value !== undefined && LEXICAL_CHARACTER_PATTERN.test(value);
}

function isInternalApostrophe(characters: readonly string[], index: number): boolean {
  return (
    isApostrophe(characters[index]) &&
    isLexicalCharacter(characters[index - 1]) &&
    isLexicalCharacter(characters[index + 1])
  );
}

function isApostrophe(value: string | undefined): boolean {
  return value !== undefined && APOSTROPHE_PATTERN.test(value);
}

/**
 * Normalizes a lexical lyric word for positional answer matching.
 * Punctuation is intentionally left intact; tokenization separates it first.
 */
export function normalizeLyricWord(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\u2018\u2019]/g, "'").trim();
}

function createToken(
  raw: string,
  lineIndex: number,
  tokenIndex: number,
  isWord: boolean,
): LyricToken {
  return {
    id: `l${lineIndex}t${tokenIndex}`,
    lineIndex,
    tokenIndex,
    raw,
    normalized: isWord ? normalizeLyricWord(raw) : "",
    isWord,
    state: isWord ? "hidden" : "static",
  };
}

function readWordEnd(characters: readonly string[], start: number): number {
  let end = start + 1;

  while (end < characters.length) {
    if (isLexicalCharacter(characters[end])) {
      end += 1;
      continue;
    }

    if (isInternalApostrophe(characters, end)) {
      end += 1;
      continue;
    }

    break;
  }

  return end;
}

function readStaticEnd(characters: readonly string[], start: number): number {
  let end = start + 1;

  while (end < characters.length && !isLexicalCharacter(characters[end])) {
    end += 1;
  }

  return end;
}

/**
 * Splits one lyric line into lossless lexical-word and static segments.
 * Every segment keeps its source text in `raw`, so joining token raw values
 * reproduces the input line exactly.
 */
export function tokenizeLyricLine(text: string, lineIndex: number): LyricToken[] {
  const characters = Array.from(text);
  const tokens: LyricToken[] = [];
  let cursor = 0;

  while (cursor < characters.length) {
    const isWord = isLexicalCharacter(characters[cursor]);
    const end = isWord
      ? readWordEnd(characters, cursor)
      : readStaticEnd(characters, cursor);
    const raw = characters.slice(cursor, end).join("");

    tokens.push(createToken(raw, lineIndex, tokens.length, isWord));
    cursor = end;
  }

  return tokens;
}

function tokenizeLine(line: FourLineLyricWindow[number], lineIndex: number): TokenizedLyricLine {
  return {
    timestampMs: line.timestampMs,
    lineIndex,
    tokens: tokenizeLyricLine(line.text, lineIndex),
  };
}

export function tokenizeLyricWindow(window: FourLineLyricWindow): TokenizedLyricWindow {
  return [
    tokenizeLine(window[0], 0),
    tokenizeLine(window[1], 1),
    tokenizeLine(window[2], 2),
    tokenizeLine(window[3], 3),
  ];
}
