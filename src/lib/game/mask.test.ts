import { describe, expect, it } from "vitest";

import type {
  AttemptNumber,
  FourLineLyricWindow,
  LyricToken,
  TokenState,
  TokenizedLyricWindow,
} from "@/types/game";

import { tokenizeLyricWindow } from "./tokenize";
import {
  applyRevealForAttempt,
  COMMON_WORD_ANCHORS,
  DEFAULT_REVEAL_CONFIG,
  getRevealTargetCount,
} from "./mask";

function makeWindow(texts: readonly string[]): TokenizedLyricWindow {
  if (texts.length !== 4) {
    throw new Error("A test lyric window must contain exactly four lines");
  }

  const source = texts.map((text, index) => ({
    timestampMs: 1_000 + index * 500,
    text,
  })) as FourLineLyricWindow;

  return tokenizeLyricWindow(source);
}

function wordTokens(window: TokenizedLyricWindow): LyricToken[] {
  return window.flatMap((line) => line.tokens.filter((token) => token.isWord));
}

function revealedWords(window: TokenizedLyricWindow): LyricToken[] {
  return wordTokens(window).filter((token) => token.state === "revealed");
}

function withTokenState(
  window: TokenizedLyricWindow,
  tokenId: string,
  state: TokenState,
): TokenizedLyricWindow {
  return window.map((line) => ({
    ...line,
    tokens: line.tokens.map((token) =>
      token.id === tokenId ? { ...token, state } : token,
    ),
  })) as unknown as TokenizedLyricWindow;
}

function freezeWindow(window: TokenizedLyricWindow): TokenizedLyricWindow {
  return Object.freeze(
    window.map((line) =>
      Object.freeze({
        ...line,
        tokens: Object.freeze(line.tokens.map((token) => Object.freeze({ ...token }))),
      }),
    ),
  ) as unknown as TokenizedLyricWindow;
}

describe("getRevealTargetCount", () => {
  it("uses the corrective cumulative visible targets", () => {
    expect(DEFAULT_REVEAL_CONFIG).toEqual({
      1: 0.4,
      2: 0.55,
      3: 0.7,
      4: 0.8,
    });
    expect(getRevealTargetCount(20, 1)).toBe(8);
    expect(getRevealTargetCount(20, 2)).toBe(11);
    expect(getRevealTargetCount(20, 3)).toBe(14);
    expect(getRevealTargetCount(20, 4)).toBe(16);
  });

  it.each([
    [3, 1, 1],
    [7, 2, 4],
    [8, 2, 4],
    [11, 3, 8],
    [13, 4, 10],
    [17, 4, 14],
  ])("rounds the cumulative ratio for %i words at attempt %i to %i visible words", (wordCount, attempt, expected) => {
    const ratio = ({ 1: 0.4, 2: 0.55, 3: 0.7, 4: 0.8 } as const)[attempt as 1 | 2 | 3 | 4];

    expect(getRevealTargetCount(wordCount, attempt as AttemptNumber)).toBe(
      Math.round(wordCount * ratio),
    );
    expect(getRevealTargetCount(wordCount, attempt as AttemptNumber)).toBe(expected);
  });

  it("keeps a visible anchor in a multi-word window when rounding reaches zero", () => {
    const zeroFirstConfig = { 1: 0, 2: 0, 3: 0, 4: 0 } as const;

    expect(getRevealTargetCount(0, 1, zeroFirstConfig)).toBe(0);
    expect(getRevealTargetCount(1, 1, zeroFirstConfig)).toBe(0);
    expect(getRevealTargetCount(2, 1, zeroFirstConfig)).toBe(1);
    expect(getRevealTargetCount(20, 1, zeroFirstConfig)).toBe(1);
  });

  it("caps a final target so one unresolved word remains when possible", () => {
    const allVisibleConfig = { 1: 1, 2: 1, 3: 1, 4: 1 } as const;

    expect(getRevealTargetCount(1, 4, allVisibleConfig)).toBe(0);
    expect(getRevealTargetCount(2, 4, allVisibleConfig)).toBe(1);
    expect(getRevealTargetCount(20, 4, allVisibleConfig)).toBe(19);
    expect(getRevealTargetCount(0, 4, allVisibleConfig)).toBe(0);
  });

  it("supports a valid custom cumulative curve", () => {
    const config = { 1: 0, 2: 0.5, 3: 0.75, 4: 1 } as const;

    expect(getRevealTargetCount(20, 1, config)).toBe(1);
    expect(getRevealTargetCount(20, 2, config)).toBe(10);
    expect(getRevealTargetCount(20, 3, config)).toBe(15);
    expect(getRevealTargetCount(20, 4, config)).toBe(19);
  });

  it("rejects invalid attempts and reveal configurations", () => {
    const invalidAttempts = [0, 1.5, 5, Number.NaN, "2"];

    for (const attempt of invalidAttempts) {
      expect(() =>
        getRevealTargetCount(20, attempt as AttemptNumber),
      ).toThrow(/invalid attempt number/i);
    }

    expect(() =>
      getRevealTargetCount(20, 1, { 1: 0.2, 2: 0.35, 3: 0.55 } as never),
    ).toThrow(/missing ratio for attempt 4/i);
    expect(() =>
      getRevealTargetCount(20, 1, { 1: -0.1, 2: 0.35, 3: 0.55, 4: 0.75 }),
    ).toThrow(/between 0 and 1/i);
    expect(() =>
      getRevealTargetCount(20, 1, { 1: 0.2, 2: 1.1, 3: 0.55, 4: 0.75 }),
    ).toThrow(/between 0 and 1/i);
    expect(() =>
      getRevealTargetCount(20, 1, { 1: 0.4, 2: 0.3, 3: 0.55, 4: 0.75 }),
    ).toThrow(/non-decreasing/i);
    expect(() =>
      getRevealTargetCount(20, 1, { 1: Number.NaN, 2: 0.35, 3: 0.55, 4: 0.75 }),
    ).toThrow(/between 0 and 1/i);
  });

  it("keeps the default configuration immutable", () => {
    expect(Object.isFrozen(DEFAULT_REVEAL_CONFIG)).toBe(true);
    expect(DEFAULT_REVEAL_CONFIG).toEqual({ 1: 0.4, 2: 0.55, 3: 0.7, 4: 0.8 });
  });
});

