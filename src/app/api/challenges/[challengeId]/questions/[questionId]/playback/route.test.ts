import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChallengeCandidateResult } from "../../../../../../../lib/challenge/challenge-candidates";
import {
  challengeStore,
  resetChallengeStore,
} from "../../../../../../../lib/challenge/challenge-store";
import { encryptSession } from "../../../../../../../lib/auth/session";
import type { FourLineLyricWindow } from "../../../../../../../types/game";
import {
  createPlaybackPostHandler,
  MAX_PLAYBACK_REQUEST_BYTES,
} from "./route";

const sessionSecret = "unit-test-session-secret-with-at-least-32-chars";
const serverEnvironment = {
  SPOTIFY_CLIENT_ID: "client-id",
  SPOTIFY_CLIENT_SECRET: "client-secret",
  SPOTIFY_REDIRECT_URI:
    "http://127.0.0.1:3000/api/auth/spotify/callback",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
  AUTH_SESSION_SECRET: sessionSecret,
  YOUTUBE_API_KEY: undefined,
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

function createChallenge(kind: "album" | "public-playlist" = "public-playlist") {
  return challengeStore.create({
    source:
      kind === "public-playlist"
        ? {
            kind,
            spotifyId: "playlist-public-1",
            displayName: "Public playlist",
            canonicalUrl:
              "https://open.spotify.com/playlist/playlist-public-1",
          }
        : {
            kind,
            spotifyId: "album-1",
            displayName: "Album",
          },
    seed: "playback-seed",
    candidates: candidates(),
  });
}

function finishQuestion(challengeId: string, questionId: string): void {
  const question = challengeStore.getQuestion(challengeId, questionId).question;
  const answers = Object.fromEntries(
    question.window
      .flatMap((line) => line.tokens)
      .filter((token) => token.isWord && token.state === "hidden")
      .map((token) => [token.id, token.raw]),
  );
  challengeStore.guess(challengeId, questionId, answers);
}

function request(body?: string): Request {
  return new Request("http://127.0.0.1:3000/api/playback", {
    method: "POST",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body,
        }),
  });
}

function params(challengeId: string, questionId: string) {
  return { params: Promise.resolve({ challengeId, questionId }) };
}

afterEach(() => {
  resetChallengeStore();
  vi.restoreAllMocks();
});

