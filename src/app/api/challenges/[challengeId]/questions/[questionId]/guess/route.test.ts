import { afterEach, describe, expect, it, vi } from "vitest";

const {
  cookiesMock,
  getServerEnvironmentMock,
  refreshAccessTokenMock,
} = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  getServerEnvironmentMock: vi.fn(),
  refreshAccessTokenMock: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("../../../../../../../lib/env", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../../../../lib/env")
  >("../../../../../../../lib/env");
  return { ...actual, getServerEnvironment: getServerEnvironmentMock };
});
vi.mock("../../../../../../../lib/auth/spotify", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../../../../lib/auth/spotify")
  >("../../../../../../../lib/auth/spotify");
  return { ...actual, refreshAccessToken: refreshAccessTokenMock };
});

import { POST as submitGuess } from "./route";
import {
  AUTH_SESSION_COOKIE_NAME,
  encryptSession,
} from "../../../../../../../lib/auth/session";
import {
  challengeStore,
  resetChallengeStore,
} from "../../../../../../../lib/challenge/challenge-store";
import type { ChallengeCandidateResult } from "../../../../../../../lib/challenge/challenge-candidates";
import type { FourLineLyricWindow } from "../../../../../../../types/game";

const sessionSecret = "unit-test-session-secret-with-at-least-32-chars";
const serverEnvironment = {
  SPOTIFY_CLIENT_ID: "client-id",
  SPOTIFY_CLIENT_SECRET: "client-secret",
  SPOTIFY_REDIRECT_URI:
    "http://127.0.0.1:3000/api/auth/spotify/callback",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
  AUTH_SESSION_SECRET: sessionSecret,
} as const;

function candidates(): ChallengeCandidateResult {
  return Object.freeze({
    status: "ready" as const,
    candidates: Object.freeze([
      {
        track: {
          spotifyId: "track-1",
          name: "Track One",
          artistNames: ["Artist"],
          durationMs: 180_000,
        },
        window: [
          { timestampMs: 10_000, text: "Maybe we got lost in translation" },
          { timestampMs: 12_000, text: "Maybe I asked for too much" },
          { timestampMs: 14_000, text: "But maybe this thing was a masterpiece" },
          { timestampMs: 16_000, text: "Until you tore it all up" },
        ] as FourLineLyricWindow,
      },
    ]),
    tracksScanned: 1,
    sourceTruncated: false,
    lyricScanLimitReached: false,
  });
}

function sessionCookie(
  expiresAt = Date.now() + 60 * 60 * 1000,
): string {
  return encryptSession(
    {
      accessToken: "server-access-token",
      refreshToken: "server-refresh-token",
      expiresAt,
    },
    sessionSecret,
  );
}

function setCookie(value = sessionCookie()): void {
  cookiesMock.mockResolvedValue({
    get: vi.fn((name: string) =>
      name === AUTH_SESSION_COOKIE_NAME ? { value } : undefined,
    ),
  });
}

function createChallenge() {
  return challengeStore.create({
    source: {
      kind: "album",
      spotifyId: "album-1",
      displayName: "Album",
    },
    seed: "guess-seed",
    candidates: candidates(),
  });
}

function createPublicChallenge() {
  return challengeStore.create({
    source: {
      kind: "public-playlist",
      spotifyId: "playlist-public-1",
      displayName: "Public playlist",
      canonicalUrl:
        "https://open.spotify.com/playlist/playlist-public-1",
    },
    seed: "public-guess-seed",
    candidates: candidates(),
  });
}

function guessRequest(answers: Record<string, string>): Request {
  return new Request("http://127.0.0.1:3000/api/challenges/guess", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
  });
}

function routeParams(challengeId: string, questionId: string) {
  return {
    params: Promise.resolve({ challengeId, questionId }),
  };
}

function hiddenAnswers(challengeId: string, questionId: string): Record<string, string> {
  const question = challengeStore.get(challengeId).questions.find(
    (candidate) => candidate.id === questionId,
  );

  if (question === undefined) {
    throw new Error("Expected challenge question.");
  }

  return Object.fromEntries(
    question.window
      .flatMap((line) => line.tokens)
      .filter((token) => token.isWord && token.state === "hidden")
      .map((token) => [token.id, token.raw]),
  );
}

afterEach(() => {
  cookiesMock.mockReset();
  getServerEnvironmentMock.mockReset();
  refreshAccessTokenMock.mockReset();
  resetChallengeStore();
  vi.restoreAllMocks();
});

