import type { YouTubeResolution } from "../youtube/youtube-types";
import {
  YOUTUBE_NEGATIVE_CACHE_TTL_MS,
  YOUTUBE_POSITIVE_CACHE_TTL_MS,
} from "../youtube/youtube-cache";

/** Keep an in-flight lookup visible as pending without retaining it forever. */
export const YOUTUBE_WARMUP_PENDING_TTL_MS = 30 * 1_000;
export const YOUTUBE_WARMUP_MAX_ENTRIES = 100;

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/u;
const UNAVAILABLE_REASONS = new Set([
  "invalid_input",
  "configuration",
  "rate_limited",
  "unavailable",
  "invalid_response",
  "timeout",
  "no_candidate",
  "low_confidence",
  // Keep compatibility with older injected resolver seams while normalizing
  // to the provider's canonical underscore spelling below.
  "rate-limited",
  "no-candidate",
  "low-confidence",
]);

function normalizeUnavailableReason(
  value: string,
): Extract<YouTubeResolution, { status: "unavailable" }>["reason"] {
  switch (value) {
    case "rate-limited":
      return "rate_limited";
    case "no-candidate":
      return "no_candidate";
    case "low-confidence":
      return "low_confidence";
    default:
      return value as Extract<YouTubeResolution, { status: "unavailable" }>["reason"];
  }
}

export type YouTubeWarmupClock = () => number;

export type YouTubeWarmupOptions = Readonly<{
  now?: YouTubeWarmupClock;
  positiveTtlMs?: number;
  negativeTtlMs?: number;
  pendingTtlMs?: number;
  maxEntries?: number;
}>;

export type YouTubeWarmupLookup =
  | Readonly<{ state: "pending"; expiresAt: number }>
  | Readonly<{
      state: "resolved";
      expiresAt: number;
      resolution: Extract<YouTubeResolution, { status: "resolved" }>;
    }>
  | Readonly<{
      state: "unavailable";
      expiresAt: number;
      resolution: Extract<YouTubeResolution, { status: "unavailable" }>;
    }>
  | Readonly<{ state: "expired" }>;

export type YouTubeWarmupLoader = () => Promise<YouTubeResolution>;

type WarmupEntry =
  | Readonly<{ state: "pending"; expiresAt: number }>
  | Readonly<{
      state: "resolved";
      expiresAt: number;
      resolution: Extract<YouTubeResolution, { status: "resolved" }>;
    }>
  | Readonly<{
      state: "unavailable";
      expiresAt: number;
      resolution: Extract<YouTubeResolution, { status: "unavailable" }>;
    }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError("YouTube warmup configuration is invalid.");
  }

  return value as number;
}

function normalizeNow(value: unknown): YouTubeWarmupClock {
  if (value === undefined) {
    return Date.now;
  }

  if (typeof value !== "function") {
    throw new TypeError("YouTube warmup clock is invalid.");
  }

  return value as YouTubeWarmupClock;
}

/**
 * Opaque route handles are the namespace for warmup state. Track metadata is
 * deliberately absent from this key so one question can never reuse another
 * question's candidate.
 */
export function makeYouTubeWarmupCacheKey(
  challengeId: string,
  questionId: string,
): string {
  if (
    typeof challengeId !== "string" ||
    challengeId.length === 0 ||
    typeof questionId !== "string" ||
    questionId.length === 0
  ) {
    throw new TypeError("YouTube warmup handles are invalid.");
  }

  return `youtube-warmup-v1\u0000${challengeId}\u0000${questionId}`;
}

function unavailable(): Extract<YouTubeResolution, { status: "unavailable" }> {
  return Object.freeze({ status: "unavailable" as const, reason: "unavailable" as const });
}

