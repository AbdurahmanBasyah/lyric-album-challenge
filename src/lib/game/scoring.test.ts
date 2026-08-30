import { describe, expect, it } from "vitest";

import {
  calculateChallengeScore,
  calculateChallengeScoreView,
  calculateSongScore,
  getStreakMultiplier,
  MAX_SCORE,
} from "./scoring";

function song(
  overrides: Partial<Parameters<typeof calculateSongScore>[0]> = {},
) {
  return {
    status: "solved" as const,
    solved: 0,
    revealed: 3,
    totalAnswerTokens: 10,
    initiallyHiddenAnswerTokens: 10,
    streak: 1,
    ...overrides,
  };
}

describe("pure challenge scoring", () => {
  it("uses the captured initial denominator and never credits revealed words", () => {
    expect(calculateSongScore(song({ solved: 4, revealed: 6 }))).toBe(40);
    expect(calculateSongScore(song({ solved: 0, revealed: 10 }))).toBe(0);
    expect(
      calculateSongScore(
        song({ solved: 7, revealed: 3, initiallyHiddenAnswerTokens: 7 }),
      ),
    ).toBe(100);
  });

  it("keeps partial credit for a failed song and resets its multiplier", () => {
    expect(
      calculateSongScore(
        song({ status: "failed", solved: 3, revealed: 5, streak: 5 }),
      ),
    ).toBe(30);
  });

  it("maps every approved streak position and clamps beyond the challenge cap", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(getStreakMultiplier)).toEqual([
      1,
      1,
      1.05,
      1.1,
      1.15,
      1.2,
      1.2,
    ]);
  });

  it("applies the internal multiplier and caps each song at 100", () => {
    expect(calculateSongScore(song({ solved: 5, streak: 2 }))).toBe(53);
    expect(calculateSongScore(song({ solved: 9, streak: 5 }))).toBe(MAX_SCORE);
  });

  it("averages the actual question count and rounds the result", () => {
    expect(calculateChallengeScore([100, 50, 0])).toBe(50);
    expect(calculateChallengeScore([100, 99])).toBe(100);
    expect(calculateChallengeScore([1, 2])).toBe(2);
    expect(calculateChallengeScore([])).toBe(0);
  });

  it("returns a safe presentation view without multiplier details", () => {
    const view = calculateChallengeScoreView([
      { ...song({ solved: 5 }), questionId: "question-1" },
      { ...song({ status: "failed", solved: 2 }), questionId: "question-2" },
    ]);

    expect(view).toEqual({
      total: 35,
      songs: [
        { questionId: "question-1", score: 50 },
        { questionId: "question-2", score: 20 },
      ],
    });
    expect(JSON.stringify(view)).not.toContain("multiplier");
  });

  it("safely normalizes invalid counts without NaN, Infinity, negatives, or overflow", () => {
    const invalidInputs = [
      song({ solved: -2 }),
      song({ solved: Number.NaN }),
      song({ solved: Number.POSITIVE_INFINITY }),
      song({ initiallyHiddenAnswerTokens: 0, solved: 3 }),
      song({ initiallyHiddenAnswerTokens: Number.NaN, solved: 3 }),
      song({ totalAnswerTokens: 0, solved: 3 }),
      song({ status: "invalid" as never }),
      null as never,
    ];

    for (const input of invalidInputs) {
      const score = calculateSongScore(input);
      expect(Number.isFinite(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }

    const view = calculateChallengeScoreView([
      { ...song(), questionId: "one" },
      null as never,
      { ...song({ solved: Number.POSITIVE_INFINITY }), questionId: "two" },
    ]);
    expect(Number.isFinite(view.total)).toBe(true);
    expect(view.total).toBeGreaterThanOrEqual(0);
    expect(view.total).toBeLessThanOrEqual(100);
  });
});

