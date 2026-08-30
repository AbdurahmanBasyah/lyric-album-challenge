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
vi.mock("../../../../lib/env", async () => {
  const actual = await vi.importActual<typeof import("../../../../lib/env")>(
    "../../../../lib/env",
  );
  return { ...actual, getServerEnvironment: getServerEnvironmentMock };
});
vi.mock("../../../../lib/auth/spotify", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../lib/auth/spotify")
  >( "../../../../lib/auth/spotify");
  return { ...actual, refreshAccessToken: refreshAccessTokenMock };
});

import { GET as getChallenge } from "./route";
import {
  AUTH_SESSION_COOKIE_NAME,
  encryptSession,
} from "../../../../lib/auth/session";
import {
  challengeStore,
  ChallengeStoreError,
} from "../../../../lib/challenge/challenge-store";
import type { ChallengeCandidateResult } from "../../../../lib/challenge/challenge-candidates";
import type { FourLineLyricWindow } from "../../../../types/game";

const sessionSecret = "unit-test-session-secret-with-at-least-32-chars";
const serverEnvironment = {
  SPOTIFY_CLIENT_ID: "client-id",
  SPOTIFY_CLIENT_SECRET: "client-secret",
  SPOTIFY_REDIRECT_URI:
    "http://127.0.0.1:3000/api/auth/spotify/callback",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
  AUTH_SESSION_SECRET: sessionSecret,
} as const;

const lineTexts = [
  "aegisquartz emberviolet nocturnefinch riveropal",
  "velvetorbit coppermeadow lanternsable monsoonivory",
  "papercomet amberlattice silverthistle cloudmarble",
  "quietcinder mossyharbor wintercobalt sunlitcedar",
] as const;

function candidateResult(): ChallengeCandidateResult {
  return Object.freeze({
    status: "ready" as const,
    candidates: Object.freeze([
      {
        track: {
          spotifyId: "track-1",
          name: "Hidden Track",
          artistNames: ["Artist"],
          durationMs: 180_000,
        },
        window: lineTexts.map((text, index) => ({
          timestampMs: (index + 1) * 1_000,
          text,
        })) as FourLineLyricWindow,
      },
    ]),
    tracksScanned: 1,
    sourceTruncated: false,
    lyricScanLimitReached: false,
  });
}