describe("applyRevealForAttempt", () => {
  it("reveals exactly eight of twenty words on the expert attempt", () => {
    const window = makeWindow([
      "signal keeps the rhythm moving",
      "silver windows carry distant echoes",
      "midnight colors gather underneath satellites",
      "quiet streets remember every promise",
    ]);

    const result = applyRevealForAttempt(window, 1, "attempt-one");

    expect(revealedWords(result)).toHaveLength(8);
    expect(wordTokens(result).filter((token) => token.state === "hidden")).toHaveLength(12);
  });

  it("prioritizes seeded meaningful anchors across eligible semantic lines", () => {
    const window = makeWindow([
      "the comet crosses in silence",
      "we carry a quiet signal",
      "distant lights follow silver rivers",
      "midnight colors gather underneath satellites",
    ]);

    const result = applyRevealForAttempt(window, 1, "anchor-seed");
    const revealedByLine = result.map((line) =>
      line.tokens.filter((token) => token.state === "revealed"),
    );

    expect(revealedWords(result)).toHaveLength(8);
    for (const line of revealedByLine) {
      expect(
        line.some((token) => token.isWord && !COMMON_WORD_ANCHORS.has(token.normalized)),
      ).toBe(true);
    }
  });

  it("matches the 44-word fairness targets and nominal hidden counts", () => {
    const window = makeWindow([
      "violet lanterns trace a silver skyline above the quiet river tonight",
      "paper windows carry distant signals through our midnight garden after rain",
      "engines hum beneath electric clouds while we remember old promises softly",
      "silver footsteps cross the station and distant echoes return before sunrise",
    ]);
    const expected = [
      [1, 18, 26],
      [2, 24, 20],
      [3, 31, 13],
      [4, 35, 9],
    ] as const;

    for (const [attempt, visible, hidden] of expected) {
      const result = applyRevealForAttempt(window, attempt, "fairness-seed");
      expect(revealedWords(result)).toHaveLength(visible);
      expect(wordTokens(result).filter((token) => token.state === "hidden")).toHaveLength(hidden);
    }
  });

  it("reveals at least one meaningful anchor per eligible line and no more than two", () => {
    const window = makeWindow([
      "violet lanterns trace a silver skyline above the quiet river tonight",
      "paper windows carry distant signals through our midnight garden after rain",
      "engines hum beneath electric clouds while we remember old promises softly",
      "silver footsteps cross the station and distant echoes return before sunrise",
    ]);
    const result = applyRevealForAttempt(window, 1, "anchor-floor-seed", {
      1: 8 / 44,
      2: 8 / 44,
      3: 8 / 44,
      4: 8 / 44,
    });

    for (const line of result) {
      const meaningfulAnchors = line.tokens.filter(
        (token) =>
          token.state === "revealed" &&
          token.isWord &&
          !COMMON_WORD_ANCHORS.has(token.normalized),
      );
      expect(meaningfulAnchors.length).toBeGreaterThanOrEqual(1);
      expect(meaningfulAnchors.length).toBeLessThanOrEqual(2);
    }
  });

  it("progresses cumulatively through all four attempts", () => {
    const window = makeWindow([
      "signal keeps rhythm moving forward",
      "silver windows carry distant echoes",
      "midnight colors gather underneath satellites",
      "quiet streets remember every promise",
    ]);

    const attempt1 = applyRevealForAttempt(window, 1, "progress-seed");
    const attempt2 = applyRevealForAttempt(attempt1, 2, "progress-seed");
    const attempt3 = applyRevealForAttempt(attempt2, 3, "progress-seed");
    const attempt4 = applyRevealForAttempt(attempt3, 4, "progress-seed");

    expect(revealedWords(attempt1)).toHaveLength(8);
    expect(revealedWords(attempt2)).toHaveLength(11);
    expect(revealedWords(attempt3)).toHaveLength(14);
    expect(revealedWords(attempt4)).toHaveLength(16);
    expect(wordTokens(attempt4).filter((token) => token.state === "hidden")).toHaveLength(4);

    const revealedIds = new Set(revealedWords(attempt1).map((token) => token.id));
    expect(revealedWords(attempt2).every((token) => revealedIds.has(token.id) || token.state === "revealed")).toBe(
      true,
    );
  });

  it("preserves solved tokens and never re-hides revealed tokens", () => {
    const window = makeWindow([
      "signal keeps rhythm moving forward",
      "silver windows carry distant echoes",
      "midnight colors gather underneath satellites",
      "quiet streets remember every promise",
    ]);
    const solvedId = wordTokens(window)[0].id;
    const solvedWindow = withTokenState(window, solvedId, "solved");
    const progressed = applyRevealForAttempt(solvedWindow, 4, "state-seed");
    const earlier = applyRevealForAttempt(progressed, 1, "state-seed");

    expect(wordTokens(progressed).find((token) => token.id === solvedId)?.state).toBe("solved");
    expect(earlier).toEqual(progressed);
    expect(
      wordTokens(progressed)
        .filter((token) => token.state === "revealed")
        .every((token) => wordTokens(earlier).some((candidate) => candidate.id === token.id && candidate.state === "revealed")),
    ).toBe(true);
  });

  it("keeps static tokens and token metadata unchanged", () => {
    const window = makeWindow([
      "(signal) keeps, rhythm moving",
      "silver windows carry distant echoes",
      "midnight colors gather underneath satellites",
      "quiet streets remember every promise!",
    ]);
    const beforeMetadata = window.flatMap((line) =>
      line.tokens.map((token) => ({
        id: token.id,
        lineIndex: token.lineIndex,
        tokenIndex: token.tokenIndex,
        raw: token.raw,
        normalized: token.normalized,
        isWord: token.isWord,
      })),
    );
    const staticBefore = wordTokens(window).length;
    const result = applyRevealForAttempt(window, 2, "metadata-seed");
    const afterMetadata = result.flatMap((line) =>
      line.tokens.map((token) => ({
        id: token.id,
        lineIndex: token.lineIndex,
        tokenIndex: token.tokenIndex,
        raw: token.raw,
        normalized: token.normalized,
        isWord: token.isWord,
      })),
    );

    expect(afterMetadata).toEqual(beforeMetadata);
    expect(
      result
        .flatMap((line) => line.tokens)
        .filter((token) => !token.isWord)
        .every((token) => token.state === "static"),
    ).toBe(true);
    expect(wordTokens(result)).toHaveLength(staticBefore);
  });

  it("is deterministic for the same seed and can vary for another seed", () => {
    const window = makeWindow([
      "signal keeps rhythm moving forward",
      "silver windows carry distant echoes",
      "midnight colors gather underneath satellites",
      "quiet streets remember every promise",
    ]);

    const first = applyRevealForAttempt(window, 1, "alpha");
    const second = applyRevealForAttempt(window, 1, "alpha");
    const different = applyRevealForAttempt(window, 1, "beta");

    expect(first).toEqual(second);
    expect(revealedWords(first).map((token) => token.id)).not.toEqual(
      revealedWords(different).map((token) => token.id),
    );
  });

  it("does not mutate or require mutable input", () => {
    const mutableWindow = makeWindow([
      "signal keeps rhythm moving forward",
      "silver windows carry distant echoes",
      "midnight colors gather underneath satellites",
      "quiet streets remember every promise",
    ]);
    const original = structuredClone(mutableWindow);
    applyRevealForAttempt(mutableWindow, 2, "mutation-seed");
    expect(mutableWindow).toEqual(original);

    const frozenWindow = freezeWindow(mutableWindow);
    expect(() => applyRevealForAttempt(frozenWindow, 2, "frozen-seed")).not.toThrow();
  });

  it("handles zero-word and one-word windows without throwing", () => {
    const empty = makeWindow(["", "", "", ""]);
    const oneWord = makeWindow(["only", "", "", ""]);

    expect(applyRevealForAttempt(empty, 1, "empty-seed")).toEqual(empty);
    expect(wordTokens(applyRevealForAttempt(oneWord, 4, "one-seed"))).toEqual([
      expect.objectContaining({ normalized: "only", state: "hidden" }),
    ]);
  });
});
