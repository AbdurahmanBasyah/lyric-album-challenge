import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { ChallengeGuessFinishedView } from "../../types/challenge";
import {
  buildCelebrationEvents,
  buildCelebrationQueue,
  MIN_STREAK_FOR_CELEBRATION,
  phaseForCelebrationEvent,
} from "./challenge-celebration";

function finished(
  overrides: Partial<ChallengeGuessFinishedView> = {},
): ChallengeGuessFinishedView {
  return {
    result: "solved",
    questionId: "question_12345678",
    attemptsUsed: 1,
    progress: { solved: 4, revealed: 0, totalAnswerTokens: 4 },
    reveal: {
      lines: ["one", "two", "three", "four"],
      trackName: "Track",
      artistNames: ["Artist"],
      startTimestampMs: 0,
    },
    perfect: true,
    streak: 1,
    questionCount: 2,
    completedQuestionCount: 1,
    complete: false,
    ...overrides,
  };
}

describe("challenge celebration queue", () => {
  it("enqueues Perfect first for a first-attempt solve", () => {
    expect(buildCelebrationQueue(finished())).toEqual([
      { kind: "perfect", questionId: "question_12345678" },
    ]);
  });

  it("allows baseline Expert visibility but never treats later attempts as Perfect", () => {
    expect(
      buildCelebrationQueue(
        finished({
          attemptsUsed: 1,
          perfect: true,
          progress: { solved: 4, revealed: 2, totalAnswerTokens: 8 },
        }),
      ),
    ).toEqual([{ kind: "perfect", questionId: "question_12345678" }]);

    expect(
      buildCelebrationQueue(
        finished({ attemptsUsed: 2, perfect: true, streak: 1 }),
      ),
    ).toEqual([]);
  });

  it("enqueues a streak only once the threshold is reached", () => {
    expect(MIN_STREAK_FOR_CELEBRATION).toBe(2);
    expect(buildCelebrationQueue(finished({ perfect: false, streak: 1 }))).toEqual([]);
    expect(buildCelebrationQueue(finished({ perfect: false, streak: 2 }))).toEqual([
      { kind: "streak", questionId: "question_12345678", streak: 2 },
    ]);
  });

  it("keeps Perfect before a simultaneous streak celebration", () => {
    expect(buildCelebrationEvents(finished({ streak: 4 }))).toEqual([
      { kind: "perfect", questionId: "question_12345678" },
      { kind: "streak", questionId: "question_12345678", streak: 4 },
    ]);
  });

  it("maps the queue to one explicit, non-overlapping presentation phase", () => {
    expect(phaseForCelebrationEvent(undefined)).toBe("round-complete");
    expect(
      phaseForCelebrationEvent({
        kind: "perfect",
        questionId: "question_12345678",
      }),
    ).toBe("celebrating-perfect");
    expect(
      phaseForCelebrationEvent({
        kind: "streak",
        questionId: "question_12345678",
        streak: 3,
      }),
    ).toBe("celebrating-streak");
  });

  it("does not celebrate failed answers", () => {
    expect(
      buildCelebrationQueue(
        finished({ result: "failed", attemptsUsed: 4, perfect: false, streak: 0 }),
      ),
    ).toEqual([]);
  });

  it("caps display streaks to the five-song challenge limit", () => {
    expect(buildCelebrationQueue(finished({ perfect: false, streak: 99 }))).toEqual([
      { kind: "streak", questionId: "question_12345678", streak: 5 },
    ]);
  });

  it("uses a non-modal, pointer-transparent accessible layer", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/challenge/challenge-celebration.tsx"),
      "utf8",
    );

    expect(source).toContain("pointer-events-none");
    expect(source).toContain("max-w-[calc(100vw-2rem)]");
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('role="status"');
    expect(source).toContain("useReducedMotion");
    expect(source).toContain("window.setTimeout");
    expect(source).toContain("Perfect. Solved on Expert.");
    expect(source).toContain("Streak:");
    expect(source).toContain("reducedMotionOverride");
    expect(source).toContain("FTL_MOTION");
    expect(source).not.toContain("progress.revealed === 0");
    expect(source).not.toContain('role="dialog"');
    expect(source).not.toContain("aria-modal");
    expect(source).not.toContain("multiplier");
  });
});
