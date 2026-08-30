import { afterEach, describe, expect, it, vi } from "vitest";

const {
  cookiesMock,
  getServerEnvironmentMock,
  refreshAccessTokenMock,
  authorizeChallengeSourceMock,
  buildChallengeCandidatesMock,
} = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  getServerEnvironmentMock: vi.fn(),
  refreshAccessTokenMock: vi.fn(),
  authorizeChallengeSourceMock: vi.fn(),
  buildChallengeCandidatesMock: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("../../../lib/env", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/env")>(
    "../../../lib/env",
  );
  return { ...actual, getServerEnvironment: getServerEnvironmentMock };
});
vi.mock("../../../lib/auth/spotify", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/auth/spotify")>(
    "../../../lib/auth/spotify",
  );
  return { ...actual, refreshAccessToken: refreshAccessTokenMock };
});
vi.mock("../../../lib/challenge/source-authorization", async () => {
  const actual = await vi.importActual<
    typeof import("../../../lib/challenge/source-authorization")
  >("../../../lib/challenge/source-authorization");
  return {
    ...actual,
    authorizeChallengeSource: authorizeChallengeSourceMock,
  };
});
vi.mock("../../../lib/challenge/challenge-candidates", async () => {
  const actual = await vi.importActual<
    typeof import("../../../lib/challenge/challenge-candidates")
  >("../../../lib/challenge/challenge-candidates");
  return { ...actual, buildChallengeCandidates: buildChallengeCandidatesMock };
});

import { POST as createChallenge } from "./route";
import { encryptSession, AUTH_SESSION_COOKIE_NAME } from "../../../lib/auth/session";
import { SourceAuthorizationError } from "../../../lib/challenge/source-authorization";
import { resetChallengeStore } from "../../../lib/challenge/challenge-store";
import type { ChallengeCandidateResult } from "../../../lib/challenge/challenge-candidates";
import type { FourLineLyricWindow } from "../../../types/game";

const sessionSecret = "unit-test-session-secret-with-at-least-32-chars";
const serverEnvironment = {
  SPOTIFY_CLIENT_ID: "client-id",
  SPOTIFY_CLIENT_SECRET: "client-secret",
  SPOTIFY_REDIRECT_URI:
    "http://127.0.0.1:3000/api/auth/spotify/callback",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
  AUTH_SESSION_SECRET: sessionSecret,
} as const;

function candidateResult(count = 1): ChallengeCandidateResult {
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
          { timestampMs: 10_000, text: "Maybe we got lost in translation" },
          { timestampMs: 12_000, text: "Maybe I asked for too much" },
          { timestampMs: 14_000, text: "But maybe this thing was a masterpiece" },
          { timestampMs: 16_000, text: "Until you tore it all up" },
        ] as FourLineLyricWindow,
      })),
    ),
    tracksScanned: count,
    sourceTruncated: false,
    lyricScanLimitReached: false,
  });
}

function insufficientResult(): ChallengeCandidateResult {
  return Object.freeze({
    status: "insufficient_lyrics" as const,
    candidates: Object.freeze([]) as readonly [],
    tracksScanned: 2,
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

function validAlbumBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    source: {
      kind: "album",
      spotifyId: "album-1",
      displayName: "Album",
    },
    ...overrides,
  });
}

function validPlaylistBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    source: {
      kind: "playlist",
      spotifyId: "playlist-1",
      displayName: "Playlist",
    },
    ...overrides,
  });
}

