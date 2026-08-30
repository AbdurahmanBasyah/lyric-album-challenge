import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { PlaybackStatus } from "./challenge-playback";
import {
  createYouTubeEmbedUrl,
  getPlaybackStatus,
  getPlaybackStatusCopy,
  getPlaybackUnavailableCopy,
  PLAYBACK_UNAVAILABLE_REASONS,
} from "./challenge-playback";

const source = readFileSync(
  resolve(process.cwd(), "src/components/challenge/challenge-playback.tsx"),
  "utf8",
);

const statuses: readonly PlaybackStatus[] = [
  "idle",
  "loading",
  "available",
  "manual",
  "unavailable",
  "error",
];

describe("challenge YouTube playback affordance", () => {
  it("accepts only a validated video ID and fixed embed origin", () => {
    expect(createYouTubeEmbedUrl("dQw4w9WgXcQ")).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ?controls=1&rel=0",
    );

    for (const value of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "dQw4w9WgXc",
      "dQw4w9WgXcQ/extra",
      "dQw4w9WgXcQ&autoplay=1",
      "<script>alert(1)</script>",
      "",
    ]) {
      expect(createYouTubeEmbedUrl(value)).toBeNull();
    }
  });

  it("keeps application outcomes inside stable user-facing copy", () => {
    expect(statuses).toHaveLength(6);
    expect(new Set(statuses).size).toBe(statuses.length);

    for (const status of statuses) {
      const copy = getPlaybackStatusCopy(status);

      expect(copy.label.length).toBeGreaterThan(0);
      expect(copy.detail.length).toBeGreaterThan(0);
      expect(copy.label.toLowerCase()).not.toContain("reward");
      expect(copy.detail.toLowerCase()).not.toContain("reward");
    }

    for (const reason of PLAYBACK_UNAVAILABLE_REASONS) {
      const copy = getPlaybackUnavailableCopy(reason);

      expect(copy.label.length).toBeGreaterThan(0);
      expect(copy.detail).not.toContain("provider");
      expect(copy.detail).not.toContain("response");
    }

    expect(
      getPlaybackStatus({
        provider: "youtube",
        status: "available",
        videoId: "dQw4w9WgXcQ",
        startAtMs: 8_500,
      }),
    ).toBe("available");
    expect(
      getPlaybackStatus({
        provider: "youtube",
        status: "unavailable",
        reason: "low-confidence",
      }),
    ).toBe("unavailable");
    expect(getPlaybackStatus({ status: "available", videoId: "invalid" })).toBe(
      "error",
    );
    expect(
      getPlaybackStatus({
        status: "available",
        videoId: "dQw4w9WgXcQ",
        startAtMs: 8_500,
      }),
    ).toBe("error");
    expect(getPlaybackStatus({ provider: "spotify", status: "started" })).toBe(
      "error",
    );
    expect(getPlaybackStatus("not-a-result")).toBe("error");
  });

  it("auto-mounts after reveal and renders a visible, controllable iframe", () => {
    expect(source).toContain('"use client"');
    expect(source).toContain("reveal: ChallengeRevealView");
    expect(source).toContain("requestPlayback?: PlaybackRequest");
    expect(source).toContain("onClick={handlePlaybackRequest}");
    expect(source).toContain("<iframe");
    expect(source).toContain("createYouTubeIframePlayer");
    expect(source).toContain("onAutoplayBlocked");
    expect(source).toContain("startAtMs");
    expect(source).toContain("autoStartedRevealKeyRef.current");
    expect(source).toContain("cleanupTokenRef.current");
    expect(source).toContain("requestPlaybackRef.current");
    expect(source).toContain("void Promise.resolve().then");
    expect(source).toContain("min-h-[200px]");
    expect(source).toContain("min-w-[200px]");
    expect(source).toContain("https://www.youtube.com/embed/");
    expect(source).toContain("controls=1");
    expect(source).toContain("rel=0");
    expect(source).toContain('loading="lazy"');
    expect(source).toContain("allowFullScreen");
    expect(source).toContain('type="button"');
    expect(source).toContain("aria-busy={isPending}");
    expect(source).toContain('role="status"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('aria-atomic="true"');
    expect(source).toContain("useReducedMotion");
    expect(source).toContain("reducedMotion ? 0");
    expect(source).toContain("mountedRef.current");
    expect(source).toContain("pendingRef.current");
    expect(source).toContain("controller?.abort()");
    expect(source).not.toContain("Select the button to load");
    expect(source).not.toContain('"Load YouTube player"');
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("window.open");
    expect(source).not.toContain("YOUTUBE_API_KEY");
    expect(source).not.toContain("autoplay=1");
    expect(source).not.toContain("end=");
    expect(source.toLowerCase()).not.toContain("reward");
  });
});
