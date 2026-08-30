import { afterEach, describe, expect, it, vi } from "vitest";

const { buildChallengeCandidatesMock } = vi.hoisted(() => ({
  buildChallengeCandidatesMock: vi.fn(),
}));

vi.mock("../../../../lib/challenge/challenge-candidates", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../lib/challenge/challenge-candidates")
  >("../../../../lib/challenge/challenge-candidates");

  return {
    ...actual,
    buildChallengeCandidates: buildChallengeCandidatesMock,
  };
});

import {
  POST as createPublicChallenge,
  setPublicPlaylistResolverForTests,
} from "./route";
import { resetChallengeStore } from "../../../../lib/challenge/challenge-store";
import type { ChallengeCandidateResult } from "../../../../lib/challenge/challenge-candidates";
import type { FourLineLyricWindow } from "../../../../types/game";
import type { PublicPlaylistResolver } from "../../../../lib/public-playlist/public-playlist-resolver";
import { PublicPlaylistResolverError } from "../../../../lib/public-playlist/public-playlist-resolver";
import { challengeStore } from "../../../../lib/challenge/challenge-store";

const canonicalUrl = "https://open.spotify.com/playlist/playlist-1";

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
    tracksScanned: 0,
    sourceTruncated: false,
    lyricScanLimitReached: false,
  });
}