describe("POST challenge question playback", () => {
  it("returns a high-confidence video for an anonymous public terminal question", async () => {
    const challenge = createChallenge();
    const question = challenge.questions[0];
    if (question === undefined) throw new Error("Expected question");
    finishQuestion(challenge.id, question.id);

    const resolver = {
      resolveTrack: vi.fn().mockResolvedValue({
        status: "resolved",
        videoId: "dQw4w9WgXcQ",
        confidence: 95,
        durationMs: 180_000,
        durationDifferenceMs: 0,
      }),
    };
    const readCookies = vi.fn();
    const response = await createPlaybackPostHandler({
      resolver,
      readCookies,
    })(request(), params(challenge.id, question.id));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      playback: {
        provider: "youtube",
        status: "available",
        videoId: "dQw4w9WgXcQ",
        startAtMs: 8_500,
      },
    });
    expect(resolver.resolveTrack).toHaveBeenCalledWith(
      expect.objectContaining({
        spotifyId: "track-1",
        name: "Track One",
      }),
    );
    expect(readCookies).not.toHaveBeenCalled();
  });

  it("rejects active questions before resolver work", async () => {
    const challenge = createChallenge();
    const question = challenge.questions[0];
    if (question === undefined) throw new Error("Expected question");
    const resolver = { resolveTrack: vi.fn() };

    const response = await createPlaybackPostHandler({ resolver })(
      request(),
      params(challenge.id, question.id),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "QUESTION_NOT_ACTIVE" });
    expect(resolver.resolveTrack).not.toHaveBeenCalled();
  });

  it("enforces the legacy session gate before inspecting private challenges", async () => {
    const challenge = createChallenge("album");
    const question = challenge.questions[0];
    if (question === undefined) throw new Error("Expected question");
    const resolver = { resolveTrack: vi.fn() };
    const readCookies = vi.fn().mockResolvedValue({ get: vi.fn() });

    const response = await createPlaybackPostHandler({
      resolver,
      readCookies,
    })(request(), params(challenge.id, question.id));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "SPOTIFY_AUTH_REQUIRED" });
    expect(resolver.resolveTrack).not.toHaveBeenCalled();
  });

  it("accepts an authenticated private terminal question and refreshes safely", async () => {
    const challenge = createChallenge("album");
    const question = challenge.questions[0];
    if (question === undefined) throw new Error("Expected question");
    finishQuestion(challenge.id, question.id);
    const resolver = {
      resolveTrack: vi.fn().mockResolvedValue({
        status: "resolved",
        videoId: "dQw4w9WgXcQ",
        confidence: 95,
        durationMs: 180_000,
        durationDifferenceMs: 0,
      }),
    };
    const encoded = encryptSession(
      {
        accessToken: "server-access-token",
        refreshToken: "server-refresh-token",
        expiresAt: Date.now() + 60 * 60 * 1000,
      },
      sessionSecret,
    );
    const readCookies = vi.fn().mockResolvedValue({
      get: vi.fn(() => ({ value: encoded })),
    });

    const response = await createPlaybackPostHandler({
      resolver,
      readCookies,
      readEnvironment: () => serverEnvironment,
    })(request("{}"), params(challenge.id, question.id));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      playback: {
        provider: "youtube",
        status: "available",
        videoId: "dQw4w9WgXcQ",
        startAtMs: 8_500,
      },
    });
  });

  it("accepts only empty body semantics and rejects client-selected targets", async () => {
    const challenge = createChallenge();
    const question = challenge.questions[0];
    if (question === undefined) throw new Error("Expected question");
    finishQuestion(challenge.id, question.id);
    const resolver = { resolveTrack: vi.fn() };
    const handler = createPlaybackPostHandler({ resolver });

    expect((await handler(request("{}"), params(challenge.id, question.id))).status).toBe(200);
    expect(
      (await handler(
        request(JSON.stringify({ videoId: "dQw4w9WgXcQ" })),
        params(challenge.id, question.id),
      )).status,
    ).toBe(400);
    expect(
      (await handler(
        request(JSON.stringify({ trackId: "arbitrary" })),
        params(challenge.id, question.id),
      )).status,
    ).toBe(400);
    expect(
      (await handler(
        request(JSON.stringify({ startAtMs: 0 })),
        params(challenge.id, question.id),
      )).status,
    ).toBe(400);
    expect(resolver.resolveTrack).toHaveBeenCalledTimes(1);
  });

  it("maps resolver misses without exposing provider data", async () => {
    const challenge = createChallenge();
    const question = challenge.questions[0];
    if (question === undefined) throw new Error("Expected question");
    finishQuestion(challenge.id, question.id);
    const resolver = {
      resolveTrack: vi.fn().mockResolvedValue({
        status: "unavailable",
        reason: "low-confidence",
        raw: "provider response",
      }),
    };

    const response = await createPlaybackPostHandler({ resolver })(
      request(),
      params(challenge.id, question.id),
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      playback: {
        provider: "youtube",
        status: "unavailable",
        reason: "low-confidence",
      },
    });
    expect(text).not.toContain("provider response");
    expect(text).not.toContain("YOUTUBE_API_KEY");
  });

  it("rejects malformed, wrong, and unknown opaque handles", async () => {
    const challenge = createChallenge();
    const question = challenge.questions[0];
    if (question === undefined) throw new Error("Expected question");
    const handler = createPlaybackPostHandler({
      resolver: { resolveTrack: vi.fn() },
    });

    expect(
      (await handler(request(), params("short", question.id))).status,
    ).toBe(404);
    expect(
      (await handler(request(), params(challenge.id, "not-a-question"))).status,
    ).toBe(404);
    const unknownHandler = createPlaybackPostHandler({
      resolver: { resolveTrack: vi.fn() },
      readCookies: vi.fn().mockResolvedValue({ get: vi.fn() }),
    });
    expect(
      (await unknownHandler(
        request(),
        params("challenge_12345678", question.id),
      )).status,
    ).toBe(401);
  });

  it("bounds malformed request bodies", async () => {
    const challenge = createChallenge();
    const question = challenge.questions[0];
    if (question === undefined) throw new Error("Expected question");
    const handler = createPlaybackPostHandler({
      resolver: { resolveTrack: vi.fn() },
    });
    const oversized = "x".repeat(MAX_PLAYBACK_REQUEST_BYTES + 1);

    const response = await handler(
      request(oversized),
      params(challenge.id, question.id),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_INPUT" });
  });
});
