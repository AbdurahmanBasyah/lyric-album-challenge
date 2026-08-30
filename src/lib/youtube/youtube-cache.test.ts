import { describe, expect, it, vi } from "vitest";

import {
  YOUTUBE_NEGATIVE_CACHE_TTL_MS,
  YOUTUBE_POSITIVE_CACHE_TTL_MS,
  YouTubeResolutionCache,
} from "./youtube-cache";
import type { YouTubeResolution } from "./youtube-types";

const resolved: YouTubeResolution = Object.freeze({
  status: "resolved",
  videoId: "video-cache-1",
  confidence: 90,
  durationMs: 180_000,
  durationDifferenceMs: 1_000,
});
const unavailable: YouTubeResolution = Object.freeze({
  status: "unavailable",
  reason: "no_candidate",
});

describe("YouTube resolution cache", () => {
  it("uses a 24-hour positive TTL and a 10-minute negative TTL", () => {
    let now = 1_000;
    const cache = new YouTubeResolutionCache({ now: () => now });

    cache.set("positive", resolved);
    cache.set("negative", unavailable);
    expect(cache.get("positive")).toEqual(resolved);
    expect(cache.get("negative")).toEqual(unavailable);

    now += YOUTUBE_NEGATIVE_CACHE_TTL_MS;
    expect(cache.get("negative")).toBeUndefined();
    expect(cache.get("positive")).toEqual(resolved);

    now += YOUTUBE_POSITIVE_CACHE_TTL_MS - YOUTUBE_NEGATIVE_CACHE_TTL_MS;
    expect(cache.get("positive")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("evicts the oldest entry at the bounded capacity", () => {
    const cache = new YouTubeResolutionCache({ maxEntries: 2 });

    cache.set("first", resolved);
    cache.set("second", unavailable);
    cache.set("third", resolved);

    expect(cache.size).toBe(2);
    expect(cache.get("first")).toBeUndefined();
    expect(cache.get("second")).toEqual(unavailable);
    expect(cache.get("third")).toEqual(resolved);
  });

  it("refreshes an existing key to the newest eviction position", () => {
    const cache = new YouTubeResolutionCache({ maxEntries: 2 });

    cache.set("first", resolved);
    cache.set("second", unavailable);
    cache.set("first", unavailable);
    cache.set("third", resolved);

    expect(cache.get("first")).toEqual(unavailable);
    expect(cache.get("second")).toBeUndefined();
    expect(cache.get("third")).toEqual(resolved);
  });

  it("refreshes a live read to the newest eviction position", () => {
    const cache = new YouTubeResolutionCache({ maxEntries: 2 });

    cache.set("first", resolved);
    cache.set("second", unavailable);
    expect(cache.get("first")).toEqual(resolved);
    cache.set("third", resolved);

    expect(cache.get("first")).toEqual(resolved);
    expect(cache.get("second")).toBeUndefined();
    expect(cache.get("third")).toEqual(resolved);
  });

  it("deduplicates concurrent work and caches its reduced result", async () => {
    let release!: (value: YouTubeResolution) => void;
    const loader = vi.fn(
      () =>
        new Promise<YouTubeResolution>((resolve) => {
          release = resolve;
        }),
    );
    const cache = new YouTubeResolutionCache();

    const first = cache.resolve("same", loader);
    const second = cache.resolve("same", loader);

    expect(cache.inFlightSize).toBe(1);
    expect(loader).toHaveBeenCalledTimes(1);
    release(resolved);

    await expect(first).resolves.toEqual(resolved);
    await expect(second).resolves.toEqual(resolved);
    expect(cache.inFlightSize).toBe(0);
    await expect(cache.resolve("same", loader)).resolves.toEqual(resolved);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("does not cache rejected work and removes its in-flight entry", async () => {
    const cache = new YouTubeResolutionCache();
    const loader = vi.fn(async () => {
      throw new Error("provider detail must not be retained");
    });

    await expect(cache.resolve("reject", loader)).rejects.toThrow(
      "provider detail must not be retained",
    );
    expect(cache.inFlightSize).toBe(0);
    expect(cache.get("reject")).toBeUndefined();
  });
});
