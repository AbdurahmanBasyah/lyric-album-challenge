import { z } from "zod";

import type { TrackSummary } from "@/types/tracks";
import {
  fetchWithRetry,
  type RetryClock,
  type RetrySleep,
} from "../http/retry";

export const LRCLIB_GET_URL = "https://lrclib.net/api/get";

/**
 * Keep the fetch boundary injectable so provider behavior can be tested
 * without making network requests.
 */
export type LrclibFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type LrclibClientOptions = Readonly<{
  /** A truthful application identifier supplied by the server caller. */
  clientIdentifier: string;
  fetch?: LrclibFetch;
  sleep?: RetrySleep;
  now?: RetryClock;
}>;

export type LrclibErrorKind =
  | "input"
  | "configuration"
  | "rate_limited"
  | "unavailable"
  | "invalid_response";

export type LrclibUnavailableCategory = "http" | "network";

type LrclibErrorOptions = Readonly<{
  category?: LrclibUnavailableCategory;
  retryAfterSeconds?: number | null;
}>;

const LRCLIB_ERROR_MESSAGES: Readonly<Record<LrclibErrorKind, string>> = {
  input: "Invalid lyrics lookup input.",
  configuration: "Lyrics provider configuration is invalid.",
  rate_limited: "Lyrics provider is rate limited.",
  unavailable: "Lyrics provider is unavailable.",
  invalid_response: "Lyrics provider returned an invalid response.",
};

/**
 * Provider failures are reduced to fixed categories. No provider body,
 * request URL, exception, track metadata, or lyric text is retained.
 */
export class LrclibError extends Error {
  readonly kind: LrclibErrorKind;
  readonly category: LrclibUnavailableCategory | null;
  readonly retryAfterSeconds: number | null;

