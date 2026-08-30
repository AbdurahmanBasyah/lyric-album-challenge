import type {
  GuessAnswers,
  GuessProgress,
  LyricToken,
  TokenizedLyricWindow,
} from "@/types/game";

import { compareToken } from "./matching";

function assertAnswersRecord(value: GuessAnswers): asserts value is GuessAnswers {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Guess answers must be an object keyed by token ID");
  }
}

function collectTokens(window: TokenizedLyricWindow): LyricToken[] {
  return window.flatMap((line) => line.tokens);
}

function createTokenIndex(window: TokenizedLyricWindow): Map<string, LyricToken> {
  const tokensById = new Map<string, LyricToken>();

  for (const token of collectTokens(window)) {
    if (tokensById.has(token.id)) {
      throw new Error(`Invalid lyric window: duplicate token ID ${token.id}`);
    }

    tokensById.set(token.id, token);
  }

  return tokensById;
}

/**
 * Applies a positional hidden-word guess without mutating the source window
 * or the submitted answers. Only correct answers create new solved tokens;
 * revealed, solved, static, and non-word tokens are never answerable.
 */
export function applyGuess(
  window: TokenizedLyricWindow,
  answers: GuessAnswers,
): GuessProgress {
  assertAnswersRecord(answers);

  const tokensById = createTokenIndex(window);
  const submittedAnswers = new Map<string, string>();

  for (const tokenId of Object.keys(answers)) {
    const token = tokensById.get(tokenId);

    if (token === undefined) {
      throw new Error(`Invalid guess: unknown token ID ${tokenId}`);
    }

    if (!token.isWord || token.state !== "hidden") {
      throw new Error(`Invalid guess: token ${tokenId} is not a hidden word`);
    }

    const answer = answers[tokenId];
    if (typeof answer !== "string") {
      throw new TypeError(`Invalid guess: answer for token ${tokenId} must be a string`);
    }

    submittedAnswers.set(tokenId, answer);
  }

  const newlySolvedTokenIds: string[] = [];
  const incorrectTokenIds: string[] = [];
  const unresolvedTokenIds: string[] = [];

  const nextWindow = window.map((line) => {
    let lineChanged = false;
    const nextTokens = line.tokens.map((token) => {
      if (token.state !== "hidden" || !token.isWord) {
        return token;
      }

      if (!submittedAnswers.has(token.id)) {
        unresolvedTokenIds.push(token.id);
        return token;
      }

      const answer = submittedAnswers.get(token.id);
      const matched = compareToken(token.normalized, answer as string).matched;

      if (!matched) {
        incorrectTokenIds.push(token.id);
        unresolvedTokenIds.push(token.id);
        return token;
      }

      newlySolvedTokenIds.push(token.id);
      lineChanged = true;
      return { ...token, state: "solved" as const };
    });

    return lineChanged ? { ...line, tokens: nextTokens } : line;
  }) as TokenizedLyricWindow;

  return {
    window: nextWindow,
    newlySolvedTokenIds: Object.freeze(newlySolvedTokenIds),
    incorrectTokenIds: Object.freeze(incorrectTokenIds),
    unresolvedTokenIds: Object.freeze(unresolvedTokenIds),
  };
}
