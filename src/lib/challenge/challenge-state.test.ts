import { describe, expect, it } from "vitest";

import {
  ChallengeStateError,
  createChallengeState,
  createGuessResponse,
  getBestSolvedSongStreak,
  getCurrentSolvedSongStreak,
  getPerfectQuestionCount,
  isPerfectQuestion,
  renderChallenge,
  renderQuestion,
  transitionQuestionGuess,
  updateChallengeQuestion,
  type ChallengeQuestionState,
  type ChallengeQuestionTransition,
} from "./challenge-state";
import type { ChallengeCandidateResult } from "./challenge-candidates";
import { getHiddenTokenPlaceholder } from "../game/hidden-placeholder";

function candidate(
  id = "track-1",
  name = "Example track",
): Readonly<{
  track: {
    spotifyId: string;
    name: string;
    artistNames: readonly string[];
    durationMs: number;
  };
  window: [
    { timestampMs: number; text: string },
    { timestampMs: number; text: string },
    { timestampMs: number; text: string },
    { timestampMs: number; text: string },
  ];
}> {
  return {
    track: {
      spotifyId: id,
      name,
      artistNames: ["Example artist"],
      durationMs: 180_000,
    },
    window: [
      { timestampMs: 10_000, text: "Maybe we got lost in translation" },
      { timestampMs: 12_000, text: "Maybe I asked for too much" },
      { timestampMs: 14_000, text: "But maybe this thing was a masterpiece" },
      { timestampMs: 16_000, text: "Until you tore it all up" },
    ],
  };
}

function candidates(count = 1): ChallengeCandidateResult {
  return Object.freeze({
    status: "ready" as const,
    candidates: Object.freeze(
      Array.from({ length: count }, (_, index) =>
        candidate(`track-${index + 1}`, `Track ${index + 1}`),
      ),
    ),
    tracksScanned: count,
    sourceTruncated: false,
    lyricScanLimitReached: false,
  });
}

function createState(count = 1, seed = "seed-1") {
  return createChallengeState({
    challengeId: "challenge-1",
    questionIds: Array.from({ length: count }, (_, index) =>
      `question-${index + 1}`,
    ),
    source: {
      kind: "album",
      spotifyId: "album-1",
      displayName: "Example album",
    },
    seed,
    candidates: candidates(count),
    createdAt: 1_000,
    expiresAt: 1_801_000,
  });
}

function rawAnswerMap(question: ChallengeQuestionState): Record<string, string> {
  return Object.fromEntries(
    question.window
      .flatMap((line) => line.tokens)
      .filter((token) => token.isWord && token.state === "hidden")
      .map((token) => [token.id, token.raw]),
  );
}

function hiddenAnswerMap(
  question: ChallengeQuestionState,
  limit = Number.POSITIVE_INFINITY,
): Record<string, string> {
  return Object.fromEntries(
    question.window
      .flatMap((line) => line.tokens)
      .filter((token) => token.isWord && token.state === "hidden")
      .slice(0, limit)
      .map((token) => [token.id, token.raw]),
  );
}

function finishQuestion(
  question: ChallengeQuestionState,
  seed: string,
  questionIndex: number,
  answers: Record<string, string> = {},
): ChallengeQuestionTransition {
  let current = question;
  let transition: ChallengeQuestionTransition | undefined;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    transition = transitionQuestionGuess(
      current,
      attempt === 0 ? answers : {},
      seed,
      questionIndex,
    );
    current = transition.question;

    if (transition.result !== "continue") {
      return transition;
    }
  }

  throw new Error("Expected a terminal question transition.");
}

