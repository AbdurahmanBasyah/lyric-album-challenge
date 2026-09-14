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
  getGameplayAtmosphereIntensity,
  getActiveTitleHint,
  getAttemptStartGapId,
  getNextGapAfterAttempt,
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
      "Another clue unlocked.",
    );
    expect(getProgressMessage(challenge().questions[1])).toBe("Keep going.");
  });

  it("maps attempts to the canonical stage atmosphere", () => {
    const active = challenge().questions[1];

    expect(getGameplayAtmosphereIntensity(active)).toBe("expert");
    expect(getGameplayAtmosphereIntensity({ ...active, attempt: 2 })).toBe("hard");
    expect(getGameplayAtmosphereIntensity({ ...active, attempt: 3 })).toBe("medium");
    expect(getGameplayAtmosphereIntensity({ ...active, attempt: 4 })).toBe("easy");
    expect(
      getGameplayAtmosphereIntensity(active, {
        result: "solved",
        questionId: active.id,
        attemptsUsed: 1,
        progress: active.progress,
        reveal: {
          lines: ["one", "two", "three", "four"],
          trackName: "Track",
          artistNames: ["Artist"],
          startTimestampMs: 0,
        },
        perfect: true,
        streak: 0,
        questionCount: 2,
        completedQuestionCount: 2,
        complete: true,
      }),
    ).toBe("solved");
  });

  it("keeps the active target on a surviving next-attempt gap", () => {
    const previous = challenge().questions[1];
    const next = {
      ...previous,
      attempt: 2 as const,
      hiddenTokenIds: ["l1t0", "l2t0", "l3t0"],
    };

    expect(getNextGapAfterAttempt(previous, next, "l0t0")).toBe("l1t0");
    expect(getNextGapAfterAttempt(previous, next, "l3t0")).toBe("l1t0");
    expect(getNextGapAfterAttempt(previous, { ...next, hiddenTokenIds: [] }, "l0t0")).toBeNull();
  });

  it("starts one opaque warmup per active question and targets the first gap at boundaries", () => {
    const active = challenge().questions[1];
    expect(getAttemptStartGapId(active)).toBe("l0t0");

    const source = readFileSync(
      resolve(process.cwd(), "src/components/challenge/challenge-game.tsx"),
      "utf8",
    );
    expect(source).toContain("requestChallengePlaybackWarmup");
    expect(source).toContain("startChallengePlaybackWarmup");
    expect(source).toContain("warmupChallengeId");
    expect(source).toContain("warmupQuestionId");
    expect(source).not.toContain("currentQuestion.track");
    expect(source).not.toContain("currentQuestion.reveal?.trackName");
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

  it("keeps the explicit presentation sequence ordered before Round Complete", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/challenge/challenge-game.tsx"),
      "utf8",
    );

    expect(source).toContain("presentationPhase");
    expect(source).toContain("celebrating-perfect");
    expect(source).toContain("celebrating-streak");
    expect(source).toContain('presentationPhase === "round-complete"');
    expect(source).toContain("phaseForCelebrationEvent");
    expect(source).toContain("roundResult !== null");
  });

  it("clears solved feedback while preserving the primary result heading", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/challenge/challenge-game.tsx"),
      "utf8",
    );

    expect(source).toContain('result.result === "solved"');
    expect(source).toContain('? ""');
    expect(source).not.toContain('? "You got it."');
  });

  it("includes duplicate-submit, recovery, live feedback, and no active track metadata", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/challenge/challenge-game.tsx"),
      "utf8",
    );

    expect(source).toContain("isSubmitting ||");
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
    expect(source).toContain("One last clue");
    expect(source).toContain("Song title:");
    expect(source).toContain("Check Words");
    expect(source).toContain("onDraftChange");
    expect(source).toContain('type="button"');
    expect(source).toContain("inline editing usable");
    expect(source).not.toContain(["Answer", "Composer"].join(""));
    expect(source).not.toContain(["answer", "-composer"].join(""));
    expect(source).toContain("Leave Game");
    expect(source).toContain("BrandWordmark");
    expect(source).toContain("StageAtmosphere");
    expect(source).toContain("getActiveTitleHint");
    expect(source).not.toContain("currentQuestion.reveal?.trackName");
    expect(source).not.toContain("sourceName");
    expect(source).not.toContain("multiplier");
  });
});