function sessionCookie(
  expiresAt = Date.now() + 60 * 60 * 1000,
  accessToken = "server-access-token",
  refreshToken = "server-refresh-token",
): string {
  return encryptSession(
    { accessToken, refreshToken, expiresAt },
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

function routeContext(value: unknown): {
  params: Promise<{ challengeId: string }>;
} {
  return {
    params: Promise.resolve({ challengeId: value } as { challengeId: string }),
  };
}

function createStoredChallenge() {
  return challengeStore.create({
    source: {
      kind: "album",
      spotifyId: "album-1",
      displayName: "Album",
    },
    seed: "recovery-seed",
    candidates: candidateResult(),
  });
}

function createPublicStoredChallenge() {
  return challengeStore.create({
    source: {
      kind: "public-playlist",
      spotifyId: "playlist-public-1",
      displayName: "Public playlist",
      canonicalUrl:
        "https://open.spotify.com/playlist/playlist-public-1",
    },
    seed: "public-recovery-seed",
    candidates: candidateResult(),
  });
}

function solveStoredQuestion(challengeId: string): void {
  const challenge = challengeStore.get(challengeId);
  const question = challenge.questions[0];

  if (!question) {
    throw new Error("Test challenge is missing a question.");
  }

  const answers = Object.fromEntries(
    question.window
      .flatMap((line) => line.tokens)
      .filter((token) => token.isWord && token.state === "hidden")
      .map((token) => [token.id, token.raw]),
  );

  challengeStore.guess(challenge.id, question.id, answers);
}

afterEach(() => {
  cookiesMock.mockReset();
  getServerEnvironmentMock.mockReset();
  refreshAccessTokenMock.mockReset();
  challengeStore.reset();
  vi.restoreAllMocks();
});

describe("GET /api/challenges/:challengeId", () => {
  it("returns a public-playlist challenge without an OAuth session", async () => {
    const challenge = createPublicStoredChallenge();

    const response = await getChallenge(
      new Request(
        `http://127.0.0.1:3000/api/challenges/${challenge.id}`,
      ),
      routeContext(challenge.id),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).challenge.source).toEqual({
      kind: "public-playlist",
      spotifyId: "playlist-public-1",
      displayName: "Public playlist",
      canonicalUrl:
        "https://open.spotify.com/playlist/playlist-public-1",
    });
    expect(cookiesMock).not.toHaveBeenCalled();
    expect(getServerEnvironmentMock).not.toHaveBeenCalled();
  });

  it("requires the encrypted session and performs no provider work when unauthenticated", async () => {
    cookiesMock.mockResolvedValue({ get: vi.fn() });

    const response = await getChallenge(
      new Request("http://127.0.0.1:3000/api/challenges/challenge-1"),
      routeContext("challenge-1"),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "SPOTIFY_AUTH_REQUIRED",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(refreshAccessTokenMock).not.toHaveBeenCalled();
  });

  it("maps malformed route parameters to a stable not-found response", async () => {
    getServerEnvironmentMock.mockReturnValue(serverEnvironment);
    setCookie();

    const response = await getChallenge(
      new Request("http://127.0.0.1:3000/api/challenges/bad%2Fid"),
      routeContext("bad/id"),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "CHALLENGE_NOT_FOUND",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("maps unknown and expired handles without exposing raw lookup errors", async () => {
    getServerEnvironmentMock.mockReturnValue(serverEnvironment);
    setCookie();

    const unknownResponse = await getChallenge(
      new Request("http://127.0.0.1:3000/api/challenges/unknown-1"),
      routeContext("unknown-1"),
    );

    expect(unknownResponse.status).toBe(404);
    expect(await unknownResponse.json()).toEqual({
      error: "CHALLENGE_NOT_FOUND",
    });

    const challenge = createStoredChallenge();
    const storeWithClock = challengeStore as unknown as {
      now: () => number;
    };
    const originalNow = storeWithClock.now;
    storeWithClock.now = () => challenge.expiresAt;

    try {
      const expiredResponse = await getChallenge(
        new Request(
          `http://127.0.0.1:3000/api/challenges/${challenge.id}`,
        ),
        routeContext(challenge.id),
      );

      expect(expiredResponse.status).toBe(404);
      expect(await expiredResponse.json()).toEqual({
        error: "CHALLENGE_NOT_FOUND",
      });
      expect(expiredResponse.headers.get("cache-control")).toBe("no-store");
    } finally {
      storeWithClock.now = originalNow;
    }
  });

  it("returns active state as a masked no-store DTO without provider calls or hidden answers", async () => {
    getServerEnvironmentMock.mockReturnValue(serverEnvironment);
    setCookie();
    const challenge = createStoredChallenge();

    const response = await getChallenge(
      new Request(
        `http://127.0.0.1:3000/api/challenges/${challenge.id}`,
      ),
      routeContext(challenge.id),
    );
    const body = await response.json();
    const serialized = JSON.stringify(body);
    const hiddenToken = challenge.questions[0]?.window
      .flatMap((line) => line.tokens)
      .find((token) => token.isWord && token.state === "hidden");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.challenge.id).toBe(challenge.id);
    expect(body.challenge.questions[0].status).toBe("active");
    expect(body.challenge.questions[0].lines).toHaveLength(4);
    expect(body.challenge.questions[0].reveal).toBeUndefined();
    expect(hiddenToken).toBeDefined();
    expect(body.challenge.questions[0].lines.flatMap((line: { tokens: Array<{ state: string; text: string }> }) => line.tokens)
      .filter((token: { state: string }) => token.state === "hidden")
      .every((token: { text: string }) => /^_+$/u.test(token.text)),
    ).toBe(true);
    expect(serialized).not.toContain(hiddenToken?.raw ?? "");
    expect(serialized).not.toContain("normalized");
    expect(serialized).not.toContain("durationMs");
    expect(serialized).not.toContain("trackName");
    expect(serialized).not.toContain("server-access-token");
    expect(serialized).not.toContain("server-refresh-token");
    expect(refreshAccessTokenMock).not.toHaveBeenCalled();
  });

  it("returns the bounded completed reveal while keeping provider credentials out of the DTO", async () => {
    getServerEnvironmentMock.mockReturnValue(serverEnvironment);
    setCookie();
    const challenge = createStoredChallenge();
    solveStoredQuestion(challenge.id);

    const response = await getChallenge(
      new Request(
        `http://127.0.0.1:3000/api/challenges/${challenge.id}`,
      ),
      routeContext(challenge.id),
    );
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.challenge.complete).toBe(true);
    expect(body.challenge.questions[0].status).toBe("solved");
    expect(body.challenge.questions[0].reveal).toMatchObject({
      lines: [...lineTexts],
      trackName: "Hidden Track",
      artistNames: ["Artist"],
      startTimestampMs: 1_000,
    });
    expect(body.challenge.questions[0].reveal.lines).toHaveLength(4);
    expect(serialized).not.toContain("normalized");
    expect(serialized).not.toContain("durationMs");
    expect(serialized).not.toContain("server-access-token");
    expect(serialized).not.toContain("server-refresh-token");
  });

  it("refreshes an expiring session and sets only the encrypted replacement cookie", async () => {
    getServerEnvironmentMock.mockReturnValue(serverEnvironment);
    setCookie(
      sessionCookie(
        Date.now() + 10_000,
        "old-access-token",
        "old-refresh-token",
      ),
    );
    refreshAccessTokenMock.mockResolvedValue({
      accessToken: "refreshed-access-token",
      refreshToken: "refreshed-refresh-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    const challenge = createStoredChallenge();

    const response = await getChallenge(
      new Request(
        `http://127.0.0.1:3000/api/challenges/${challenge.id}`,
      ),
      routeContext(challenge.id),
    );
    const body = await response.json();
    const setCookieHeader = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(200);
    expect(refreshAccessTokenMock).toHaveBeenCalledWith(
      "old-refresh-token",
      serverEnvironment,
    );
    expect(setCookieHeader).toContain(`${AUTH_SESSION_COOKIE_NAME}=`);
    expect(setCookieHeader).not.toContain("old-access-token");
    expect(setCookieHeader).not.toContain("old-refresh-token");
    expect(setCookieHeader).not.toContain("refreshed-access-token");
    expect(setCookieHeader).not.toContain("refreshed-refresh-token");
    expect(JSON.stringify(body)).not.toContain("refreshed-access-token");
  });

  it("clears an invalid session without exposing decryption details", async () => {
    getServerEnvironmentMock.mockReturnValue(serverEnvironment);
    setCookie("not-a-session");

    const response = await getChallenge(
      new Request("http://127.0.0.1:3000/api/challenges/challenge-1"),
      routeContext("challenge-1"),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "SPOTIFY_AUTH_REQUIRED",
    });
    expect(response.headers.get("set-cookie")).toContain(
      `${AUTH_SESSION_COOKIE_NAME}=`,
    );
    expect(refreshAccessTokenMock).not.toHaveBeenCalled();
  });

  it("maps a rejected params promise to the same not-found contract", async () => {
    getServerEnvironmentMock.mockReturnValue(serverEnvironment);
    setCookie();

    const response = await getChallenge(
      new Request("http://127.0.0.1:3000/api/challenges/broken"),
      { params: Promise.reject(new Error("raw route failure")) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      error: "CHALLENGE_NOT_FOUND",
    });
    expect(JSON.stringify(body)).not.toContain(
      "raw route failure",
    );
  });

  it("does not return the store's raw error message for a missing handle", async () => {
    getServerEnvironmentMock.mockReturnValue(serverEnvironment);
    setCookie();
    const getSpy = vi
      .spyOn(challengeStore, "get")
      .mockImplementation(() => {
        throw new ChallengeStoreError("not_found");
      });

    const response = await getChallenge(
      new Request("http://127.0.0.1:3000/api/challenges/missing-1"),
      routeContext("missing-1"),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "CHALLENGE_NOT_FOUND",
    });
    expect(getSpy).toHaveBeenCalledWith("missing-1");
  });
});
