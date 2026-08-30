import { describe, expect, it } from "vitest";

import {
  PLAYBACK_LEAD_TIME_MS,
  PlaybackInputError,
  calculatePlaybackStartAtMs,
  createUnsupportedPlaybackProvider,
  unsupportedPlaybackProvider,
  type PlaybackResult,
} from "./playback-provider";

describe("playback timing", () => {
  it("starts 1.5 seconds before the first lyric timestamp", () => {
    expect(calculatePlaybackStartAtMs(8_000)).toBe(
      8_000 - PLAYBACK_LEAD_TIME_MS,
    );
  });

  it("clamps windows near the beginning of a track to zero", () => {
    expect(calculatePlaybackStartAtMs(0)).toBe(0);
    expect(calculatePlaybackStartAtMs(1_500)).toBe(0);
    expect(calculatePlaybackStartAtMs(300)).toBe(0);
    expect(calculatePlaybackStartAtMs(2_000)).toBe(500);
  });

  it("rejects malformed timestamps before a provider can receive them", () => {
    expect(() => calculatePlaybackStartAtMs(-1)).toThrowError(
      new PlaybackInputError(),
    );
    expect(() => calculatePlaybackStartAtMs(Number.NaN)).toThrowError(
      new PlaybackInputError(),
    );
    expect(() => calculatePlaybackStartAtMs(1.25)).toThrowError(
      new PlaybackInputError(),
    );
    expect(() => calculatePlaybackStartAtMs(Number.POSITIVE_INFINITY)).toThrowError(
      new PlaybackInputError(),
    );
  });
});

describe("policy-gated unsupported playback provider", () => {
  it("advertises a typed unsupported capability", () => {
    expect(unsupportedPlaybackProvider.capability).toEqual({
      supported: false,
      status: "unsupported",
    });
  });

  it("returns unsupported without making a provider call or leaking input", async () => {
    const secretTrackReference = "server-track-reference-token";
    const result: PlaybackResult = await createUnsupportedPlaybackProvider().start({
      trackId: secretTrackReference,
      windowStartTimestampMs: 42_000,
    });

    expect(result).toEqual({ status: "unsupported" });
    expect(JSON.stringify(result)).not.toContain(secretTrackReference);
    expect(JSON.stringify(result)).not.toContain("42_000");
  });

  it("does not mutate the server-owned request object", async () => {
    const request = Object.freeze({
      trackId: "track-reference",
      windowStartTimestampMs: 2_000,
    });

    await unsupportedPlaybackProvider.start(request);

    expect(request).toEqual({
      trackId: "track-reference",
      windowStartTimestampMs: 2_000,
    });
  });
});
