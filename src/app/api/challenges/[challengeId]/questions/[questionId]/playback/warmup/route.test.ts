import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChallengeCandidateResult } from "../../../../../../../../lib/challenge/challenge-candidates";
import {
  challengeStore,
  resetChallengeStore,
} from "../../../../../../../../lib/challenge/challenge-store";
import { encryptSession } from "../../../../../../../../lib/auth/session";
import type { FourLineLyricWindow } from "../../../../../../../../types/game";
import {
  createPlaybackPostHandler,
} from "../route";
import {
  createPlaybackWarmupPostHandler,
  MAX_WARMUP_REQUEST_BYTES,
} from "./route";
import { YouTubeWarmupCache } from "../../../../../../../../lib/playback/youtube-warmup";

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
          spotifyId: "synthetic-track-1",
          name: "Lantern Walk",
          artistNames: ["Quiet Signals"],
          durationMs: 182_000,
        },
        window: [
          { timestampMs: 10_000, text: "Lanterns gather under quiet rain" },
          { timestampMs: 12_000, text: "Silver footsteps cross the garden" },
          { timestampMs: 14_000, text: "Paper skies unfold above us" },
          { timestampMs: 16_000, text: "Morning carries every color" },
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
            spotifyId: "playlist-synthetic-1",
            displayName: "Synthetic playlist",
            canonicalUrl:
              "https://open.spotify.com/playlist/playlist-synthetic-1",
          }
        : {
            kind,
            spotifyId: "album-synthetic-1",
            displayName: "Synthetic album",
          },
    seed: "warmup-seed",
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
  return new Request("http://127.0.0.1:3000/api/playback/warmup", {
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

describe("POST challenge question playback warmup", () => {
  it("acknowledges a public active question without waiting or leaking metadata", async () => {
    const challenge = createChallenge();
    const question = challenge.questions[0];
    if (question === undefined) throw new Error("Expected question");
    const resolver = {
      resolveTrack: vi.fn().mockResolvedValue({
        status: "resolved",
        videoId: "AbCdEfGhIjK",
        confidence: 96,
        durationMs: 182_000,
        durationDifferenceMs: 400,
      }),
    };
    const warmup = new YouTubeWarmupCache();
    const readCookies = vi.fn();

    const response = await createPlaybackWarmupPostHandler({
      resolver,
      warmup,
      readCookies,
    })(request(), params(challenge.id, question.id));

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      warmup: { provider: "youtube", status: "accepted" },
    });
    expect(text).not.toContain("Lantern Walk");
    expect(text).not.toContain("Quiet Signals");
    expect(text).not.toContain("AbCdEfGhIjK");
    expect(readCookies).not.toHaveBeenCalled();

    await warmup.resolve(
      challenge.id,
      question.id,
      challenge.expiresAt,
      async () => resolver.resolveTrack(question.track),
    );
    expect(resolver.resolveTrack).toHaveBeenCalledTimes(1);
    expect(warmup.get(challenge.id, question.id)).toMatchObject({
      state: "resolved",
    });
  });

  it("shares an in-flight warmup with terminal playback", async () => {
    const challenge = createChallenge();
    const question = challenge.questions[0];
    if (question === undefined) throw new Error("Expected question");
    let release: ((value: unknown) => void) | undefined;
    const providerWork = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    const resolver = {
      resolveTrack: vi.fn().mockImplementation(() => providerWork),
    };
    const warmup = new YouTubeWarmupCache();

    const warmupResponse = await createPlaybackWarmupPostHandler({
      resolver,
      warmup,
    })(request("{}"), params(challenge.id, question.id));
    expect(warmupResponse.status).toBe(202);
    await Promise.resolve();
    finishQuestion(challenge.id, question.id);

    const terminalResponse = createPlaybackPostHandler({ resolver, warmup })(
      request("{}"),
      params(challenge.id, question.id),
    );

    expect(resolver.resolveTrack).toHaveBeenCalledTimes(1);
    release?.({
      status: "resolved",
      videoId: "AbCdEfGhIjK",
      confidence: 96,
      durationMs: 182_000,
      durationDifferenceMs: 400,
    });
    const response = await terminalResponse;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      playback: {
        provider: "youtube",
        status: "available",
        videoId: "AbCdEfGhIjK",
        startAtMs: 8_500,
      },
    });
    expect(resolver.resolveTrack).toHaveBeenCalledTimes(1);
  });

  it("preserves private auth boundaries and terminal-state behavior", async () => {
    const challenge = createChallenge("album");
    const question = challenge.questions[0];
    if (question === undefined) throw new Error("Expected question");
    const resolver = { resolveTrack: vi.fn() };

    const unauthenticated = await createPlaybackWarmupPostHandler({
      resolver,
      readCookies: vi.fn().mockResolvedValue({ get: vi.fn() }),
    })(request(), params(challenge.id, question.id));
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toEqual({
      error: "SPOTIFY_AUTH_REQUIRED",
    });

    const encoded = encryptSession(
      {
        accessToken: "server-access-token",
        refreshToken: "server-refresh-token",
        expiresAt: Date.now() + 60 * 60 * 1000,
      },
      sessionSecret,
    );
    const authenticated = await createPlaybackWarmupPostHandler({
      resolver,
      readCookies: vi.fn().mockResolvedValue({
        get: vi.fn(() => ({ value: encoded })),
      }),
      readEnvironment: () => serverEnvironment,
    })(request("{}"), params(challenge.id, question.id));
    expect(authenticated.status).toBe(202);
    expect(await authenticated.json()).toEqual({
      warmup: { provider: "youtube", status: "accepted" },
    });

    finishQuestion(challenge.id, question.id);
    const terminal = await createPlaybackWarmupPostHandler({
      resolver,
      readCookies: vi.fn().mockResolvedValue({
        get: vi.fn(() => ({ value: encoded })),
      }),
      readEnvironment: () => serverEnvironment,
    })(request(), params(challenge.id, question.id));
    expect(terminal.status).toBe(409);
    expect(await terminal.json()).toEqual({ error: "QUESTION_NOT_ACTIVE" });
  });

  it("accepts only empty body semantics and bounds unknown handles", async () => {
    const challenge = createChallenge();
    const question = challenge.questions[0];
    if (question === undefined) throw new Error("Expected question");
    const handler = createPlaybackWarmupPostHandler({
      resolver: { resolveTrack: vi.fn() },
    });

    for (const body of [
      JSON.stringify({ videoId: "AbCdEfGhIjK" }),
      JSON.stringify({ trackName: "Lantern Walk" }),
      "x".repeat(MAX_WARMUP_REQUEST_BYTES + 1),
    ]) {
      const response = await handler(
        request(body),
        params(challenge.id, question.id),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "INVALID_INPUT" });
    }

    const unknown = await createPlaybackWarmupPostHandler({
      resolver: { resolveTrack: vi.fn() },
      readCookies: vi.fn().mockResolvedValue({ get: vi.fn() }),
    })(request(), params("challenge_unknown_1", question.id));
    expect(unknown.status).toBe(401);
  });
});

