import { z } from "zod";

import {
  type YouTubeSourceType,
  type YouTubeVideoCandidate,
} from "./youtube-types";
import {
  fetchWithRetry,
  type RetryClock,
  type RetrySleep,
} from "../http/retry";

/** Official YouTube Data API v3 endpoints. These are server-only constants. */
export const YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
export const YOUTUBE_VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";

export const YOUTUBE_MAX_SEARCH_QUERIES = 2;
export const YOUTUBE_SEARCH_MAX_RESULTS = 5;
export const YOUTUBE_MAX_DETAIL_IDS =
  YOUTUBE_MAX_SEARCH_QUERIES * YOUTUBE_SEARCH_MAX_RESULTS;
export const YOUTUBE_REQUEST_TIMEOUT_MS = 8_000;
export const YOUTUBE_MAX_RESPONSE_BYTES = 512 * 1024;
export const YOUTUBE_MAX_DURATION_MS = 24 * 60 * 60 * 1_000;

const MAX_CONFIGURED_TIMEOUT_MS = 60_000;
const MAX_CONFIGURED_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_API_KEY_LENGTH = 256;
const MAX_QUERY_LENGTH = 256;
const MAX_VIDEO_ID_LENGTH = 128;
const MAX_TITLE_LENGTH = 512;
const MAX_CHANNEL_TITLE_LENGTH = 256;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;

export type YouTubeFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type YouTubeClientErrorKind =
  | "invalid_input"
  | "configuration"
  | "rate_limited"
  | "forbidden"
  | "unavailable"
  | "invalid_response"
  | "timeout";

/** Provider errors retain only stable categories, never response details. */
export class YouTubeClientError extends Error {
  readonly kind: YouTubeClientErrorKind;

  constructor(kind: YouTubeClientErrorKind) {
    const messages: Readonly<Record<YouTubeClientErrorKind, string>> = {
      invalid_input: "YouTube lookup input is invalid.",
      configuration: "YouTube provider configuration is invalid.",
      rate_limited: "YouTube provider is rate limited.",
      forbidden: "YouTube provider access is forbidden.",
      unavailable: "YouTube provider is unavailable.",
      invalid_response: "YouTube provider returned an invalid response.",
      timeout: "YouTube provider timed out.",
    };

    super(messages[kind]);
    this.name = "YouTubeClientError";
    this.kind = kind;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type YouTubeDataApiClientOptions = Readonly<{
  apiKey: string;
  fetch?: YouTubeFetch;
  sleep?: RetrySleep;
  now?: RetryClock;
  timeoutMs?: number;
  maxResponseBytes?: number;
}>;

export type YouTubeSearchCandidate = Readonly<{
  videoId: string;
  title: string;
  channelTitle: string;
}>;

const youtubeVideoIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_VIDEO_ID_LENGTH)
  .regex(YOUTUBE_VIDEO_ID_PATTERN);

const youtubeSearchEnvelopeSchema = z
  .object({
    items: z.array(z.unknown()).max(YOUTUBE_SEARCH_MAX_RESULTS),
  })
  .passthrough();

const youtubeSearchItemSchema = z
  .object({
    id: z
      .object({
        videoId: youtubeVideoIdSchema,
      })
      .passthrough(),
    snippet: z
      .object({
        title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
        channelTitle: z.string().trim().min(1).max(MAX_CHANNEL_TITLE_LENGTH),
      })
      .passthrough(),
  })
  .passthrough();

const youtubeDetailsEnvelopeSchema = z
  .object({
    items: z.array(z.unknown()).max(YOUTUBE_MAX_DETAIL_IDS),
  })
  .passthrough();

const youtubeDetailsItemSchema = z
  .object({
    id: youtubeVideoIdSchema,
    snippet: z
      .object({
        title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
        channelTitle: z.string().trim().min(1).max(MAX_CHANNEL_TITLE_LENGTH),
      })
      .passthrough(),
    contentDetails: z
      .object({
        duration: z.string().trim().min(1).max(64),
        licensedContent: z.boolean().nullable().optional(),
      })
      .passthrough(),
    status: z
      .object({
        embeddable: z.boolean(),
        privacyStatus: z.enum(["public", "unlisted", "private"]),
        uploadStatus: z
          .enum(["uploaded", "processed", "claimed", "failed", "rejected", "deleted"])
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
    throw new YouTubeClientError("configuration");
  }

  return value;
}

function normalizeApiKey(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.trim().length > MAX_API_KEY_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new YouTubeClientError("configuration");
  }

  return value.trim();
}

function normalizeQuery(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.trim().length > MAX_QUERY_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new YouTubeClientError("invalid_input");
  }

  return value.trim();
}

function normalizeVideoIds(value: readonly string[]): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > YOUTUBE_MAX_DETAIL_IDS
  ) {
    throw new YouTubeClientError("invalid_input");
  }

  const ids = value.map((id) => {
    if (
      typeof id !== "string" ||
      !YOUTUBE_VIDEO_ID_PATTERN.test(id.trim())
    ) {
      throw new YouTubeClientError("invalid_input");
    }

    return id.trim();
  });

  if (new Set(ids).size !== ids.length) {
    return Object.freeze([...new Set(ids)]);
  }

  return Object.freeze(ids);
}

