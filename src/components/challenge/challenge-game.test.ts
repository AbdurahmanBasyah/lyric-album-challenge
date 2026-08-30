import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type {
  ChallengeGuessFinishedView,
  ChallengeGuessContinueView,
  ChallengeView,
} from "../../types/challenge";
import {
  applyContinueResult,
  findPlayableQuestionIndex,
  getActiveTitleHint,
  getProgressMessage,
} from "./challenge-game";
import { buildCelebrationQueue } from "./challenge-celebration";

function challenge(): ChallengeView {
  const line = (index: number) => ({
    timestampMs: index * 1_000,
    tokens: [{ id: `l${index}t0`, text: "____", state: "hidden" as const }],
  });
  const question = (id: string, status: "active" | "solved") => ({
    id,
    attempt: 1 as const,
    maxAttempts: 4 as const,
    status,
    lines: [line(0), line(1), line(2), line(3)],
    hiddenTokenIds: status === "active" ? ["l0t0", "l1t0", "l2t0", "l3t0"] : [],
    progress: { solved: status === "solved" ? 4 : 0, revealed: 0, totalAnswerTokens: 4 },
    ...(status === "solved"
      ? {
          reveal: {
            lines: ["one", "two", "three", "four"],
            trackName: "Track",
            artistNames: ["Artist"],
            startTimestampMs: 0,
          },
        }
      : {}),
  });

  return {
    id: "challenge_12345678",
    seed: "seed",
    source: { kind: "album", spotifyId: "album_1", displayName: "Album" },
    questions: [question("question_11111111", "solved"), question("question_22222222", "active")],
    questionCount: 2,
    completedQuestionCount: 1,
    complete: false,
  };
}

describe("challenge game state helpers", () => {
  it("selects an active preferred question or the first active fallback", () => {
    const value = challenge();
    expect(findPlayableQuestionIndex(value, 1)).toBe(1);
    expect(findPlayableQuestionIndex(value, 0)).toBe(1);
  });

  it("replaces only the continuing question with the server-rendered view", () => {
    const value = challenge();
    const current = value.questions[1];
    const response: ChallengeGuessContinueView = {
      result: "continue",
      questionId: current.id,
      attempt: 2,
      maxAttempts: 4,
      status: "active",
      progress: { solved: 1, revealed: 1, totalAnswerTokens: 4 },
      lines: current.lines,
      hiddenTokenIds: current.hiddenTokenIds,
      questionCount: 2,
      completedQuestionCount: 1,
      complete: false,
    };

    const next = applyContinueResult(value, response);
    expect(next.questions[0]).toBe(value.questions[0]);
    expect(next.questions[1].attempt).toBe(2);
    expect(next.questions[1].progress.solved).toBe(1);
    expect(value.questions[1].attempt).toBe(1);
    expect(next.questions[1]).not.toHaveProperty("titleHint");
  });

  it("copies only an active fourth-attempt title hint into the question view", () => {
    const value = challenge();
    const current = value.questions[1];
    const response: ChallengeGuessContinueView = {
      result: "continue",
      questionId: current.id,
      attempt: 4,
      maxAttempts: 4,
      status: "active",
      titleHint: "Track",
      progress: { solved: 1, revealed: 1, totalAnswerTokens: 4 },
      lines: current.lines,
      hiddenTokenIds: current.hiddenTokenIds,
      questionCount: 2,
      completedQuestionCount: 1,
      complete: false,
    };

    const next = applyContinueResult(value, response);
    expect(next.questions[1].titleHint).toBe("Track");
  });

  it("only exposes a non-empty title hint on an active fourth attempt", () => {
    const active = challenge().questions[1];
    const attemptFour = {
      ...active,
      attempt: 4 as const,
      titleHint: "Track",
    };
    const emptyHint = { ...attemptFour, titleHint: "  " };
    const terminal = {
      ...attemptFour,
      status: "solved" as const,
      reveal: {
        lines: ["one", "two", "three", "four"],
        trackName: "Track",
        artistNames: ["Artist"],
        startTimestampMs: 0,
      },
    };

    expect(getActiveTitleHint(active)).toBeUndefined();
    expect(getActiveTitleHint(attemptFour)).toBe("Track");
    expect(getActiveTitleHint(emptyHint)).toBeUndefined();
    expect(getActiveTitleHint(terminal)).toBeUndefined();
  });

  it("uses encouraging partial-progress feedback", () => {
    expect(getProgressMessage(challenge().questions[1], true)).toBe(
      "0 of 4 words solved. Another clue unlocked.",
    );
  });

  it("keeps terminal celebration facts presentation-only and one-shot", () => {
    const result: ChallengeGuessFinishedView = {
      result: "solved",
      questionId: "question_22222222",
      attemptsUsed: 1,
      progress: { solved: 4, revealed: 0, totalAnswerTokens: 4 },
      reveal: {
        lines: ["one", "two", "three", "four"],
        trackName: "Track",
        artistNames: ["Artist"],
        startTimestampMs: 0,
      },
      perfect: true,
      streak: 2,
      questionCount: 2,
      completedQuestionCount: 2,
      complete: true,
    };

    expect(buildCelebrationQueue(result)).toEqual([
      { kind: "perfect", questionId: result.questionId },
      { kind: "streak", questionId: result.questionId, streak: 2 },
    ]);
  });

  it("includes duplicate-submit, recovery, live feedback, and no active track metadata", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/challenge/challenge-game.tsx"),
      "utf8",
    );

    expect(source).toContain("if (isSubmitting");
    expect(source).toContain("readRecoveryPointer");
    expect(source).toContain("requestChallengePlayback");
    expect(source).toContain("onPlaybackRequest={(signal)");
    expect(source).toContain("buildCelebrationQueue");
    expect(source).toContain("<ChallengeCelebration");
    expect(source).toContain("celebrationResultKeyRef");
    expect(source).toContain("setCelebrationQueue([])");
    expect(source).toContain("currentQuestion.id");
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('role="status"');
    expect(source).toContain('aria-label="Lyric answer form"');
    expect(source).toContain('aria-labelledby="challenge-game-heading"');
    expect(source).toContain('aria-label="Challenge navigation"');
    expect(source).toContain("Final clue · song title");
    expect(source).toContain("getActiveTitleHint");
    expect(source).not.toContain("currentQuestion.reveal?.trackName");
    expect(source).not.toContain("multiplier");
  });
});