function request(body: unknown, contentLength?: string): Request {
  const headers = new Headers({ "Content-Type": "application/json" });

  if (contentLength !== undefined) {
    headers.set("Content-Length", contentLength);
  }

  return new Request("http://127.0.0.1:3000/api/public-playlists/challenge", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function resolverFor(
  resolve: PublicPlaylistResolver["resolvePlaylist"] = async () => ({
    spotifyId: "playlist-1",
    canonicalUrl,
    name: "Public fixture",
    tracks: [],
    sourceTruncated: false,
  }),
): PublicPlaylistResolver {
  return Object.freeze({ resolvePlaylist: vi.fn(resolve) });
}

afterEach(() => {
  buildChallengeCandidatesMock.mockReset();
  resetChallengeStore();
  setPublicPlaylistResolverForTests(undefined);
  vi.restoreAllMocks();
});

describe("POST /api/public-playlists/challenge", () => {
  it("rejects invalid URL and oversized JSON before resolver work", async () => {
    const resolver = resolverFor();
    setPublicPlaylistResolverForTests(resolver);

    const invalid = await createPublicChallenge(
      request({ url: "https://spotify.link/playlist-1" }),
    );
    const oversized = await createPublicChallenge(
      request({ url: canonicalUrl }, "999999"),
    );
    const unicodeOversized = await createPublicChallenge(
      request({ url: canonicalUrl, ignored: "😀".repeat(5_000) }),
    );

    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "INVALID_INPUT" });
    expect(oversized.status).toBe(400);
    expect(await oversized.json()).toEqual({ error: "INVALID_INPUT" });
    expect(unicodeOversized.status).toBe(400);
    expect(await unicodeOversized.json()).toEqual({ error: "INVALID_INPUT" });
    expect(invalid.headers.get("cache-control")).toBe("no-store");
    expect(resolver.resolvePlaylist).not.toHaveBeenCalled();
    expect(buildChallengeCandidatesMock).not.toHaveBeenCalled();
  });

  it("creates a one-question anonymous public challenge without cookies or OAuth", async () => {
    const resolver = resolverFor();
    setPublicPlaylistResolverForTests(resolver);
    buildChallengeCandidatesMock.mockResolvedValue(candidateResult());

    const response = await createPublicChallenge(
      request({ url: `${canonicalUrl}/?ignored=true`, seed: "fixed-seed", targetCount: 1 }),
    );
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.challenge.source).toEqual({
      kind: "public-playlist",
      spotifyId: "playlist-1",
      displayName: "Public fixture",
      canonicalUrl,
    });
    expect(body.challenge.questionCount).toBe(1);
    expect(body.challenge.questions[0].lines).toHaveLength(4);
    expect(body.challenge.questions[0].attempt).toBe(1);
    expect(serialized).not.toContain("normalized");
    expect(serialized).not.toContain("candidateWindows");
    expect(serialized).not.toContain("durationMs");
    expect(buildChallengeCandidatesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: {
          kind: "public-playlist",
          spotifyId: "playlist-1",
          displayName: "Public fixture",
          canonicalUrl,
        },
        seed: "fixed-seed",
        targetCount: 1,
      }),
    );
    expect(resolver.resolvePlaylist).toHaveBeenCalledWith({
      playlistId: "playlist-1",
      canonicalUrl,
    });
  });

  it("accepts multiple questions and preserves the requested bounded target", async () => {
    const resolver = resolverFor();
    setPublicPlaylistResolverForTests(resolver);
    buildChallengeCandidatesMock.mockResolvedValue(candidateResult(3));

    const response = await createPublicChallenge(
      request({ url: canonicalUrl, seed: "three", targetCount: 3 }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.challenge.questionCount).toBe(3);
    expect(buildChallengeCandidatesMock).toHaveBeenCalledWith(
      expect.objectContaining({ targetCount: 3 }),
    );
  });

  it("maps an empty playable result to insufficient lyrics without storing state", async () => {
    const resolver = resolverFor();
    setPublicPlaylistResolverForTests(resolver);
    buildChallengeCandidatesMock.mockResolvedValue(insufficientResult());

    const response = await createPublicChallenge(request({ url: canonicalUrl }));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "INSUFFICIENT_LYRICS" });
    expect(challengeStore.size).toBe(0);
  });

  it.each([
    ["private", "PUBLIC_PLAYLIST_PRIVATE", 403],
    ["not found", "PUBLIC_PLAYLIST_NOT_FOUND", 404],
    ["rate limited", "PUBLIC_PLAYLIST_RATE_LIMITED", 429],
    ["unavailable", "PUBLIC_PLAYLIST_UNAVAILABLE", 502],
    ["invalid response", "PUBLIC_PLAYLIST_INVALID_RESPONSE", 502],
  ] as const)("maps resolver %s safely", async (_label, code, status) => {
    const resolver = resolverFor(async () => {
      const kind =
        code === "PUBLIC_PLAYLIST_PRIVATE"
          ? "private"
          : code === "PUBLIC_PLAYLIST_NOT_FOUND"
            ? "not_found"
            : code === "PUBLIC_PLAYLIST_RATE_LIMITED"
              ? "rate_limited"
              : code === "PUBLIC_PLAYLIST_INVALID_RESPONSE"
                ? "invalid_response"
                : "unavailable";
      throw new PublicPlaylistResolverError(kind);
    });
    setPublicPlaylistResolverForTests(resolver);

    const response = await createPublicChallenge(
      request({ url: canonicalUrl, seed: `error-${code}` }),
    );

    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body).toEqual({ error: code });
    expect(JSON.stringify(body)).not.toContain("provider");
  });

  it("deduplicates concurrent identical requests in bounded in-flight state", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const resolver = resolverFor(async () => {
      await gate;
      return {
        spotifyId: "playlist-1",
        canonicalUrl,
        name: "Public fixture",
        tracks: [],
        sourceTruncated: false,
      };
    });
    setPublicPlaylistResolverForTests(resolver);
    buildChallengeCandidatesMock.mockResolvedValue(candidateResult());

    const first = createPublicChallenge(
      request({ url: canonicalUrl, seed: "duplicate", targetCount: 1 }),
    );
    const second = createPublicChallenge(
      request({ url: `${canonicalUrl}/?x=1`, seed: "duplicate", targetCount: 1 }),
    );
    await Promise.resolve();
    release();
    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    const firstBody = await firstResponse.json();
    const secondBody = await secondResponse.json();

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    expect(firstBody.challenge.id).toBe(secondBody.challenge.id);
    expect(resolver.resolvePlaylist).toHaveBeenCalledTimes(1);
    expect(buildChallengeCandidatesMock).toHaveBeenCalledTimes(1);
  });
});
