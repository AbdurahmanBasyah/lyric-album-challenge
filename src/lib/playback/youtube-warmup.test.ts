import { describe, expect, it } from "vitest";

import {
  YouTubeWarmupCache,
  makeYouTubeWarmupCacheKey,
} from "./youtube-warmup";

const resolved = {
  status: "resolved" as const,
  videoId: "AbCdEfGhIjK",
  confidence: 96,
  durationMs: 182_000,
  durationDifferenceMs: 400,
};

describe("YouTube question warmup cache", () => {
  it("namespaces entries by both opaque handles and deduplicates pending work", async () => {
    const now = 1_000;
    let calls = 0;
    let release: ((value: typeof resolved) => void) | undefined;
    const pending = new Promise<typeof resolved>((resolve) => {
      release = resolve;
    });
    const cache = new YouTubeWarmupCache({
      now: () => now,
      pendingTtlMs: 100,
      positiveTtlMs: 500,
      negativeTtlMs: 50,
    });
    const loader = async () => {
      calls += 1;
      return pending;
    };

    const first = cache.resolve("challenge_alpha", "question_one", 10_000, loader);
    const second = cache.resolve("challenge_alpha", "question_one", 10_000, loader);

    expect(first).toBe(second);
    expect(calls).toBe(0);
    expect(cache.get("challenge_alpha", "question_one")).toMatchObject({
      state: "pending",
    });
    expect(cache.get("challenge_other", "question_one")).toBeUndefined();
    expect(makeYouTubeWarmupCacheKey("challenge_alpha", "question_one")).not.toBe(
      makeYouTubeWarmupCacheKey("challenge_alpha", "question_two"),
    );

    await Promise.resolve();
    expect(calls).toBe(1);
    release?.(resolved);
    await expect(first).resolves.toEqual(resolved);
    expect(cache.get("challenge_alpha", "question_one")).toMatchObject({
      state: "resolved",
      resolution: resolved,
    });
  });

  it("bounds positive and negative TTLs by the challenge lifetime and retries misses", async () => {
    let now = 5_000;
    let calls = 0;
    const cache = new YouTubeWarmupCache({
      now: () => now,
      positiveTtlMs: 1_000,
      negativeTtlMs: 100,
    });

    await cache.resolve("challenge_short", "question_one", 5_400, async () => {
      calls += 1;
      return resolved;
    });

    const bounded = cache.get("challenge_short", "question_one");
    expect(bounded).toMatchObject({ state: "resolved", expiresAt: 5_400 });

    now = 5_400;
    expect(cache.get("challenge_short", "question_one")).toEqual({
      state: "expired",
    });

    now = 6_000;
    await cache.resolve("challenge_negative", "question_one", 7_000, async () => {
      calls += 1;
      return { status: "unavailable", reason: "no_candidate" };
    });
    expect(cache.get("challenge_negative", "question_one")).toMatchObject({
      state: "unavailable",
    });
    expect(calls).toBe(2);

    now = 6_101;
    expect(cache.get("challenge_negative", "question_one")).toEqual({
      state: "expired",
    });
    await cache.resolve("challenge_negative", "question_one", 7_000, async () => {
      calls += 1;
      return resolved;
    });
    expect(calls).toBe(3);
  });

  it("reduces provider failures and never stores a late result after challenge expiry", async () => {
    let now = 10_000;
    let release: ((value: unknown) => void) | undefined;
    const pending = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    const cache = new YouTubeWarmupCache({
      now: () => now,
      pendingTtlMs: 50,
    });
    const work = cache.resolve("challenge_expiring", "question_one", 10_100, async () => pending as never);

    now = 10_101;
    expect(cache.get("challenge_expiring", "question_one")).toEqual({
      state: "expired",
    });
    release?.({
      status: "resolved",
      videoId: "absolutely-private",
      confidence: 100,
      durationMs: 1,
      durationDifferenceMs: 0,
    });
    await expect(work).resolves.toEqual({
      status: "unavailable",
      reason: "unavailable",
    });
    expect(cache.get("challenge_expiring", "question_one")).toBeUndefined();

    await expect(
      cache.resolve("challenge_bad", "question_one", 20_000, async () => {
        throw new Error("provider diagnostic must stay private");
      }),
    ).resolves.toEqual({ status: "unavailable", reason: "unavailable" });
  });
});