/**
 * Parses YouTube's ISO-8601 video duration into bounded milliseconds. Calendar
 * units are intentionally unsupported because they do not describe a fixed
 * media duration.
 */
export function parseYouTubeDuration(value: unknown): number | null {
  if (typeof value !== "string" || value.length > 64) {
    return null;
  }

  // YouTube media durations are fixed elapsed times. Reject ISO calendar
  // units (including days) instead of treating them as a media clock.
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/u.exec(
    value,
  );

  if (match === null || match.slice(1).every((part) => part === undefined)) {
    return null;
  }

  const [hours, minutes, seconds] = match.slice(1).map((part) =>
    part === undefined ? 0 : Number(part),
  );
  const totalSeconds =
    hours * 3_600 + minutes * 60 + seconds;

  if (
    !Number.isSafeInteger(hours) ||
    !Number.isSafeInteger(minutes) ||
    minutes >= 60 ||
    hours >= 24 ||
    seconds >= 60 ||
    !Number.isFinite(totalSeconds) ||
    totalSeconds <= 0 ||
    totalSeconds * 1_000 > YOUTUBE_MAX_DURATION_MS
  ) {
    return null;
  }

  const durationMs = Math.round(totalSeconds * 1_000);

  return Number.isSafeInteger(durationMs) && durationMs > 0
    ? durationMs
    : null;
}

function classifyHttpStatus(status: number): YouTubeClientErrorKind {
  if (status === 401) {
    return "configuration";
  }

  if (status === 403) {
    return "forbidden";
  }

  if (status === 429) {
    return "rate_limited";
  }

  if (status === 400) {
    return "invalid_response";
  }

  return status >= 500 ? "unavailable" : "unavailable";
}

async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  let contentLength: string | null;

  try {
    contentLength = response.headers.get("content-length");
  } catch {
    throw new YouTubeClientError("invalid_response");
  }

  if (
    contentLength !== null &&
    (!/^(?:0|[1-9]\d*)$/u.test(contentLength) ||
      Number(contentLength) > maxBytes)
  ) {
    throw new YouTubeClientError("invalid_response");
  }

  if (response.body === null) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const next = await reader.read();

      if (next.done) {
        break;
      }

      if (!(next.value instanceof Uint8Array)) {
        throw new YouTubeClientError("invalid_response");
      }

      totalBytes += next.value.byteLength;

      if (!Number.isSafeInteger(totalBytes) || totalBytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Cancellation is best effort after the deterministic rejection.
        }

        throw new YouTubeClientError("invalid_response");
      }

      chunks.push(next.value);
    }
  } catch (error) {
    if (error instanceof YouTubeClientError) {
      throw error;
    }

    throw new YouTubeClientError("unavailable");
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new YouTubeClientError("invalid_response");
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new YouTubeClientError("invalid_response");
  }
}

function freezeSearchCandidate(
  value: YouTubeSearchCandidate,
): YouTubeSearchCandidate {
  return Object.freeze({
    videoId: value.videoId,
    title: value.title,
    channelTitle: value.channelTitle,
  });
}

function freezeVideoCandidate(
  value: YouTubeVideoCandidate,
): YouTubeVideoCandidate {
  return Object.freeze({
    videoId: value.videoId,
    title: value.title,
    channelTitle: value.channelTitle,
    durationMs: value.durationMs,
    embeddable: value.embeddable,
    licensedContent: value.licensedContent,
    sourceType: value.sourceType,
  });
}

