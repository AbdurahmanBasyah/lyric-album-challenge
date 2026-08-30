import { describe, expect, it, vi } from "vitest";

import {
  mapYouTubeResolutionToPlayback,
  resolveChallengeQuestionPlayback,
  YOUTUBE_VIDEO_ID_PATTERN,
} from "./youtube-playback";

const track = {
  spotifyId: "spotify-track-1",
  name: "Example Track",
  artistNames: ["Example Artist"],
  durationMs: 180_000,
} as const;

describe("YouTube playback boundary", () => {
  it("keeps only a validated high-confidence video identity", () => {
    expect(YOUTUBE_VIDEO_ID_PATTERN.test("dQw4w9WgXcQ")).toBe(true);
    expect(
      mapYouTubeResolutionToPlayback({
        status: "resolved",
        videoId: "dQw4w9WgXcQ",
        confidence: 95,
        durationMs: 180_000,
        durationDifferenceMs: 0,
        description: "provider secret",
      }),
    ).toEqual({
      provider: "youtube",
      status: "available",
      videoId: "dQw4w9WgXcQ",
    });
  });

  it("rejects malformed IDs and confidence below the resolver threshold", () => {
    expect(
      mapYouTubeResolutionToPlayback({
        status: "resolved",
        videoId: "https://youtube.com/watch?v=dQw4w9WgXcQ",
        confidence: 100,
      }),
    ).toEqual({
      provider: "youtube",
      status: "unavailable",
      reason: "unavailable",
    });
    expect(
      mapYouTubeResolutionToPlayback({
        status: "resolved",
        videoId: "dQw4w9WgXcQ",
        confidence: 79,
      }),
    ).toEqual({
      provider: "youtube",
      status: "unavailable",
      reason: "low-confidence",
    });
    expect(
      mapYouTubeResolutionToPlayback({
        status: "resolved",
        videoId: "dQw4w9WgXcQ",
        confidence: 100.5,
      }),
    ).toEqual({
      provider: "youtube",
      status: "unavailable",
      reason: "unavailable",
    });
    expect(
      mapYouTubeResolutionToPlayback({
        status: "resolved",
        videoId: "dQw4w9WgXcQ",
        confidence: 101,
      }),
    ).toEqual({
      provider: "youtube",
      status: "unavailable",
      reason: "unavailable",
    });
  });

  it("collapses provider-only unavailable reasons to the safe envelope", () => {
    expect(
      mapYouTubeResolutionToPlayback({
        status: "unavailable",
        reason: "configuration",
        rawProviderBody: "secret",
      }),
    ).toEqual({
      provider: "youtube",
      status: "unavailable",
      reason: "configuration",
    });
    expect(
      mapYouTubeResolutionToPlayback({
        status: "unavailable",
        reason: "invalid_response",
      }),
    ).toEqual({
      provider: "youtube",
      status: "unavailable",
      reason: "unavailable",
    });
  });

  it("does not invoke a resolver for an active question", async () => {
    const resolveTrack = vi.fn();
    const payload = await resolveChallengeQuestionPlayback(
      { status: "active", track },
      { resolveTrack },
    );

    expect(payload).toEqual({
      playback: {
        provider: "youtube",
        status: "unavailable",
        reason: "unavailable",
      },
    });
    expect(resolveTrack).not.toHaveBeenCalled();
  });

  it("does not expose resolver errors or raw values", async () => {
    const resolveTrack = vi.fn().mockRejectedValue(new Error("secret body"));
    const payload = await resolveChallengeQuestionPlayback(
      { status: "solved", track },
      { resolveTrack },
    );

    expect(payload).toEqual({
      playback: {
        provider: "youtube",
        status: "unavailable",
        reason: "unavailable",
      },
    });
    expect(JSON.stringify(payload)).not.toContain("secret body");
  });

  it("derives the bounded start position from the server-owned first window line", async () => {
    const payload = await resolveChallengeQuestionPlayback(
      {
        status: "solved",
        track,
        window: [
          { timestampMs: 1_000, lineIndex: 0, tokens: [] },
          { timestampMs: 2_000, lineIndex: 1, tokens: [] },
          { timestampMs: 3_000, lineIndex: 2, tokens: [] },
          { timestampMs: 4_000, lineIndex: 3, tokens: [] },
        ],
      },
      {
        resolveTrack: vi.fn().mockResolvedValue({
          status: "resolved",
          videoId: "dQw4w9WgXcQ",
          confidence: 95,
          durationMs: 180_000,
          durationDifferenceMs: 0,
        }),
      },
    );

    expect(payload).toEqual({
      playback: {
        provider: "youtube",
        status: "available",
        videoId: "dQw4w9WgXcQ",
        startAtMs: 0,
      },
    });
  });

  it("keeps unavailable results unchanged when no reliable window boundary exists", async () => {
    const payload = await resolveChallengeQuestionPlayback(
      {
        status: "solved",
        track,
      },
      {
        resolveTrack: vi.fn().mockResolvedValue({
          status: "unavailable",
          reason: "low-confidence",
        }),
      },
    );

    expect(payload).toEqual({
      playback: {
        provider: "youtube",
        status: "unavailable",
        reason: "low-confidence",
      },
    });
  });
});
