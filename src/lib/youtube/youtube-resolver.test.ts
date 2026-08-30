import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  YOUTUBE_SEARCH_URL,
  YOUTUBE_VIDEOS_URL,
} from "./youtube-client";
import { YouTubeResolutionCache } from "./youtube-cache";
import {
  YOUTUBE_HIGH_CONFIDENCE_SCORE,
  YouTubeCandidateResolver,
  buildYouTubeSearchQueries,
  makeYouTubeCacheKey,
  normalizeYouTubeMetadata,
  scoreYouTubeCandidate,
} from "./youtube-resolver";
import type { YouTubeVideoCandidate } from "./youtube-types";
import type { TrackSummary } from "../../types/tracks";

const searchFixture = JSON.parse(
  readFileSync(new URL("./fixtures/search-results.json", import.meta.url), "utf8"),
) as unknown;
const detailsFixture = JSON.parse(
  readFileSync(new URL("./fixtures/video-details.json", import.meta.url), "utf8"),
) as unknown;

const track: TrackSummary = Object.freeze({
  spotifyId: "spotify-track-1",
  name: "Example Song",
  artistNames: Object.freeze(["Example Artist"]),
  durationMs: 200_000,
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fixtureFetch() {
  return vi.fn(async (input: string | URL): Promise<Response> => {
    const url = new URL(String(input));

    if (url.origin + url.pathname === YOUTUBE_SEARCH_URL) {
      return jsonResponse(searchFixture);
    }

    if (url.origin + url.pathname === YOUTUBE_VIDEOS_URL) {
      return jsonResponse(detailsFixture);
    }

    throw new Error("unexpected endpoint");
  });
}

function candidate(
  overrides: Partial<YouTubeVideoCandidate> = {},
): YouTubeVideoCandidate {
  return {
    videoId: "videoCandidate1",
    title: "Example Song",
    channelTitle: "Example Artist - Topic",
    durationMs: track.durationMs,
    embeddable: true,
    licensedContent: null,
    sourceType: "art_track",
    ...overrides,
  };
}

describe("YouTube candidate scoring", () => {
  it("uses deterministic title, artist, duration, and source weights", () => {
    const exact = scoreYouTubeCandidate(track, candidate());
    const fiveSeconds = scoreYouTubeCandidate(
      track,
      candidate({ durationMs: track.durationMs + 5_000 }),
    );
    const tenSeconds = scoreYouTubeCandidate(
      track,
      candidate({ durationMs: track.durationMs + 10_000 }),
    );
    const overTenSeconds = scoreYouTubeCandidate(
      track,
      candidate({ durationMs: track.durationMs + 10_001 }),
    );

    expect(exact).toMatchObject({
      eligible: true,
      score: 100,
      titleScore: 35,
      artistScore: 25,
      durationScore: 30,
      sourceScore: 10,
      durationDifferenceMs: 0,
    });
    expect(fiveSeconds).toMatchObject({
      eligible: true,
      score: 90,
      durationScore: 20,
      durationDifferenceMs: 5_000,
    });
    expect(tenSeconds).toMatchObject({
      eligible: true,
      score: 78,
      durationScore: 8,
      durationDifferenceMs: 10_000,
    });
    expect(overTenSeconds).toMatchObject({
      eligible: false,
      rejectionReason: "duration_mismatch",
    });
  });

  it.each([
    "Example Song (Live)",
    "Example Song (Cover)",
    "Example Song (Remix)",
    "Example Song Karaoke",
    "Example Song Slowed",
    "Example Song Sped Up",
    "Example Song Nightcore",
    "Example Song Acoustic",
  ])("rejects an unrequested version label: %s", (title) => {
    expect(
      scoreYouTubeCandidate(track, candidate({ title })),
    ).toMatchObject({
      eligible: false,
      rejectionReason: "version_mismatch",
    });
  });

  it("allows a canonical version label and does not let source signal bypass gates", () => {
    const liveTrack = { ...track, name: "Example Song Live" };
    expect(
      scoreYouTubeCandidate(
        liveTrack,
        candidate({ title: "Example Song Live", sourceType: "other" }),
      ),
    ).toMatchObject({ eligible: true, score: 90 });

    expect(
      scoreYouTubeCandidate(
        track,
        candidate({ title: "Different Song", sourceType: "art_track" }),
      ),
    ).toMatchObject({ eligible: false, rejectionReason: "title_mismatch" });
  });
});

describe("YouTube candidate resolver", () => {
  it("resolves a high-confidence Art Track through two searches and one details lookup", async () => {
    const fetchMock = fixtureFetch();
    const resolver = new YouTubeCandidateResolver({
      apiKey: "server-only-key",
      fetch: fetchMock,
      cache: new YouTubeResolutionCache(),
    });

    const result = await resolver.resolveTrack(track);

    expect(result).toEqual({
      status: "resolved",
      videoId: "videoArt001",
      confidence: 100,
      durationMs: 200_000,
      durationDifferenceMs: 0,
    });
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.confidence).toBeGreaterThanOrEqual(
        YOUTUBE_HIGH_CONFIDENCE_SCORE,
      );
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
      "/youtube/v3/search",
      "/youtube/v3/search",
      "/youtube/v3/videos",
    ]);
    expect(JSON.stringify(result)).not.toContain("Example Artist");
    expect(JSON.stringify(result)).not.toContain("server-only-key");
  });

  it("resolves an Official Audio candidate with a five-second intro at the high threshold", async () => {
    const fetchMock = vi.fn(async (input: string | URL): Promise<Response> => {
      const url = new URL(String(input));

      if (url.origin + url.pathname === YOUTUBE_SEARCH_URL) {
        return jsonResponse({
          items: [
            {
              id: { videoId: "officialAudio1" },
              snippet: {
                title: "Example Artist - Example Song (Official Audio)",
                channelTitle: "Example Artist",
              },
            },
          ],
        });
      }

      return jsonResponse({
        items: [
          {
            id: "officialAudio1",
            snippet: {
              title: "Example Artist - Example Song (Official Audio)",
              channelTitle: "Example Artist",
            },
            contentDetails: { duration: "PT3M25S", licensedContent: true },
            status: {
              embeddable: true,
              privacyStatus: "public",
              uploadStatus: "processed",
            },
          },
        ],
      });
    });
    const result = await new YouTubeCandidateResolver({
      apiKey: "server-only-key",
      fetch: fetchMock,
      cache: new YouTubeResolutionCache(),
    }).resolveTrack(track);

    expect(result).toEqual({
      status: "resolved",
      videoId: "officialAudio1",
      confidence: 90,
      durationMs: 205_000,
      durationDifferenceMs: 5_000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("resolves an official music video with a five-second intro but rejects larger duration deltas", async () => {
    const fetchMock = vi.fn(async (input: string | URL): Promise<Response> => {
      const url = new URL(String(input));

      if (url.origin + url.pathname === YOUTUBE_SEARCH_URL) {
        return jsonResponse({
          items: [
            {
              id: { videoId: "officialVideo1" },
              snippet: {
                title: "Example Song (Official Music Video)",
                channelTitle: "Example Artist",
              },
            },
          ],
        });
      }

      return jsonResponse({
        items: [
          {
            id: "officialVideo1",
            snippet: {
              title: "Example Song (Official Music Video)",
              channelTitle: "Example Artist",
            },
            contentDetails: { duration: "PT3M25S" },
            status: { embeddable: true, privacyStatus: "public" },
          },
        ],
      });
    });

    const result = await new YouTubeCandidateResolver({
      apiKey: "server-only-key",
      fetch: fetchMock,
      cache: new YouTubeResolutionCache(),
    }).resolveTrack(track);

    expect(result.status).toBe("resolved");
    expect(result).toMatchObject({ confidence: 80, durationDifferenceMs: 5_000 });

    const lowResult = await new YouTubeCandidateResolver({
      apiKey: "server-only-key",
      fetch: vi.fn(async (input: string | URL): Promise<Response> => {
        const url = new URL(String(input));

        if (url.origin + url.pathname === YOUTUBE_SEARCH_URL) {
          return jsonResponse({
            items: [
              {
                id: { videoId: "officialVideo2" },
                snippet: {
                  title: "Example Song (Official Music Video)",
                  channelTitle: "Example Artist",
                },
              },
            ],
          });
        }

        return jsonResponse({
          items: [
            {
              id: "officialVideo2",
              snippet: {
                title: "Example Song (Official Music Video)",
                channelTitle: "Example Artist",
              },
              contentDetails: { duration: "PT3M30S" },
              status: { embeddable: true, privacyStatus: "public" },
            },
          ],
        });
      }),
      cache: new YouTubeResolutionCache(),
    }).resolveTrack(track);

    expect(lowResult).toEqual({ status: "unavailable", reason: "low_confidence" });
  });

  it("returns typed unavailable results for no candidates, low confidence, missing keys, and provider failures", async () => {
    const noCandidate = await new YouTubeCandidateResolver({
      apiKey: "server-only-key",
      fetch: async () => jsonResponse({ items: [] }),
      cache: new YouTubeResolutionCache(),
    }).resolveTrack(track);
    expect(noCandidate).toEqual({ status: "unavailable", reason: "no_candidate" });

    const noKeyFetch = vi.fn(async () => jsonResponse({ items: [] }));
    const missingKey = await new YouTubeCandidateResolver({
      fetch: noKeyFetch,
      cache: new YouTubeResolutionCache(),
      apiKey: undefined,
    }).resolveTrack(track);
    expect(missingKey).toEqual({ status: "unavailable", reason: "configuration" });
    expect(noKeyFetch).not.toHaveBeenCalled();

    for (const [status, reason] of [
      [429, "rate_limited"],
      [500, "unavailable"],
    ] as const) {
      const result = await new YouTubeCandidateResolver({
        apiKey: "server-only-key",
        fetch: async () => jsonResponse({ error: "provider secret" }, status),
        cache: new YouTubeResolutionCache(),
      }).resolveTrack(track);
      expect(result).toEqual({ status: "unavailable", reason });
    }

    const invalidTrack = await new YouTubeCandidateResolver({
      apiKey: "server-only-key",
      fetch: noKeyFetch,
      cache: new YouTubeResolutionCache(),
    }).resolveTrack({ ...track, durationMs: 0 });
    expect(invalidTrack).toEqual({ status: "unavailable", reason: "invalid_input" });
  });

  it("deduplicates concurrent and subsequent lookups through the bounded cache", async () => {
    const fetchMock = fixtureFetch();
    const resolver = new YouTubeCandidateResolver({
      apiKey: "server-only-key",
      fetch: fetchMock,
      cache: new YouTubeResolutionCache(),
    });

    const [first, second] = await Promise.all([
      resolver.resolveTrack(track),
      resolver.resolveTrack(track),
    ]);
    const third = await resolver.resolveTrack(track);

    expect(first).toEqual(second);
    expect(third).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("normalizes metadata and namespaces cache keys with all lookup fields", () => {
    expect(normalizeYouTubeMetadata("  Example—Song! ")).toBe("example song");
    expect(buildYouTubeSearchQueries(track)).toEqual([
      "Example Artist Example Song",
      "Example Song Example Artist official audio",
    ]);
    expect(makeYouTubeCacheKey(track)).toContain("youtube-resolver-v1");
    expect(makeYouTubeCacheKey(track)).not.toBe(
      makeYouTubeCacheKey({ ...track, durationMs: 201_000 }),
    );
    expect(makeYouTubeCacheKey(track)).not.toBe(
      makeYouTubeCacheKey({ ...track, name: "Other Song" }),
    );
    expect(makeYouTubeCacheKey(track)).not.toBe(
      makeYouTubeCacheKey({
        ...track,
        artistNames: Object.freeze(["Example Artist", "Featured Artist"]),
      }),
    );
  });
});