function withTimeout<T>(
  operation: Promise<T>,
  controller: AbortController,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      controller.abort();
      reject(new YouTubeClientError("timeout"));
    }, timeoutMs);

    operation.then(
      (value) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export class YouTubeDataApiClient {
  private readonly apiKey: string;
  private readonly fetchFunction: YouTubeFetch;
  private readonly sleep: RetrySleep | undefined;
  private readonly now: RetryClock | undefined;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(options: YouTubeDataApiClientOptions) {
    if (!isRecord(options)) {
      throw new YouTubeClientError("configuration");
    }

    const fetchFunction = options.fetch ?? globalThis.fetch;

    if (typeof fetchFunction !== "function") {
      throw new YouTubeClientError("configuration");
    }

    if (options.sleep !== undefined && typeof options.sleep !== "function") {
      throw new YouTubeClientError("configuration");
    }

    if (options.now !== undefined && typeof options.now !== "function") {
      throw new YouTubeClientError("configuration");
    }

    this.apiKey = normalizeApiKey(options.apiKey);
    this.fetchFunction = fetchFunction;
    this.sleep = options.sleep;
    this.now = options.now;
    this.timeoutMs = normalizePositiveInteger(
      options.timeoutMs,
      YOUTUBE_REQUEST_TIMEOUT_MS,
      MAX_CONFIGURED_TIMEOUT_MS,
    );
    this.maxResponseBytes = normalizePositiveInteger(
      options.maxResponseBytes,
      YOUTUBE_MAX_RESPONSE_BYTES,
      MAX_CONFIGURED_RESPONSE_BYTES,
    );
  }

  private async requestJson(url: URL): Promise<unknown> {
    const controller = new AbortController();
    const operation = (async (): Promise<unknown> => {
      let response: Response;

      try {
        response = await fetchWithRetry(
          url.toString(),
          {
            method: "GET",
            headers: { Accept: "application/json" },
            credentials: "omit",
            redirect: "error",
            signal: controller.signal,
          },
          {
            fetch: this.fetchFunction,
            sleep: this.sleep,
            now: this.now,
          },
        );
      } catch {
        throw new YouTubeClientError("unavailable");
      }

      if (!response.ok) {
        throw new YouTubeClientError(classifyHttpStatus(response.status));
      }

      const body = await readBoundedResponseText(
        response,
        this.maxResponseBytes,
      );
      return parseJson(body);
    })();

    return withTimeout(operation, controller, this.timeoutMs);
  }

  async searchVideos(query: string): Promise<readonly YouTubeSearchCandidate[]> {
    const normalizedQuery = normalizeQuery(query);
    const url = new URL(YOUTUBE_SEARCH_URL);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("q", normalizedQuery);
    url.searchParams.set("type", "video");
    url.searchParams.set("videoEmbeddable", "true");
    url.searchParams.set("maxResults", String(YOUTUBE_SEARCH_MAX_RESULTS));
    url.searchParams.set("key", this.apiKey);

    const payload = await this.requestJson(url);
    const envelope = youtubeSearchEnvelopeSchema.safeParse(payload);

    if (!envelope.success) {
      throw new YouTubeClientError("invalid_response");
    }

    const candidates: YouTubeSearchCandidate[] = [];
    const seenIds = new Set<string>();

    for (const item of envelope.data.items) {
      const parsed = youtubeSearchItemSchema.safeParse(item);

      if (!parsed.success) {
        continue;
      }

      const videoId = parsed.data.id.videoId;

      if (seenIds.has(videoId)) {
        continue;
      }

      seenIds.add(videoId);
      candidates.push(
        freezeSearchCandidate({
          videoId,
          title: parsed.data.snippet.title,
          channelTitle: parsed.data.snippet.channelTitle,
        }),
      );
    }

    return Object.freeze(candidates);
  }

  async getVideoDetails(
    videoIds: readonly string[],
  ): Promise<readonly YouTubeVideoCandidate[]> {
    const ids = normalizeVideoIds(videoIds);
    const url = new URL(YOUTUBE_VIDEOS_URL);
    url.searchParams.set("part", "snippet,contentDetails,status");
    url.searchParams.set("id", ids.join(","));
    url.searchParams.set("key", this.apiKey);

    const payload = await this.requestJson(url);
    const envelope = youtubeDetailsEnvelopeSchema.safeParse(payload);

    if (!envelope.success) {
      throw new YouTubeClientError("invalid_response");
    }

    const candidates: YouTubeVideoCandidate[] = [];
    const requestedIds = new Set(ids);

    for (const item of envelope.data.items) {
      const parsed = youtubeDetailsItemSchema.safeParse(item);

      if (!parsed.success) {
        continue;
      }

      const details = parsed.data;

      if (
        !requestedIds.has(details.id) ||
        !details.status.embeddable ||
        details.status.privacyStatus === "private" ||
        details.status.uploadStatus === "failed" ||
        details.status.uploadStatus === "rejected" ||
        details.status.uploadStatus === "deleted"
      ) {
        continue;
      }

      const durationMs = parseYouTubeDuration(details.contentDetails.duration);

      if (durationMs === null) {
        continue;
      }

      candidates.push(
        freezeVideoCandidate({
          videoId: details.id,
          title: details.snippet.title,
          channelTitle: details.snippet.channelTitle,
          durationMs,
          embeddable: details.status.embeddable,
          licensedContent: details.contentDetails.licensedContent ?? null,
          sourceType: "other" as YouTubeSourceType,
        }),
      );
    }

    return Object.freeze(candidates);
  }
}

/** Descriptive aliases for server callers and focused tests. */
export const YouTubeApiClient = YouTubeDataApiClient;
export const createYouTubeDataApiClient = (
  options: YouTubeDataApiClientOptions,
): YouTubeDataApiClient => new YouTubeDataApiClient(options);
