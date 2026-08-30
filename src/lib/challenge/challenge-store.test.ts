import { describe, expect, it } from "vitest";

import type { ChallengeCandidateResult } from "./challenge-candidates";
import type { FourLineLyricWindow } from "../../types/game";
import {
  ChallengeStateError,
  renderChallenge,
} from "./challenge-state";
import {
  CHALLENGE_TTL_MS,
  ChallengeStore,
  ChallengeStoreError,
  MAX_ACTIVE_CHALLENGES,
} from "./challenge-store";

function candidates(count = 1): ChallengeCandidateResult {
  return Object.freeze({
    status: "ready" as const,
    candidates: Object.freeze(
      Array.from({ length: count }, (_, index) => ({
        track: {
          spotifyId: `track-${index + 1}`,
          name: `Track ${index + 1}`,
          artistNames: ["Artist"],
          durationMs: 180_000,
        },
        window: [
          { timestampMs: 1_000, text: "One two three four" },
          { timestampMs: 2_000, text: "Five six seven eight" },
          { timestampMs: 3_000, text: "Nine ten eleven twelve" },
          { timestampMs: 4_000, text: "Thirteen fourteen fifteen sixteen" },
        ] as FourLineLyricWindow,
      })),
    ),
    tracksScanned: count,
    sourceTruncated: false,
    lyricScanLimitReached: false,
  });
}

function createStore(
  now: () => number,
  ids: string[] = [],
  options: { ttlMs?: number; maxEntries?: number } = {},
): ChallengeStore {
  let index = 0;
  const nextId = () => ids[index++] ?? `generated-${index + 100}`;

  return new ChallengeStore({
    now,
    challengeId: nextId,
    questionId: nextId,
    ...options,
  });
}

function createInput(count = 1) {
  return {
    source: {
      kind: "album" as const,
      spotifyId: "album-1",
      displayName: "Album",
    },
    seed: "store-seed",
    candidates: candidates(count),
  };
}

describe("process-local challenge store", () => {
  it("creates immutable bounded state and retains guesses across requests", () => {
    const store = createStore(
      () => 1_000,
      ["challenge-1", "question-1"],
    );
    const state = store.create(createInput());

    expect(state.id).toBe("challenge-1");
    expect(state.expiresAt).toBe(1_000 + CHALLENGE_TTL_MS);
    expect(store.get(state.id)).toBe(state);
    expect(store.size).toBe(1);
    expect(Object.isFrozen(state)).toBe(true);

    const hidden = state.questions[0].window
      .flatMap((line) => line.tokens)
      .find((token) => token.isWord && token.state === "hidden");
    expect(hidden).toBeDefined();

    const result = store.guess(
      state.id,
      state.questions[0].id,
      { [hidden?.id ?? ""]: hidden?.raw ?? "" },
    );
    expect(result.transition.result).toBe("continue");
    expect(store.get(state.id)).toBe(result.challenge);
    expect(
      result.challenge.questions[0].window
        .flatMap((line) => line.tokens)
        .find((token) => token.id === hidden?.id)?.state,
    ).toBe("solved");
    expect(renderChallenge(result.challenge).questions[0]?.status).toBe("active");
  });

  it("expires on the creation lifetime without a background timer", () => {
    let now = 5_000;
    const store = createStore(
      () => now,
      ["challenge-1", "question-1"],
      { ttlMs: 100 },
    );
    const state = store.create(createInput());

    now = 5_099;
    expect(store.get(state.id)).toBe(state);
    now = 5_100;
    expect(() => store.get(state.id)).toThrowError(
      new ChallengeStoreError("not_found"),
    );
    expect(store.size).toBe(0);
  });

  it("evicts the oldest entry at the configured cap", () => {
    let now = 1_000;
    const store = createStore(
      () => now,
      [
        "challenge-1",
        "question-1",
        "challenge-2",
        "question-2",
        "challenge-3",
        "question-3",
      ],
      { maxEntries: 2 },
    );

    const first = store.create(createInput());
    now += 1;
    const second = store.create(createInput());
    now += 1;
    const third = store.create(createInput());

    expect(store.size).toBe(2);
    expect(() => store.get(first.id)).toThrowError(
      new ChallengeStoreError("not_found"),
    );
    expect(store.get(second.id)).toBe(second);
    expect(store.get(third.id)).toBe(third);
  });

  it("supports short one-to-five challenges and reset isolation", () => {
    let nextId = 0;
    const store = new ChallengeStore({
      now: () => 1_000,
      challengeId: () => `challenge-${++nextId}`,
      questionId: () => `question-${++nextId}`,
    });

    const state = store.create(createInput(5));
    expect(state.questions).toHaveLength(5);
    expect(new Set(state.questions.map((question) => question.id)).size).toBe(5);
    expect(store.size).toBe(1);
    store.reset();
    expect(store.size).toBe(0);
    expect(() => store.get(state.id)).toThrowError(
      new ChallengeStoreError("not_found"),
    );
  });

  it("rejects invalid IDs, stale questions, and insufficient candidates safely", () => {
    const store = createStore(
      () => 1_000,
      ["challenge-1", "question-1"],
    );

    expect(() => store.get("bad/id")).toThrowError(
      new ChallengeStoreError("invalid_id"),
    );
    expect(() => store.create({
      ...createInput(),
      candidates: {
        status: "insufficient_lyrics",
        candidates: [],
        tracksScanned: 1,
        sourceTruncated: false,
        lyricScanLimitReached: false,
      },
    })).toThrowError(new ChallengeStateError("insufficient_lyrics"));

    const state = store.create(createInput());
    expect(() => store.guess(state.id, "question-missing", {})).toThrowError(
      new ChallengeStoreError("question_not_found"),
    );
  });

  it("uses generated high-entropy IDs with the bounded format by default", () => {
    const store = new ChallengeStore({ now: () => 1_000 });
    const state = store.create(createInput(1));

    expect(state.id).toMatch(/^[A-Za-z0-9_-]{32,64}$/u);
    expect(state.questions[0].id).toMatch(/^[A-Za-z0-9_-]{32,64}$/u);
    expect(MAX_ACTIVE_CHALLENGES).toBe(100);
  });
});