describe("server-controlled challenge state", () => {
  it("preserves a safe canonical identity for anonymous public playlists", () => {
    const state = createChallengeState({
      challengeId: "challenge-1",
      questionIds: ["question-1"],
      source: {
        kind: "public-playlist",
        spotifyId: "playlist-1",
        displayName: "Public playlist",
        canonicalUrl:
          "https://open.spotify.com/playlist/playlist-1/?si=ignored#ignored",
      },
      seed: "seed-1",
      candidates: candidates(),
      createdAt: 1_000,
      expiresAt: 1_801_000,
    });

    expect(state.source).toEqual({
      kind: "public-playlist",
      spotifyId: "playlist-1",
      displayName: "Public playlist",
      canonicalUrl: "https://open.spotify.com/playlist/playlist-1",
    });
    expect(renderChallenge(state).source).toEqual(state.source);
  });

  it("creates an immutable state with stable IDs, line boundaries, and an initial mask", () => {
    const state = createState();
    const question = state.questions[0];

    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.source)).toBe(true);
    expect(Object.isFrozen(state.questions)).toBe(true);
    expect(Object.isFrozen(question)).toBe(true);
    expect(Object.isFrozen(question.window)).toBe(true);
    expect(question.attempt).toBe(1);
    expect(question.status).toBe("active");
    expect(question.window).toHaveLength(4);
    expect(question.window.flatMap((line) => line.tokens).some((token) => token.state === "hidden")).toBe(true);
    expect(question.window.flatMap((line) => line.tokens).some((token) => token.state === "revealed")).toBe(true);

    const view = renderQuestion(question);
    expect(view.lines).toHaveLength(4);
    expect(view.lines[0]?.timestampMs).toBe(10_000);
    expect(view.lines[0]?.tokens.map((token) => token.id)).toEqual(
      question.window[0].tokens.map((token) => token.id),
    );
    expect(view.hiddenTokenIds).toEqual(
      question.window
        .flatMap((line) => line.tokens)
        .filter((token) => token.isWord && token.state === "hidden")
        .map((token) => token.id),
    );

    for (const token of view.lines.flatMap((line) => line.tokens)) {
      if (token.state === "hidden") {
        const sourceToken = question.window
          .flatMap((line) => line.tokens)
          .find((candidate) => candidate.id === token.id);

        expect(sourceToken).toBeDefined();
        expect(token.text).toBe(
          getHiddenTokenPlaceholder(sourceToken?.raw ?? ""),
        );
      }
    }
  });

  it("captures the baseline hidden denominator without exposing it in rendered state", () => {
    const state = createState();
    const question = state.questions[0];
    const totalAnswerTokens = question.window
      .flatMap((line) => line.tokens)
      .filter((token) => token.isWord).length;
    const baselineHidden = question.window
      .flatMap((line) => line.tokens)
      .filter((token) => token.isWord && token.state === "hidden").length;

    expect(question.initiallyHiddenAnswerTokens).toBe(baselineHidden);
    expect(question.initiallyHiddenAnswerTokens).toBeLessThan(totalAnswerTokens);
    expect(renderChallenge(state)).not.toHaveProperty("score");
    expect(JSON.stringify(renderChallenge(state))).not.toContain(
      "initiallyHiddenAnswerTokens",
    );
  });

  it("keeps deterministic reveal choices independent from random opaque IDs", () => {
    const first = createState(1, "same-seed");
    const second = createChallengeState({
      challengeId: "challenge-2",
      questionIds: ["question-2"],
      source: first.source,
      seed: "same-seed",
      candidates: candidates(),
      createdAt: 1_000,
      expiresAt: 1_801_000,
    });

    expect(first.questions[0]?.window).toEqual(second.questions[0]?.window);
    expect(first.questions[0]?.id).not.toBe(second.questions[0]?.id);
  });

  it("locks correct words and solves before the fourth attempt", () => {
    const state = createState();
    const question = state.questions[0];
    const transition = transitionQuestionGuess(
      question,
      rawAnswerMap(question),
      state.seed,
      0,
    );

    expect(transition.result).toBe("solved");
    expect(transition.question.status).toBe("solved");
    expect(transition.question.attempt).toBe(1);
    expect(transition.attemptsUsed).toBe(1);
    expect(transition.progress.solved + transition.progress.revealed).toBe(
      transition.progress.totalAnswerTokens,
    );
    expect(transition.question.window.flatMap((line) => line.tokens).every((token) =>
      !token.isWord || token.state === "solved" || token.state === "revealed",
    )).toBe(true);

    const updated = updateChallengeQuestion(state, transition);
    const challengeView = renderChallenge(updated);
    expect(challengeView.completedQuestionCount).toBe(1);
    expect(challengeView.complete).toBe(true);
    expect(challengeView.questions[0]?.reveal?.lines).toHaveLength(4);
    expect(challengeView.questions[0]?.reveal?.trackName).toBe("Track 1");
    expect(challengeView.score).toEqual({
      total: 100,
      songs: [{ questionId: "question-1", score: 100 }],
    });

    const finishedResponse = createGuessResponse({
      challenge: updated,
      transition,
    });
    expect(finishedResponse).toMatchObject({
      result: "solved",
      perfect: true,
      streak: 1,
      complete: true,
    });
    expect(finishedResponse).not.toHaveProperty("score");
  });

  it("keeps partial failed credit, derives Perfect independently, and resets streaks", () => {
    const state = createState(2);
    const first = state.questions[0];
    const second = state.questions[1];
    const firstTransition = finishQuestion(
      first,
      state.seed,
      0,
      hiddenAnswerMap(first, 1),
    );
    expect(firstTransition.result).toBe("failed");
    expect(firstTransition.question.status).toBe("failed");
    expect(isPerfectQuestion(firstTransition.question)).toBe(false);
    expect(
      createGuessResponse({
        challenge: state,
        transition: firstTransition,
      }),
    ).toMatchObject({ result: "failed", perfect: false, streak: 0 });

    const failedChallenge = updateChallengeQuestion(state, firstTransition);
    expect(getCurrentSolvedSongStreak(failedChallenge.questions)).toBe(0);

    const secondTransition = finishQuestion(
      second,
      state.seed,
      1,
      hiddenAnswerMap(second),
    );
    const completed = updateChallengeQuestion(
      failedChallenge,
      secondTransition,
    );
    expect(secondTransition.result).toBe("solved");
    expect(isPerfectQuestion(secondTransition.question)).toBe(true);
    expect(getCurrentSolvedSongStreak(completed.questions)).toBe(1);
    expect(
      createGuessResponse({
        challenge: failedChallenge,
        transition: secondTransition,
      }),
    ).toMatchObject({ perfect: true, streak: 1 });
    expect(completed.questions[0]?.initiallyHiddenAnswerTokens).toBe(
      failedChallenge.questions[0]?.initiallyHiddenAnswerTokens,
    );

    const view = renderChallenge(completed);
    expect(view.complete).toBe(true);
    expect(view.score?.songs).toEqual([
      { questionId: "question-1", score: 7 },
      { questionId: "question-2", score: 100 },
    ]);
    expect(view.score?.total).toBe(54);
  });

  it("reports an attempt-2 solve as non-Perfect and preserves the immutable prior state", () => {
    const state = createState();
    const originalQuestion = state.questions[0];
    const firstAttempt = transitionQuestionGuess(
      originalQuestion,
      {},
      state.seed,
      0,
    );
    expect(firstAttempt.result).toBe("continue");
    const secondAttempt = transitionQuestionGuess(
      firstAttempt.question,
      hiddenAnswerMap(firstAttempt.question),
      state.seed,
      0,
    );
    expect(secondAttempt.result).toBe("solved");
    expect(secondAttempt.question.attempt).toBe(2);
    expect(isPerfectQuestion(secondAttempt.question)).toBe(false);

    const completed = updateChallengeQuestion(state, secondAttempt);
    const expectedScore = Math.round(
      (100 * secondAttempt.progress.solved) /
        originalQuestion.initiallyHiddenAnswerTokens,
    );
    expect(renderChallenge(completed).score?.songs[0]?.score).toBe(expectedScore);
    expect(state.questions[0]).toBe(originalQuestion);
    expect(state.questions[0]?.status).toBe("active");
    expect(state).not.toBe(completed);
  });

  it("derives a capped current streak in question order while active questions do not contribute", () => {
    const state = createState(3);
    const [first, second, third] = state.questions;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error("Expected three questions.");
    }

    const firstTransition = finishQuestion(first, state.seed, 0, hiddenAnswerMap(first));
    const firstState = updateChallengeQuestion(state, firstTransition);
    expect(getCurrentSolvedSongStreak(firstState.questions)).toBe(1);

    const secondTransition = finishQuestion(
      second,
      state.seed,
      1,
      hiddenAnswerMap(second),
    );
    const secondState = updateChallengeQuestion(firstState, secondTransition);
    expect(getCurrentSolvedSongStreak(secondState.questions)).toBe(2);

    const thirdTransition = finishQuestion(third, state.seed, 2, {});
    const complete = updateChallengeQuestion(secondState, thirdTransition);
    expect(thirdTransition.result).toBe("failed");
    expect(getCurrentSolvedSongStreak(complete.questions)).toBe(0);
  });

  it("derives the maximum solved-song run and Perfect count from terminal facts", () => {
    const questions = [
      { status: "solved" as const, attempt: 1 as const },
      { status: "solved" as const, attempt: 2 as const },
      { status: "failed" as const, attempt: 4 as const },
      { status: "solved" as const, attempt: 1 as const },
      { status: "solved" as const, attempt: 1 as const },
      { status: "active" as const, attempt: 1 as const },
    ];

    expect(getBestSolvedSongStreak(questions)).toBe(2);
    expect(getPerfectQuestionCount(questions)).toBe(3);
  });

  it("progressively reveals cumulative hints and fails with the selected fragment", () => {
    const state = createState();
    let question = state.questions[0];
    const revealCounts: number[] = [];

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const transition = transitionQuestionGuess(
        question,
        {},
        state.seed,
        0,
      );
      revealCounts.push(transition.progress.revealed);
      question = transition.question;

      if (attempt < 4) {
        expect(transition.result).toBe("continue");
        expect(question.attempt).toBe((attempt + 1) as 2 | 3 | 4);
      } else {
        expect(transition.result).toBe("failed");
        expect(question.status).toBe("failed");
        expect(transition.attemptsUsed).toBe(4);
      }
    }

    expect(revealCounts[1]).toBeGreaterThanOrEqual(revealCounts[0] ?? 0);
    expect(revealCounts[2]).toBeGreaterThanOrEqual(revealCounts[1] ?? 0);
    expect(revealCounts[3]).toBeGreaterThanOrEqual(revealCounts[2] ?? 0);
    const view = renderQuestion(question);
    expect(view.hiddenTokenIds.length).toBeGreaterThan(0);
    expect(view.reveal?.lines).toEqual([
      "Maybe we got lost in translation",
      "Maybe I asked for too much",
      "But maybe this thing was a masterpiece",
      "Until you tore it all up",
    ]);
    expect(view).not.toHaveProperty("titleHint");
  });

  it("exposes the track title only on an active fourth attempt", () => {
    const state = createState();
    let question = state.questions[0];

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const before = renderQuestion(question);
      expect(before).not.toHaveProperty("titleHint");

      const transition = transitionQuestionGuess(
        question,
        {},
        state.seed,
        0,
      );

      expect(transition.result).toBe("continue");
      question = transition.question;
    }

    expect(question.attempt).toBe(4);
    const activeView = renderQuestion(question);
    expect(activeView.titleHint).toBe("Track 1");

    const continueResponse = createGuessResponse({
      challenge: state,
      transition: {
        result: "continue",
        question,
        attemptsUsed: 3,
        progress: activeView.progress,
      },
    });

    expect(continueResponse).toMatchObject({
      result: "continue",
      attempt: 4,
      titleHint: "Track 1",
    });
    expect(() =>
      transitionQuestionGuess(
        question,
        { titleHint: "Track 1" },
        state.seed,
        0,
      ),
    ).toThrowError(new ChallengeStateError("invalid_guess"));
  });

  it("preserves solved words when an incomplete guess advances the attempt", () => {
    const state = createState();
    const firstQuestion = state.questions[0];
    const hidden = firstQuestion.window
      .flatMap((line) => line.tokens)
      .find((token) => token.isWord && token.state === "hidden");

    expect(hidden).toBeDefined();
    const firstTransition = transitionQuestionGuess(
      firstQuestion,
      { [hidden?.id ?? ""]: hidden?.raw ?? "" },
      state.seed,
      0,
    );

    expect(firstTransition.result).toBe("continue");
    const solved = firstTransition.question.window
      .flatMap((line) => line.tokens)
      .find((token) => token.id === hidden?.id);
    expect(solved?.state).toBe("solved");

    const secondTransition = transitionQuestionGuess(
      firstTransition.question,
      {},
      state.seed,
      0,
    );
    expect(
      secondTransition.question.window
        .flatMap((line) => line.tokens)
        .find((token) => token.id === hidden?.id)?.state,
    ).toBe("solved");
  });

  it("rejects unknown, revealed, solved, and malformed guesses without mutation", () => {
    const state = createState();
    const question = state.questions[0];
    const before = JSON.stringify(question);
    const revealed = question.window
      .flatMap((line) => line.tokens)
      .find((token) => token.state === "revealed");

    expect(() =>
      transitionQuestionGuess(question, { "unknown-token": "answer" }, state.seed, 0),
    ).toThrowError(new ChallengeStateError("invalid_guess"));
    expect(() =>
      transitionQuestionGuess(question, { [revealed?.id ?? ""]: "answer" }, state.seed, 0),
    ).toThrowError(new ChallengeStateError("invalid_guess"));
    expect(() =>
      transitionQuestionGuess(question, { "hidden-token": 42 }, state.seed, 0),
    ).toThrowError(new ChallengeStateError("invalid_guess"));
    expect(JSON.stringify(question)).toBe(before);

    const solvedTransition = transitionQuestionGuess(
      question,
      rawAnswerMap(question),
      state.seed,
      0,
    );
    expect(() =>
      transitionQuestionGuess(solvedTransition.question, {}, state.seed, 0),
    ).toThrowError(new ChallengeStateError("question_finished"));
  });

  it("rejects empty candidate sets and invalid source/seed inputs", () => {
    expect(() =>
      createChallengeState({
        challengeId: "challenge-1",
        questionIds: [],
        source: { kind: "album", spotifyId: "album-1", displayName: "Album" },
        seed: "seed",
        candidates: {
          status: "insufficient_lyrics",
          candidates: [],
          tracksScanned: 1,
          sourceTruncated: false,
          lyricScanLimitReached: false,
        },
        createdAt: 1,
        expiresAt: 2,
      }),
    ).toThrowError(new ChallengeStateError("insufficient_lyrics"));

    expect(() => createState(1, "bad\nseed")).toThrowError(
      new ChallengeStateError("invalid_seed"),
    );
    expect(() =>
      createChallengeState({
        challengeId: "bad/id",
        questionIds: ["question-1"],
        source: { kind: "album", spotifyId: "album-1", displayName: "Album" },
        seed: "seed",
        candidates: candidates(),
        createdAt: 1,
        expiresAt: 2,
      }),
    ).toThrowError(new ChallengeStateError("invalid_id"));
  });

  it("returns only the allowed final reveal metadata", () => {
    const state = createState();
    let question = state.questions[0];
    let transition: ChallengeQuestionTransition | undefined;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      transition = transitionQuestionGuess(question, {}, state.seed, 0);
      question = transition.question;
    }

    if (transition === undefined) {
      throw new Error("Expected a final transition.");
    }

    const updated = updateChallengeQuestion(state, transition);
    const response = createGuessResponse({
      challenge: updated,
      transition,
    });
    const serialized = JSON.stringify(response);

    expect(response.result).toBe("failed");
    if (response.result !== "failed") {
      throw new Error("Expected a failed response.");
    }
    expect(response.reveal.lines).toHaveLength(4);
    expect(response.reveal.trackName).toBe("Track 1");
    expect(serialized).not.toContain("normalized");
    expect(serialized).not.toContain("candidateWindows");
    expect(serialized).not.toContain("durationMs");
  });
});
