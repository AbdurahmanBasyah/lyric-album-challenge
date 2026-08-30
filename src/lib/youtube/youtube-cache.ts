import type { YouTubeResolution } from "./youtube-types";

export const YOUTUBE_POSITIVE_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
export const YOUTUBE_NEGATIVE_CACHE_TTL_MS = 10 * 60 * 1_000;
export const YOUTUBE_CACHE_MAX_ENTRIES = 500;

const MAX_CONFIGURED_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_CONFIGURED_ENTRIES = 500;

export type YouTubeCacheClock = () => number;

export type YouTubeResolutionCacheOptions = Readonly<{
  now?: YouTubeCacheClock;
  positiveTtlMs?: number;
  negativeTtlMs?: number;
  maxEntries?: number;
}>;

type CacheEntry = Readonly<{
  value: YouTubeResolution;
  expiresAt: number;
}>;

function normalizePositiveInteger(
  value: unknown,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined) {
    return fallback;
  }

  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > maximum
  ) {
    throw new TypeError("YouTube cache configuration is invalid.");
  }

  return value;
}

function normalizeNow(value: unknown): YouTubeCacheClock {
  if (value === undefined) {
    return Date.now;
  }

  if (typeof value !== "function") {
    throw new TypeError("YouTube cache clock is invalid.");
  }

  return value as YouTubeCacheClock;
}

/**
 * Small process-local TTL cache. It deliberately stores only the reduced
 * provider-neutral resolver result, never search responses or API keys.
 */
export class YouTubeResolutionCache {
  private readonly now: YouTubeCacheClock;
  private readonly positiveTtlMs: number;
  private readonly negativeTtlMs: number;
  private readonly maxEntries: number;
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<YouTubeResolution>>();

  constructor(options: YouTubeResolutionCacheOptions = {}) {
    this.now = normalizeNow(options.now);
    this.positiveTtlMs = normalizePositiveInteger(
      options.positiveTtlMs,
      YOUTUBE_POSITIVE_CACHE_TTL_MS,
      MAX_CONFIGURED_TTL_MS,
    );
    this.negativeTtlMs = normalizePositiveInteger(
      options.negativeTtlMs,
      YOUTUBE_NEGATIVE_CACHE_TTL_MS,
      MAX_CONFIGURED_TTL_MS,
    );
    this.maxEntries = normalizePositiveInteger(
      options.maxEntries,
      YOUTUBE_CACHE_MAX_ENTRIES,
      MAX_CONFIGURED_ENTRIES,
    );
  }

  get(key: string): YouTubeResolution | undefined {
    const entry = this.entries.get(key);

    if (entry === undefined) {
      return undefined;
    }

    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }

    // Map iteration order is the eviction order. Refresh a live hit so the
    // cache behaves as an actual LRU rather than FIFO when entries are read.
    this.entries.delete(key);
    this.entries.set(key, entry);

    return entry.value;
  }

  set(key: string, value: YouTubeResolution): void {
    if (typeof key !== "string" || key.length === 0) {
      throw new TypeError("YouTube cache key is invalid.");
    }

    const ttl =
      value.status === "resolved"
        ? this.positiveTtlMs
        : this.negativeTtlMs;
    const entry: CacheEntry = Object.freeze({
      value,
      expiresAt: this.now() + ttl,
    });

    // Delete before setting so a refreshed entry is the newest LRU position.
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

  delete(key: string): void {
    this.entries.delete(key);
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

  /**
   * Deduplicates concurrent work for one key and caches both positive and
   * negative reduced results with their respective TTLs.
   */
  resolve(
    key: string,
    loader: () => Promise<YouTubeResolution>,
  ): Promise<YouTubeResolution> {
    const cached = this.get(key);

    if (cached !== undefined) {
      return Promise.resolve(cached);
    }

    const existing = this.inFlight.get(key);

    if (existing !== undefined) {
      return existing;
    }

    const work = loader().then(
      (value) => {
        this.set(key, value);
        return value;
      },
      (error: unknown) => {
        throw error;
      },
    );

    this.inFlight.set(key, work);
    void work.finally(() => {
      if (this.inFlight.get(key) === work) {
        this.inFlight.delete(key);
      }
    }).catch(() => undefined);

    return work;
  }
}

/** Process-local default; callers can inject an isolated cache in tests. */
export const youtubeResolutionCache = new YouTubeResolutionCache();

export const createYouTubeResolutionCache = (
  options: YouTubeResolutionCacheOptions = {},
): YouTubeResolutionCache => new YouTubeResolutionCache(options);