/** Keep only the reduced resolver result in the warmup cache. */
function reduceResolution(value: unknown): YouTubeResolution {
  if (!isRecord(value)) {
    return unavailable();
  }

  if (value.status === "unavailable") {
    return Object.freeze({
      status: "unavailable" as const,
      reason:
        typeof value.reason === "string" && UNAVAILABLE_REASONS.has(value.reason)
          ? normalizeUnavailableReason(value.reason)
          : "unavailable",
    });
  }

  if (
    value.status !== "resolved" ||
    typeof value.videoId !== "string" ||
    !VIDEO_ID_PATTERN.test(value.videoId) ||
    typeof value.confidence !== "number" ||
    !Number.isSafeInteger(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 100 ||
    typeof value.durationMs !== "number" ||
    !Number.isSafeInteger(value.durationMs) ||
    value.durationMs < 0 ||
    typeof value.durationDifferenceMs !== "number" ||
    !Number.isSafeInteger(value.durationDifferenceMs) ||
    value.durationDifferenceMs < 0
  ) {
    return unavailable();
  }

  return Object.freeze({
    status: "resolved" as const,
    videoId: value.videoId,
    confidence: value.confidence,
    durationMs: value.durationMs,
    durationDifferenceMs: value.durationDifferenceMs,
  });
}

function isChallengeExpiry(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/**
 * Process-local, bounded warmup state. It is intentionally separate from the
 * resolver's metadata cache: the route identity is part of this key and the
 * challenge expiry bounds every entry.
 */
export class YouTubeWarmupCache {
  private readonly now: YouTubeWarmupClock;
  private readonly positiveTtlMs: number;
  private readonly negativeTtlMs: number;
  private readonly pendingTtlMs: number;
  private readonly maxEntries: number;
  private readonly entries = new Map<string, WarmupEntry>();
  private readonly inFlight = new Map<string, Promise<YouTubeResolution>>();

  constructor(options: YouTubeWarmupOptions = {}) {
    this.now = normalizeNow(options.now);
    this.positiveTtlMs = positiveInteger(
      options.positiveTtlMs,
      YOUTUBE_POSITIVE_CACHE_TTL_MS,
    );
    this.negativeTtlMs = positiveInteger(
      options.negativeTtlMs,
      YOUTUBE_NEGATIVE_CACHE_TTL_MS,
    );
    this.pendingTtlMs = positiveInteger(
      options.pendingTtlMs,
      YOUTUBE_WARMUP_PENDING_TTL_MS,
    );
    this.maxEntries = positiveInteger(
      options.maxEntries,
      YOUTUBE_WARMUP_MAX_ENTRIES,
    );
  }

  private expiry(now: number, challengeExpiresAt: number, ttl: number): number {
    if (!isChallengeExpiry(challengeExpiresAt) || challengeExpiresAt <= now) {
      return now;
    }

    return Math.min(challengeExpiresAt, now + ttl);
  }

  private set(key: string, entry: WarmupEntry): void {
    this.entries.delete(key);

    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;

      if (typeof oldest !== "string") {
        break;
      }

      this.entries.delete(oldest);
    }

    this.entries.set(key, entry);
  }

  get(
    challengeId: string,
    questionId: string,
  ): YouTubeWarmupLookup | undefined {
    const key = makeYouTubeWarmupCacheKey(challengeId, questionId);
    const entry = this.entries.get(key);

    if (entry === undefined) {
      return this.inFlight.has(key)
        ? Object.freeze({ state: "pending" as const, expiresAt: this.now() })
        : undefined;
    }

    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return Object.freeze({ state: "expired" as const });
    }

    this.entries.delete(key);
    this.entries.set(key, entry);

    return entry;
  }

  /**
   * Starts or joins one resolver operation. The promise always resolves to a
   * reduced value, allowing a detached route task to be safely caught.
   */
  resolve(
    challengeId: string,
    questionId: string,
    challengeExpiresAt: number,
    loader: YouTubeWarmupLoader,
  ): Promise<YouTubeResolution> {
    const key = makeYouTubeWarmupCacheKey(challengeId, questionId);
    const cached = this.get(challengeId, questionId);

    if (cached?.state === "resolved" || cached?.state === "unavailable") {
      return Promise.resolve(cached.resolution);
    }

    const existing = this.inFlight.get(key);

    if (existing !== undefined) {
      return existing;
    }

    const now = this.now();
    const pendingExpiry = this.expiry(
      now,
      challengeExpiresAt,
      this.pendingTtlMs,
    );

    if (pendingExpiry <= now) {
      return Promise.resolve(unavailable());
    }

    this.set(
      key,
      Object.freeze({ state: "pending" as const, expiresAt: pendingExpiry }),
    );

    const work = Promise.resolve()
      .then(loader)
      .then(reduceResolution, () => unavailable())
      .then((resolution) => {
        const resolvedAt = this.now();

        // A late provider response must not resurrect an expired challenge.
        if (
          !isChallengeExpiry(challengeExpiresAt) ||
          challengeExpiresAt <= resolvedAt
        ) {
          this.entries.delete(key);
          return resolution;
        }

        const ttl =
          resolution.status === "resolved"
            ? this.positiveTtlMs
            : this.negativeTtlMs;
        const expiresAt = this.expiry(resolvedAt, challengeExpiresAt, ttl);

        if (expiresAt > resolvedAt) {
          this.set(
            key,
            resolution.status === "resolved"
              ? Object.freeze({
                  state: "resolved" as const,
                  resolution,
                  expiresAt,
                })
              : Object.freeze({
                  state: "unavailable" as const,
                  resolution,
                  expiresAt,
                }),
          );
        } else {
          this.entries.delete(key);
        }

        return resolution;
      });

    this.inFlight.set(key, work);
    void work.finally(() => {
      if (this.inFlight.get(key) === work) {
        this.inFlight.delete(key);
      }
    }).catch(() => undefined);

    return work;
  }

  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  get inFlightSize(): number {
    return this.inFlight.size;
  }
}

/** Shared server-process warmup cache; tests can inject isolated instances. */
export const youtubeWarmupCache = new YouTubeWarmupCache();