describe("POST /api/challenges/:challengeId/questions/:questionId/guess", () => {
  it("accepts a public-playlist guess without an OAuth session", async () => {
    const challenge = createPublicChallenge();
    const question = challenge.questions[0];

    if (question === undefined) {
      throw new Error("Expected challenge question.");
    }

    const response = await submitGuess(
      guessRequest({}),
      routeParams(challenge.id, question.id),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).result).toBe("continue");
    expect(cookiesMock).not.toHaveBeenCalled();
    expect(getServerEnvironmentMock).not.toHaveBeenCalled();
  });

  it("requires an encrypted session and does not inspect challenge state", async () => {
    cookiesMock.mockResolvedValue({ get: vi.fn() });

    const response = await submitGuess(
      guessRequest({}),
      routeParams("missing-challenge", "missing-question"),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "SPOTIFY_AUTH_REQUIRED",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects malformed or oversized guess records before authentication", async () => {
    const malformed = await submitGuess(
      new Request("http://127.0.0.1:3000/api/challenges/guess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "answer" }),
      }),
      routeParams("missing-challenge", "missing-question"),
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "INVALID_GUESS" });
    expect(cookiesMock).not.toHaveBeenCalled();

    const tooMany: Record<string, string> = {};
    for (let index = 0; index < 129; index += 1) {
      tooMany[`token-${index}`] = "answer";
    }

    const oversized = await submitGuess(
      guessRequest(tooMany),
      routeParams("missing-challenge", "missing-question"),
    );
    expect(oversized.status).toBe(400);
    expect(await oversized.json()).toEqual({ error: "INVALID_GUESS" });
    expect(cookiesMock).not.toHaveBeenCalled();
  });

  it("retains solved words across a continuing attempt and returns only masked state", async () => {
    getServerEnvironmentMock.mockReturnValue(serverEnvironment);
    setCookie();
    const challenge = createChallenge();
    const question = challenge.questions[0];
    const hidden = question.window
      .flatMap((line) => line.tokens)
      .find((token) => token.isWord && token.state === "hidden");

    expect(hidden).toBeDefined();
    const response = await submitGuess(
      guessRequest({ [hidden?.id ?? ""]: hidden?.raw ?? "" }),
      routeParams(challenge.id, question.id),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.result).toBe("continue");
    expect(body.attempt).toBe(2);
    expect(body.progress.solved).toBeGreaterThanOrEqual(1);
    expect(body.lines).toHaveLength(4);
    expect(JSON.stringify(body)).not.toContain("normalized");
    expect(JSON.stringify(body)).not.toContain("Track One");
    expect(JSON.stringify(body)).not.toContain("server-access-token");
    expect(JSON.stringify(body)).not.toContain("server-refresh-token");

    const retained = challengeStore
      .get(challenge.id)
      .questions[0]
      .window.flatMap((line) => line.tokens)
      .find((token) => token.id === hidden?.id);
    expect(retained?.state).toBe("solved");
  });

  it("solves a question and returns exactly its four selected lines and metadata", async () => {
    getServerEnvironmentMock.mockReturnValue(serverEnvironment);
    setCookie();
    const challenge = createChallenge();
    const question = challenge.questions[0];
    const response = await submitGuess(
      guessRequest(hiddenAnswers(challenge.id, question.id)),
      routeParams(challenge.id, question.id),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result).toBe("solved");
    expect(body.attemptsUsed).toBe(1);
    expect(body.reveal).toEqual({
      lines: [
        "Maybe we got lost in translation",
        "Maybe I asked for too much",
        "But maybe this thing was a masterpiece",
        "Until you tore it all up",
      ],
      trackName: "Track One",
      artistNames: ["Artist"],
      startTimestampMs: 10_000,
    });
    expect(JSON.stringify(body)).not.toContain("candidateWindows");
    expect(JSON.stringify(body)).not.toContain("durationMs");
  });

  it("progresses through four attempts and reveals the selected fragment on final failure", async () => {
    getServerEnvironmentMock.mockReturnValue(serverEnvironment);
    setCookie();
    const challenge = createChallenge();
    const question = challenge.questions[0];
    const results: string[] = [];

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await submitGuess(
        guessRequest({}),
        routeParams(challenge.id, question.id),
      );
      const body = await response.json();
      results.push(body.result);

      if (attempt < 4) {
        expect(body.attempt).toBe(attempt + 1);
      } else {
        expect(body.attemptsUsed).toBe(4);
        expect(body.reveal.lines).toHaveLength(4);
      }
    }

    expect(results).toEqual(["continue", "continue", "continue", "failed"]);
  });

  it("maps invalid token IDs, finished questions, stale IDs, and does not echo answers", async () => {
    getServerEnvironmentMock.mockReturnValue(serverEnvironment);
    setCookie();
    const challenge = createChallenge();
    const question = challenge.questions[0];
    const secretAnswer = "user-secret-answer";

    const invalid = await submitGuess(
      guessRequest({ "unknown-token": secretAnswer }),
      routeParams(challenge.id, question.id),
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "INVALID_GUESS" });
    expect((await invalid.text().catch(() => ""))).not.toContain(secretAnswer);

    const solved = await submitGuess(
      guessRequest(hiddenAnswers(challenge.id, question.id)),
      routeParams(challenge.id, question.id),
    );
    expect(solved.status).toBe(200);

    const finished = await submitGuess(
      guessRequest({}),
      routeParams(challenge.id, question.id),
    );
    expect(finished.status).toBe(409);
    expect(await finished.json()).toEqual({ error: "QUESTION_NOT_ACTIVE" });

    const missing = await submitGuess(
      guessRequest({}),
      routeParams("missing-challenge", "missing-question"),
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "CHALLENGE_NOT_FOUND" });
  });

  it("refreshes an expiring session without exposing its values", async () => {
    getServerEnvironmentMock.mockReturnValue(serverEnvironment);
    setCookie(sessionCookie(Date.now() + 10_000));
    refreshAccessTokenMock.mockResolvedValue({
      accessToken: "refreshed-access-token",
      refreshToken: "refreshed-refresh-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    const challenge = createChallenge();
    const question = challenge.questions[0];

    const response = await submitGuess(
      guessRequest({}),
      routeParams(challenge.id, question.id),
    );
    const setCookieHeader = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(200);
    expect(refreshAccessTokenMock).toHaveBeenCalledTimes(1);
    expect(setCookieHeader).toContain(`${AUTH_SESSION_COOKIE_NAME}=`);
    expect(setCookieHeader).not.toContain("refreshed-access-token");
    expect(setCookieHeader).not.toContain("refreshed-refresh-token");
  });
});
