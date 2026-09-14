import { describe, expect, it, vi } from "vitest";

import { renderChallenge } from "../../lib/challenge/challenge-state";
import { ChallengeStore } from "../../lib/challenge/challenge-store";
import type { ChallengeCandidateResult } from "../../lib/challenge/challenge-candidates";
import type { FourLineLyricWindow } from "../../types/game";

import {
  CHALLENGE_RECOVERY_STORAGE_KEY,
  ChallengeClientError,
  canonicalizePublicPlaylistInput,
  clearRecoveryPointer,
  createChallenge,
  createChallengeIntroUrl,
  createPublicPlaylistChallenge,
  getChallenge,
  parseChallengeEnvelope,
  parseChallengePlaybackResponse,
  parseChallengePlaybackWarmupResponse,
  parseChallengeSourceContext,
  parseGuessResponse,
  readRecoveryPointer,
  saveRecoveryPointer,
  submitChallengeGuess,
  requestChallengePlayback,
  requestChallengePlaybackWarmup,
  getChallengeErrorCopy,
  type StorageLike,
} from "./challenge-api";

const challengeId = "challenge_12345678";
const questionId = "question_12345678";

function line(index: number) {
  return {
    timestampMs: index * 1_000,
    tokens: [
      { id: `l${index}t0`, text: "____", state: "hidden" },
      { id: `l${index}t1`, text: " ", state: "static" },
      { id: `l${index}t2`, text: "hint", state: "revealed" },
    ],
  };
}

function solvedLine(index: number) {
  const value = line(index);
  value.tokens[0] = { ...value.tokens[0], text: "solved", state: "solved" };
  return value;
}

function challengeEnvelope() {
  return {
    challenge: {
      id: challengeId,
      seed: "seed-1",
      source: {
        kind: "album",
        spotifyId: "album_1",
        displayName: "Album One",
      },
      questions: [
        {
          id: questionId,
          attempt: 1,
          maxAttempts: 4,
          status: "active",
          lines: [line(0), line(1), line(2), line(3)],
          hiddenTokenIds: ["l0t0", "l1t0", "l2t0", "l3t0"],
          progress: { solved: 0, revealed: 4, totalAnswerTokens: 8 },
        },
      ],
      questionCount: 1,
      completedQuestionCount: 0,
      complete: false,
    },
  };
}

type MutableQuestionFixture = {
  attempt: number;
  titleHint?: unknown;
  lines: Array<{ tokens: Array<{ text: string }> }>;
  [key: string]: unknown;
};

function mutableQuestion(
  envelope: ReturnType<typeof challengeEnvelope>,
): MutableQuestionFixture {
  return envelope.challenge.questions[0] as unknown as MutableQuestionFixture;
}