  constructor(kind: LrclibErrorKind, options: LrclibErrorOptions = {}) {
    super(LRCLIB_ERROR_MESSAGES[kind]);
    this.name = "LrclibError";
    this.kind = kind;
    this.category = kind === "unavailable" ? options.category ?? null : null;
    this.retryAfterSeconds =
      kind === "rate_limited" ? options.retryAfterSeconds ?? null : null;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Only the fields needed by the game pipeline cross the provider boundary.
 * In particular, plain lyrics, Lyricsfile data, and unknown fields are not
 * retained.
 */
export type LrclibTrackRecord = Readonly<{
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  syncedLyrics: string | null;
}>;

const lrclibTrackResponseSchema = z
  .object({
    id: z
      .number()
      .int()
      .positive()
      .refine(Number.isSafeInteger),
    trackName: z.string().trim().min(1),
    artistName: z.string().trim().min(1),
    albumName: z.string().trim().min(1),
    duration: z.number().finite().min(1).max(3600),
    instrumental: z.boolean(),
    syncedLyrics: z.string().nullable(),
  })
  .passthrough();

type LrclibTrackResponse = z.infer<typeof lrclibTrackResponseSchema>;

type ValidatedLookup = Readonly<{
  trackName: string;
  artistName: string;
  durationSeconds: number;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateClientOptions(
  options: LrclibClientOptions,
): Readonly<{
  clientIdentifier: string;
  fetch: LrclibFetch;
  sleep?: RetrySleep;
  now?: RetryClock;
}> {
  if (!isRecord(options)) {
    throw new LrclibError("configuration");
  }

  const rawIdentifier = options.clientIdentifier;

  if (
    typeof rawIdentifier !== "string" ||
    rawIdentifier.trim().length === 0 ||
    /[\r\n]/.test(rawIdentifier)
  ) {
    throw new LrclibError("configuration");
  }

  // Read the ambient implementation through globalThis so a server runtime
  // without native fetch can still fail as a typed configuration error when
  // the caller does not inject one.
  const fetchFunction = options.fetch ?? globalThis.fetch;

  if (typeof fetchFunction !== "function") {
    throw new LrclibError("configuration");
  }

  if (options.sleep !== undefined && typeof options.sleep !== "function") {
    throw new LrclibError("configuration");
  }

  if (options.now !== undefined && typeof options.now !== "function") {
    throw new LrclibError("configuration");
  }

  return {
    clientIdentifier: rawIdentifier.trim(),
    fetch: fetchFunction,
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
    ...(options.now === undefined ? {} : { now: options.now }),
  };
}

function validateLookup(track: TrackSummary): ValidatedLookup {
  if (!isRecord(track)) {
    throw new LrclibError("input");
  }

  const rawTrackName = track.name;
  const rawArtists = track.artistNames;
  const durationMs = track.durationMs;

  const trackName =
    typeof rawTrackName === "string" ? rawTrackName.trim() : "";
  const artistName =
    Array.isArray(rawArtists) && typeof rawArtists[0] === "string"
      ? rawArtists[0].trim()
      : "";

  if (trackName.length === 0 || artistName.length === 0) {
    throw new LrclibError("input");
  }

  if (
    typeof durationMs !== "number" ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  ) {
    throw new LrclibError("input");
  }

  const durationSeconds = durationMs / 1000;

  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds < 1 ||
    durationSeconds > 3600
  ) {
    throw new LrclibError("input");
  }

  return {
    trackName,
    artistName,
    durationSeconds,
  };
}

function buildLookupUrl(lookup: ValidatedLookup): URL {
  const url = new URL(LRCLIB_GET_URL);
  url.searchParams.set("track_name", lookup.trackName);
  url.searchParams.set("artist_name", lookup.artistName);
  url.searchParams.set("duration", String(lookup.durationSeconds));
  return url;
}

function parseRetryAfterSeconds(response: Response): number | null {
  let value: string | null;

  try {
    value = response.headers.get("Retry-After");
  } catch {
    return null;
  }

  if (value === null || !/^(?:0|[1-9]\d*)$/.test(value)) {
    return null;
  }

  const seconds = Number(value);

  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : null;
}

function reduceTrackResponse(
  response: LrclibTrackResponse,
): LrclibTrackRecord {
  return {
    id: response.id,
    trackName: response.trackName,
    artistName: response.artistName,
    albumName: response.albumName,
    duration: response.duration,
    instrumental: response.instrumental,
    syncedLyrics: response.syncedLyrics,
  };
}

/**
 * Performs one exact LRCLIB `/api/get` lookup for a Spotify track summary.
 * Metadata validation happens before the injected fetch dependency is called.
 */
export async function getLrclibTrack(
  track: TrackSummary,
  options: LrclibClientOptions,
): Promise<LrclibTrackRecord | null> {
  const { clientIdentifier, fetch: fetchFunction, sleep, now } =
    validateClientOptions(options);
  const lookup = validateLookup(track);
  const url = buildLookupUrl(lookup);

  let response: Response;

  try {
    response = await fetchWithRetry(
      url.toString(),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Lrclib-Client": clientIdentifier,
        },
      },
      { fetch: fetchFunction, sleep, now },
    );
  } catch {
    throw new LrclibError("unavailable", { category: "network" });
  }

  if (response.status === 404) {
    return null;
  }

  if (response.status === 429) {
    throw new LrclibError("rate_limited", {
      retryAfterSeconds: parseRetryAfterSeconds(response),
    });
  }

  if (response.status !== 200) {
    throw new LrclibError("unavailable", { category: "http" });
  }

  let rawResponse: unknown;

  try {
    rawResponse = await response.json();
  } catch {
    throw new LrclibError("invalid_response");
  }

  let parsed: ReturnType<typeof lrclibTrackResponseSchema.safeParse>;

  try {
    parsed = lrclibTrackResponseSchema.safeParse(rawResponse);
  } catch {
    throw new LrclibError("invalid_response");
  }

  if (!parsed.success) {
    throw new LrclibError("invalid_response");
  }

  return reduceTrackResponse(parsed.data);
}

/** A descriptive alias for callers that prefer lookup terminology. */
export const lookupLrclibTrack = getLrclibTrack;