function jsonRequest(body: string): Request {
  return new Request("http://127.0.0.1:3000/api/challenges", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

afterEach(() => {
  cookiesMock.mockReset();
  getServerEnvironmentMock.mockReset();
  refreshAccessTokenMock.mockReset();
  authorizeChallengeSourceMock.mockReset();
  buildChallengeCandidatesMock.mockReset();
  resetChallengeStore();
  vi.restoreAllMocks();
});

describe("POST /api/challenges", () => {
  it("rejects malformed input before reading auth or calling providers", async () => {
    const response = await createChallenge(
      jsonRequest(
        JSON.stringify({
          source: {
            kind: "album",
            spotifyId: "https://open.spotify.com/album/album-1",
            displayName: "Album",
          },
          unexpected: true,
        }),
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_INPUT" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(cookiesMock).not.toHaveBeenCalled();
    expect(authorizeChallengeSourceMock).not.toHaveBeenCalled();
    expect(buildChallengeCandidatesMock).not.toHaveBeenCalled();
  });

  it("requires the encrypted session and does no provider work when unauthenticated", async () => {
    cookiesMock.mockResolvedValue({ get: vi.fn() });

    const response = await createChallenge(
      jsonRequest(validAlbumBody()),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "SPOTIFY_AUTH_REQUIRED",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(authorizeChallengeSourceMock).not.toHaveBeenCalled();
    expect(buildChallengeCandidatesMock).not.toHaveBeenCalled();
  });

  it("authorizes an album before bounded candidate construction and returns a masked no-store DTO", async () => {
    getServerEnvironmentMock.mockReturnValue(serverEnvironment);
    setCookie();
    authorizeChallengeSourceMock.mockResolvedValue({
      kind: "album",
      spotifyId: "album-1",
      name: "Album",
    });
    buildChallengeCandidatesMock.mockResolvedValue(candidateResult());

    const response = await createChallenge(
      jsonRequest(validAlbumBody({ seed: "fixed-seed", targetCount: 1 })),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.challenge.source).toEqual({
      kind: "album",
      spotifyId: "album-1",
      displayName: "Album",
    });
    expect(body.challenge.seed).toBe("fixed-seed");
    expect(body.challenge.questionCount).toBe(1);
    expect(body.challenge.questions[0].attempt).toBe(1);
    expect(body.challenge.questions[0].lines).toHaveLength(4);
    expect(body.challenge.questions[0].lines[0].tokens).toBeDefined();
    expect(JSON.stringify(body)).not.toContain("normalized");
    expect(JSON.stringify(body)).not.toContain("candidateWindows");
    expect(JSON.stringify(body)).not.toContain("durationMs");
    expect(JSON.stringify(body)).not.toContain("server-access-token");
    expect(JSON.stringify(body)).not.toContain("server-refresh-token");

    for (const line of body.challenge.questions[0].lines) {
      for (const token of line.tokens) {
        if (token.state === "hidden") {
          expect(token.text).toMatch(/^_+$/u);
        }
      }
    }


    expect(authorizeChallengeSourceMock).toHaveBeenCalledWith({
      source: {
        kind: "album",
        spotifyId: "album-1",
        displayName: "Album",
      },
      accessToken: "server-access-token",
    });
    expect(buildChallengeCandidatesMock).toHaveBeenCalledWith({
      source: {
        kind: "album",
        spotifyId: "album-1",
        name: "Album",
      },
      accessToken: "server-access-token",
      seed: "fixed-seed",
      targetCount: 1,
      lyricsOptions: { clientIdentifier: "fillthelyrics/0.1.0" },
    });
    expect(authorizeChallengeSourceMock.mock.invocationCallOrder[0]).toBeLessThan(
      buildChallengeCandidatesMock.mock.invocationCallOrder[0],
    );
  });

  it("supports playlist sources and keeps presentation metadata separate from authorization", async () => {
    getServerEnvironmentMock.mockReturnValue(serverEnvironment);
    setCookie();
    authorizeChallengeSourceMock.mockResolvedValue({
      kind: "playlist",
      spotifyId: "playlist-1",
    });
    buildChallengeCandidatesMock.mockResolvedValue(candidateResult(2));

    const response = await createChallenge(
      jsonRequest(validPlaylistBody({ targetCount: 2 })),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.challenge.source).toEqual({
      kind: "playlist",
      spotifyId: "playlist-1",
      displayName: "Playlist",
    });
    expect(body.challenge.questionCount).toBe(2);
    expect(buildChallengeCandidatesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { kind: "playlist", spotifyId: "playlist-1" },
      }),
    );
  });

  it("returns a stable insufficient-lyrics response without storing an empty challenge", async () => {
    getServerEnvironmentMock.mockReturnValue(serverEnvironment);
    setCookie();
    authorizeChallengeSourceMock.mockResolvedValue({
      kind: "album",
      spotifyId: "album-1",
      name: "Album",
    });
    buildChallengeCandidatesMock.mockResolvedValue(insufficientResult());

    const response = await createChallenge(jsonRequest(validAlbumBody()));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "INSUFFICIENT_LYRICS" });
  });

  it("maps false membership to a neutral forbidden error", async () => {
    getServerEnvironmentMock.mockReturnValue(serverEnvironment);
    setCookie();
    authorizeChallengeSourceMock.mockRejectedValue(
      new SourceAuthorizationError("not_in_library"),
    );

    const response = await createChallenge(jsonRequest(validAlbumBody()));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "SOURCE_NOT_IN_LIBRARY" });
    expect(buildChallengeCandidatesMock).not.toHaveBeenCalled();
  });

  it("clears an invalid session without exposing auth details", async () => {
    getServerEnvironmentMock.mockReturnValue(serverEnvironment);
    setCookie("not-a-session");

    const response = await createChallenge(jsonRequest(validAlbumBody()));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "SPOTIFY_AUTH_REQUIRED",
    });
    expect(response.headers.get("set-cookie")).toContain(
      `${AUTH_SESSION_COOKIE_NAME}=`,
    );
    expect(authorizeChallengeSourceMock).not.toHaveBeenCalled();
  });

  it("refreshes an expiring session and sets only the encrypted replacement cookie", async () => {
    getServerEnvironmentMock.mockReturnValue(serverEnvironment);
    setCookie(sessionCookie(Date.now() + 10_000));
    refreshAccessTokenMock.mockResolvedValue({
      accessToken: "refreshed-access-token",
      refreshToken: "refreshed-refresh-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    authorizeChallengeSourceMock.mockResolvedValue({
      kind: "album",
      spotifyId: "album-1",
      name: "Album",
    });
    buildChallengeCandidatesMock.mockResolvedValue(candidateResult());

    const response = await createChallenge(jsonRequest(validAlbumBody()));
    const body = await response.json();
    const setCookieHeader = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(201);
    expect(refreshAccessTokenMock).toHaveBeenCalledTimes(1);
    expect(setCookieHeader).toContain(`${AUTH_SESSION_COOKIE_NAME}=`);
    expect(JSON.stringify(body)).not.toContain("refreshed-access-token");
    expect(setCookieHeader).not.toContain("refreshed-access-token");
    expect(setCookieHeader).not.toContain("refreshed-refresh-token");
  });

  it("rejects oversized bodies before provider calls", async () => {
    const response = await createChallenge(
      new Request("http://127.0.0.1:3000/api/challenges", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "999999",
        },
        body: validAlbumBody(),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_INPUT" });
    expect(cookiesMock).not.toHaveBeenCalled();
  });
});