function createStorage(): StorageLike & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe("challenge browser boundary", () => {
  it("accepts the exact masked DTO rendered by the server state boundary", () => {
    const store = new ChallengeStore({
      now: () => 1_000,
      challengeId: () => challengeId,
      questionId: () => questionId,
    });
    const candidates: ChallengeCandidateResult = {
      status: "ready",
      candidates: [
        {
          track: {
            spotifyId: "track_1",
            name: "Hidden Track",
            artistNames: ["Artist"],
            durationMs: 180_000,
          },
          window: [0, 1, 2, 3].map((index) => ({
            timestampMs: index * 1_000,
            text: `line ${index} with several answer words here`,
          })) as FourLineLyricWindow,
        },
      ],
      tracksScanned: 1,
      sourceTruncated: false,
      lyricScanLimitReached: false,
    };
    const state = store.create({
      source: {
        kind: "album",
        spotifyId: "album_1",
        displayName: "Album One",
      },
      seed: "seed-1",
      candidates,
    });

    expect(
      parseChallengeEnvelope({ challenge: renderChallenge(state) }),
    ).not.toBeNull();
  });

  it("parses a masked challenge and rejects hidden answer fields", () => {
    expect(parseChallengeEnvelope(challengeEnvelope())?.id).toBe(challengeId);

    const leaked = challengeEnvelope();
    Object.assign(leaked.challenge.questions[0].lines[0].tokens[0], {
      normalized: "secret",
    });

    expect(parseChallengeEnvelope(leaked)).toBeNull();
  });

  it("accepts length-aware hidden gaps and an active fourth-attempt title hint", () => {
    const envelope = challengeEnvelope();
    const question = mutableQuestion(envelope);
    question.attempt = 4;
    question.lines[0].tokens[0].text = "_______";
    question.titleHint = "Hidden Track";

    const parsed = parseChallengeEnvelope(envelope);

    expect(parsed?.questions[0]).toMatchObject({
      attempt: 4,
      titleHint: "Hidden Track",
    });
    expect(parsed?.questions[0]?.lines[0]?.tokens[0]?.text).toBe("_______");
  });

  it("rejects unsafe hidden gaps and misplaced or malformed title hints", () => {
    for (const hiddenText of ["secret", "_ _", "", "____x", "\u0000___"]) {
      const envelope = challengeEnvelope();
      mutableQuestion(envelope).lines[0].tokens[0].text = hiddenText;
      expect(parseChallengeEnvelope(envelope)).toBeNull();
    }

    const missingFourthAttemptTitle = challengeEnvelope();
    mutableQuestion(missingFourthAttemptTitle).attempt = 4;
    expect(parseChallengeEnvelope(missingFourthAttemptTitle)).toBeNull();

    const earlyTitle = challengeEnvelope();
    mutableQuestion(earlyTitle).titleHint = "Hidden Track";
    expect(parseChallengeEnvelope(earlyTitle)).toBeNull();

    for (const titleHint of [
      "",
      "   ",
      "title\nwith-control",
      "x".repeat(513),
      42,
      null,
    ]) {
      const envelope = challengeEnvelope();
      const question = mutableQuestion(envelope);
      question.attempt = 4;
      question.titleHint = titleHint;
      expect(parseChallengeEnvelope(envelope)).toBeNull();
    }

    const unknownField = challengeEnvelope();
    const unknownQuestion = mutableQuestion(unknownField);
    unknownQuestion.attempt = 4;
    unknownQuestion.titleHint = "Hidden Track";
    Object.assign(unknownQuestion, { debug: true });
    expect(parseChallengeEnvelope(unknownField)).toBeNull();
  });

  it("does not allow a title hint on a terminal question", () => {
    const base = challengeEnvelope();
    const question = mutableQuestion(base);
    const terminal = {
      ...base,
      challenge: {
        ...base.challenge,
        questions: [
          {
            ...question,
            status: "solved",
            reveal: {
              lines: ["one", "two", "three", "four"],
              trackName: "Hidden Track",
              artistNames: ["Artist"],
              startTimestampMs: 0,
            },
          },
        ],
        completedQuestionCount: 1,
        complete: true,
        score: {
          total: 100,
          songs: [{ questionId, score: 100 }],
        },
      },
    };

    expect(parseChallengeEnvelope(terminal)).not.toBeNull();
    Object.assign(terminal.challenge.questions[0] as object, {
      titleHint: "Hidden Track",
    });
    expect(parseChallengeEnvelope(terminal)).toBeNull();
  });

  it("accepts a complete score view and requires it only on completed challenges", () => {
    const complete = challengeEnvelope();
    const question = mutableQuestion(complete);
    question.status = "solved";
    question.reveal = {
      lines: ["one", "two", "three", "four"],
      trackName: "Hidden Track",
      artistNames: ["Artist"],
      startTimestampMs: 0,
    };
    complete.challenge.completedQuestionCount = 1;
    complete.challenge.complete = true;
    Object.assign(complete.challenge, {
      score: {
        total: 83,
        songs: [{ questionId, score: 83 }],
      },
    });

    expect(parseChallengeEnvelope(complete)?.score).toEqual({
      total: 83,
      songs: [{ questionId, score: 83 }],
    });

    const incomplete = challengeEnvelope();
    Object.assign(incomplete.challenge, {
      score: { total: 0, songs: [] },
    });
    expect(parseChallengeEnvelope(incomplete)).toBeNull();

    const missingScore = { ...complete, challenge: { ...complete.challenge } };
    delete (missingScore.challenge as Record<string, unknown>).score;
    expect(parseChallengeEnvelope(missingScore)).toBeNull();
  });

  it("rejects malformed, duplicated, out-of-range, or multiplier-bearing score data", () => {
    const complete = challengeEnvelope();
    const question = mutableQuestion(complete);
    question.status = "failed";
    question.reveal = {
      lines: ["one", "two", "three", "four"],
      trackName: "Hidden Track",
      artistNames: ["Artist"],
      startTimestampMs: 0,
    };
    complete.challenge.completedQuestionCount = 1;
    complete.challenge.complete = true;

    const validScore = {
      total: 0,
      songs: [{ questionId, score: 0 }],
    };

    for (const score of [
      { total: 101, songs: validScore.songs },
      { total: 0, songs: [{ questionId, score: 101 }] },
      { total: 0, songs: [] },
      { total: 0, songs: [{ questionId, score: 0 }, { questionId, score: 0 }] },
      { total: 0, songs: [{ questionId: "other_12345678", score: 0 }] },
      {
        total: 0,
        songs: [{ questionId, score: 0, multiplier: 1 }],
      },
      {
        total: 0,
        songs: [{ questionId, score: 0, note: "\u0000" }],
      },
    ]) {
      const candidate = {
        ...complete,
        challenge: { ...complete.challenge, score },
      };
      expect(parseChallengeEnvelope(candidate)).toBeNull();
    }
  });

  it("parses terminal Perfect and streak facts while rejecting invalid combinations", () => {
    const finished = {
      result: "solved" as const,
      questionId,
      attemptsUsed: 1 as const,
      progress: { solved: 3, revealed: 1, totalAnswerTokens: 4 },
      reveal: {
        lines: ["one", "two", "three", "four"],
        trackName: "Hidden Track",
        artistNames: ["Artist"],
        startTimestampMs: 0,
      },
      perfect: true,
      streak: 2,
      questionCount: 1,
      completedQuestionCount: 1,
      complete: true,
    };

    expect(parseGuessResponse(finished)).toMatchObject({
      result: "solved",
      perfect: true,
      streak: 2,
    });

    const failed = {
      ...finished,
      result: "failed" as const,
      attemptsUsed: 4 as const,
      perfect: false,
      streak: 0,
    };
    expect(parseGuessResponse(failed)).toMatchObject({
      result: "failed",
      perfect: false,
      streak: 0,
    });

    for (const invalid of [
      { ...finished, perfect: false },
      { ...finished, attemptsUsed: 2 as const, perfect: true },
      { ...finished, result: "failed" as const, attemptsUsed: 4 as const, perfect: true, streak: 0 },
      { ...finished, result: "failed" as const, attemptsUsed: 4 as const, perfect: false, streak: 1 },
      { ...finished, streak: 6 },
      { ...finished, complete: false },
      { ...finished, extra: true },
    ]) {
      expect(parseGuessResponse(invalid)).toBeNull();
    }
  });

  it("validates source query context and creates an encoded local route", () => {
    const source = parseChallengeSourceContext({
      kind: "playlist",
      spotifyId: "playlist_1",
      displayName: "Night drive & rain",
    });

    expect(source).toEqual({
      kind: "playlist",
      spotifyId: "playlist_1",
      displayName: "Night drive & rain",
    });
    expect(createChallengeIntroUrl(source!)).toBe(
      "/play?kind=playlist&spotifyId=playlist_1&displayName=Night+drive+%26+rain",
    );
    expect(
      parseChallengeSourceContext({
        kind: "album",
        spotifyId: "https://open.spotify.com/album/1",
        displayName: "Album",
      }),
    ).toBeNull();
    expect(
      parseChallengeSourceContext({
        kind: ["album", "playlist"],
        spotifyId: "album_1",
        displayName: "Album",
      }),
    ).toBeNull();
  });

  it("accepts and canonicalizes the public playlist source DTO", () => {
    const source = parseChallengeSourceContext({
      kind: "public-playlist",
      spotifyId: "playlist_1",
      displayName: "Public mix",
      canonicalUrl:
        "  https://OPEN.spotify.com/playlist/playlist_1/?si=ignored#fragment  ",
    });

    expect(source).toEqual({
      kind: "public-playlist",
      spotifyId: "playlist_1",
      displayName: "Public mix",
      canonicalUrl: "https://open.spotify.com/playlist/playlist_1",
    });
    expect(createChallengeIntroUrl(source!)).toBe(
      "/play?kind=public-playlist&spotifyId=playlist_1&displayName=Public+mix&canonicalUrl=https%3A%2F%2Fopen.spotify.com%2Fplaylist%2Fplaylist_1",
    );
    expect(
      parseChallengeSourceContext({
        kind: "public-playlist",
        spotifyId: "playlist_1",
        canonicalUrl: "https://open.spotify.com/playlist/other",
      }),
    ).toBeNull();
    expect(
      parseChallengeEnvelope({
        ...challengeEnvelope(),
        challenge: {
          ...challengeEnvelope().challenge,
          source: {
            kind: "public-playlist",
            spotifyId: "playlist_1",
            canonicalUrl: "https://open.spotify.com/playlist/playlist_1",
          },
        },
      }),
    ).not.toBeNull();
  });

  it("canonicalizes only supported public playlist links", () => {
    expect(
      canonicalizePublicPlaylistInput(
        " https://open.spotify.com/playlist/playlist_1/?si=share#top ",
      ),
    ).toBe("https://open.spotify.com/playlist/playlist_1");

    for (const value of [
      "https://spotify.link/playlist_1",
      "spotify:playlist:playlist_1",
      "http://open.spotify.com/playlist/playlist_1",
      "https://open.spotify.com/album/album_1",
      "https://open.spotify.com/playlist/playlist_1/extra",
      "https://open.spotify.com/playlist/playlist%5F1",
    ]) {
      expect(canonicalizePublicPlaylistInput(value)).toBeNull();
    }
  });

  it("creates and hydrates a challenge using same-origin no-store requests", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(challengeEnvelope()), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(challengeEnvelope()), { status: 200 }),
      );

    const created = await createChallenge(
      { kind: "album", spotifyId: "album_1", displayName: "Album One" },
      { fetch: fetchMock },
    );
    const hydrated = await getChallenge(challengeId, { fetch: fetchMock });

    expect(created.id).toBe(challengeId);
    expect(hydrated.id).toBe(challengeId);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/challenges");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      source: {
        kind: "album",
        spotifyId: "album_1",
        displayName: "Album One",
      },
      targetCount: 5,
    });
    expect(fetchMock.mock.calls[1][0]).toBe(
      `/api/challenges/${challengeId}`,
    );
  });

  it("parses only the reduced YouTube playback DTO", () => {
    const available = {
      playback: {
        provider: "youtube",
        status: "available",
        videoId: "dQw4w9WgXcQ",
        startAtMs: 8_500,
      },
    };
    const unavailable = {
      playback: {
        provider: "youtube",
        status: "unavailable",
        reason: "low-confidence",
      },
    };

    expect(parseChallengePlaybackResponse(available)).toEqual(available);
    expect(parseChallengePlaybackResponse(unavailable)).toEqual(unavailable);

    for (const value of [
      {
        playback: {
          provider: "youtube",
          status: "available",
          videoId: "dQw4w9WgXcQ",
          startAtMs: 8_500,
          url: "https://youtube.com/watch?v=dQw4w9WgXcQ",
        },
      },
      {
        playback: {
          provider: "youtube",
          status: "available",
          videoId: "dQw4w9WgXcQ",
        },
      },
      {
        playback: {
          provider: "youtube",
          status: "available",
          videoId: "dQw4w9WgXcQ",
          startAtMs: -1,
        },
      },
      {
        playback: {
          provider: "spotify",
          status: "available",
          videoId: "dQw4w9WgXcQ",
        },
      },
      {
        playback: {
          provider: "youtube",
          status: "available",
          videoId: "too-short",
          startAtMs: 8_500,
        },
      },
      {
        playback: {
          provider: "youtube",
          status: "unavailable",
          reason: "provider-error",
        },
      },
      {
        playback: {
          provider: "youtube",
          status: "unavailable",
          reason: "unavailable",
          detail: "raw provider response",
        },
      },
      { playback: available.playback, extra: "unknown" },
    ]) {
      expect(parseChallengePlaybackResponse(value)).toBeNull();
    }
  });

  it("requests playback by opaque IDs with an empty body and no-store semantics", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          playback: {
            provider: "youtube",
            status: "available",
            videoId: "dQw4w9WgXcQ",
            startAtMs: 8_500,
          },
        }),
        { status: 200 },
      ),
    );

    const playback = await requestChallengePlayback(
      challengeId,
      questionId,
      { fetch: fetchMock },
    );

    expect(playback).toEqual({
      provider: "youtube",
      status: "available",
      videoId: "dQw4w9WgXcQ",
      startAtMs: 8_500,
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/challenges/${challengeId}/questions/${questionId}/playback`,
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: "{}",
      credentials: "same-origin",
      cache: "no-store",
    });
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      Accept: "application/json",
      "Content-Type": "application/json",
    });
  });

  it("accepts only the metadata-free warmup acknowledgement", () => {
    const accepted = {
      warmup: { provider: "youtube", status: "accepted" },
    };

    expect(parseChallengePlaybackWarmupResponse(accepted)).toEqual(accepted);
    expect(
      parseChallengePlaybackWarmupResponse({
        warmup: {
          provider: "youtube",
          status: "accepted",
          videoId: "AbCdEfGhIjK",
        },
      }),
    ).toBeNull();
    expect(
      parseChallengePlaybackWarmupResponse({
        warmup: { provider: "youtube", status: "resolved" },
      }),
    ).toBeNull();
    expect(
      parseChallengePlaybackWarmupResponse({
        warmup: { provider: "spotify", status: "accepted" },
      }),
    ).toBeNull();
    expect(
      parseChallengePlaybackWarmupResponse({ ...accepted, title: "private" }),
    ).toBeNull();
  });

  it("requests warmup by opaque IDs with no client-selected playback data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          warmup: { provider: "youtube", status: "accepted" },
        }),
        { status: 202 },
      ),
    );

    const warmup = await requestChallengePlaybackWarmup(
      challengeId,
      questionId,
      { fetch: fetchMock },
    );

    expect(warmup).toEqual({ provider: "youtube", status: "accepted" });
    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/challenges/${challengeId}/questions/${questionId}/playback/warmup`,
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: "{}",
      credentials: "same-origin",
      cache: "no-store",
    });
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      Accept: "application/json",
      "Content-Type": "application/json",
    });
  });

  it("keeps playback route errors and malformed responses typed", async () => {
    const routeError = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "QUESTION_NOT_ACTIVE" }), {
        status: 409,
      }),
    );
    const malformed = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ playback: { provider: "youtube" } }), {
        status: 200,
      }),
    );

    await expect(
      requestChallengePlayback(challengeId, questionId, { fetch: routeError }),
    ).rejects.toMatchObject({ code: "QUESTION_NOT_ACTIVE", status: 409 });
    await expect(
      requestChallengePlayback(challengeId, questionId, { fetch: malformed }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(
      requestChallengePlayback("bad", questionId, { fetch: routeError }),
    ).rejects.toMatchObject({ code: "CHALLENGE_NOT_FOUND", status: 404 });
  });

  it("creates a public challenge with canonical URL and same-origin no-store semantics", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ...challengeEnvelope(),
          challenge: {
            ...challengeEnvelope().challenge,
            source: {
              kind: "public-playlist",
              spotifyId: "playlist_1",
              displayName: "Public mix",
              canonicalUrl:
                "https://open.spotify.com/playlist/playlist_1",
            },
          },
        }),
        { status: 201 },
      ),
    );

    const challenge = await createPublicPlaylistChallenge(
      "https://open.spotify.com/playlist/playlist_1/?si=ignored",
      { fetch: fetchMock },
    );

    expect(challenge.source.kind).toBe("public-playlist");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/public-playlists/challenge",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      url: "https://open.spotify.com/playlist/playlist_1",
    });
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      Accept: "application/json",
      "Content-Type": "application/json",
    });
  });

  it("maps public provider errors to safe stable copy", () => {
    for (const code of [
      "PUBLIC_PLAYLIST_PRIVATE",
      "PUBLIC_PLAYLIST_NOT_FOUND",
      "PUBLIC_PLAYLIST_RATE_LIMITED",
      "PUBLIC_PLAYLIST_UNAVAILABLE",
      "PUBLIC_PLAYLIST_INVALID_RESPONSE",
    ] as const) {
      const copy = getChallengeErrorCopy(new ChallengeClientError(code, 502));
      expect(copy.heading).not.toContain(code);
      expect(copy.detail).not.toContain("provider");
      expect(copy.reconnect).toBe(false);
    }
  });

  it("reduces provider and malformed payload errors to typed client errors", async () => {
    const providerFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "LYRICS_RATE_LIMITED" }), {
        status: 429,
      }),
    );
    const malformedFetch = vi
      .fn()
      .mockResolvedValue(new Response("not-json", { status: 200 }));

    await expect(
      createChallenge(
        { kind: "album", spotifyId: "album_1", displayName: "Album" },
        { fetch: providerFetch },
      ),
    ).rejects.toMatchObject({ code: "LYRICS_RATE_LIMITED", status: 429 });
    await expect(getChallenge(challengeId, { fetch: malformedFetch })).rejects
      .toBeInstanceOf(ChallengeClientError);
  });

  it("parses and submits continuing guesses without adding unknown answers", async () => {
    const response = {
      result: "continue",
      questionId,
      attempt: 2,
      maxAttempts: 4,
      status: "active",
      progress: { solved: 1, revealed: 4, totalAnswerTokens: 8 },
      lines: [solvedLine(0), line(1), line(2), line(3)],
      hiddenTokenIds: ["l1t0", "l2t0", "l3t0"],
      questionCount: 1,
      completedQuestionCount: 0,
      complete: false,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), { status: 200 }),
    );

    expect(parseGuessResponse(response)?.result).toBe("continue");
    const result = await submitChallengeGuess(
      challengeId,
      questionId,
      { l0t0: "answer" },
      { fetch: fetchMock },
    );

    expect(result.result).toBe("continue");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      answers: { l0t0: "answer" },
    });
  });

  it("requires the title hint only for an active fourth-attempt continuation", () => {
    const response = {
      result: "continue",
      questionId,
      attempt: 4,
      maxAttempts: 4,
      status: "active",
      titleHint: "Hidden Track",
      progress: { solved: 1, revealed: 4, totalAnswerTokens: 8 },
      lines: [solvedLine(0), line(1), line(2), line(3)],
      hiddenTokenIds: ["l1t0", "l2t0", "l3t0"],
      questionCount: 1,
      completedQuestionCount: 0,
      complete: false,
    };

    expect(parseGuessResponse(response)).toMatchObject({
      result: "continue",
      attempt: 4,
      titleHint: "Hidden Track",
    });

    const missingTitle = { ...response } as Record<string, unknown>;
    delete missingTitle.titleHint;
    expect(parseGuessResponse(missingTitle)).toBeNull();

    const earlyTitle = { ...response, attempt: 3 };
    expect(parseGuessResponse(earlyTitle)).toBeNull();
  });

  it("stores only the bounded recovery pointer and clears it", () => {
    const storage = createStorage();
    const pointer = {
      challengeId,
      currentQuestionIndex: 0,
      updatedAt: 123_456,
    };

    saveRecoveryPointer(storage, pointer);
    expect(readRecoveryPointer(storage)).toEqual(pointer);
    expect(storage.values.get(CHALLENGE_RECOVERY_STORAGE_KEY)).not.toContain(
      "lyrics",
    );

    clearRecoveryPointer(storage);
    expect(readRecoveryPointer(storage)).toBeNull();
  });
});
