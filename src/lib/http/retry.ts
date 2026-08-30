/**
 * Small, server-side retry boundary for idempotent provider GET requests.
 *
 * The helper deliberately owns only transport behavior.  Callers continue to
 * classify the final response and validate its body, so a provider's response
 * shape and error taxonomy never become part of this shared utility.
 */

export type RetryFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type RetrySleep = (delayMs: number) => Promise<void>;
export type RetryClock = () => number;

export type RetryRequestDependencies = Readonly<{
  /** Injected fetch keeps provider adapters deterministic in unit tests. */
  fetch?: RetryFetch;
  /** Injected sleep prevents tests from waiting on real backoff timers. */
  sleep?: RetrySleep;
  /** Injected clock is used when a bounded HTTP-date Retry-After is supplied. */
  now?: RetryClock;
}>;

export type RetryOptions = RetryRequestDependencies;

/** Two total attempts means at most one retry for any request. */
export const RETRY_MAX_ATTEMPTS = 2;
export const RETRY_BASE_DELAY_MS = 250;
export const RETRY_MAX_DELAY_MS = 2_000;

const TRANSIENT_HTTP_STATUSES = new Set([
  408,
  425,
  429,
  500,
  502,
  503,
  504,
]);

const HTTP_DATE_PATTERN =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/u;

/** Returns true only for statuses safe to retry for a GET. */
export function isRetryableHttpStatus(status: number): boolean {
  return TRANSIENT_HTTP_STATUSES.has(status);
}

function isAbortError(error: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError") ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { name?: unknown }).name === "AbortError")
  );
}

function createAbortError(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException("The operation was aborted.", "AbortError");
  }

  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | null | undefined): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

/**
 * Retry-After supports both seconds and an HTTP date.  Integer seconds are
 * the provider contract used by this app; date support is retained for
 * standards-compliant providers, but both forms are hard-capped.  Any
 * malformed, negative, fractional, unsafe, or overlong value falls back to
 * exponential delay instead of being trusted.
 */
export function parseRetryAfterDelayMs(
  response: Response,
  now: RetryClock = Date.now,
): number | null {
  let value: string | null;

  try {
    value = response.headers.get("Retry-After");
  } catch {
    return null;
  }

  if (value === null || value.length === 0 || value.length > 128) {
    return null;
  }

  // Keep the integer form canonical.  This rejects signs, fractions,
  // scientific notation, leading whitespace, and unsafe integer overflow.
  if (/^(?:0|[1-9]\d*)$/u.test(value)) {
    const seconds = Number(value);

    if (Number.isSafeInteger(seconds) && seconds >= 0) {
      return Math.min(seconds * 1_000, RETRY_MAX_DELAY_MS);
    }

    return null;
  }

  // RFC 9110 also permits an HTTP date.  It is useful for compliant
  // providers, but the same hard cap prevents an attacker-controlled date
  // from delaying a request indefinitely.
  if (!HTTP_DATE_PATTERN.test(value)) {
    return null;
  }

  const targetMs = Date.parse(value);

  if (!Number.isFinite(targetMs)) {
    return null;
  }

  let nowMs: number;

  try {
    nowMs = now();
  } catch {
    return null;
  }

  if (!Number.isFinite(nowMs)) {
    return null;
  }

  return Math.min(Math.max(0, targetMs - nowMs), RETRY_MAX_DELAY_MS);
}

function fallbackDelayMs(retryNumber: number): number {
  const exponent = Math.max(0, retryNumber - 1);
  const delay = RETRY_BASE_DELAY_MS * 2 ** exponent;

  return Math.min(delay, RETRY_MAX_DELAY_MS);
}

function sleepWithAbort(
  delayMs: number,
  signal: AbortSignal | null | undefined,
): Promise<void> {
  if (delayMs <= 0) {
    throwIfAborted(signal);
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(createAbortError());
    };

    const onTimer = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve();
    };

    const timer = setTimeout(onTimer, delayMs);

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Executes a request with one bounded retry.  The method guard is deliberate:
 * callers can safely pass request options through this helper, while POST or
 * any other non-GET operation always receives exactly one attempt.
 *
 * Failed response bodies are never consumed here.  The provider adapter owns
 * final status mapping and decides whether a successful body is schema-valid.
 */
export async function fetchWithRetry(
  input: string | URL,
  init: RequestInit = {},
  dependencies: RetryRequestDependencies = {},
): Promise<Response> {
  const fetchFunction = dependencies.fetch ?? globalThis.fetch;

  if (typeof fetchFunction !== "function") {
    throw new TypeError("A fetch implementation is required.");
  }

  const method = (init.method ?? "GET").toUpperCase();
  const canRetry = method === "GET";
  const signal = init.signal;
  const sleep = dependencies.sleep ?? ((delayMs: number) =>
    sleepWithAbort(delayMs, signal));
  const now = dependencies.now ?? Date.now;

  for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt += 1) {
    throwIfAborted(signal);

    let response: Response;

    try {
      response = await fetchFunction(input, init);
    } catch (error) {
      // Abort is caller-controlled and must not be converted into a retry.
      if (!canRetry || signal?.aborted || isAbortError(error)) {
        throw error;
      }

      if (attempt >= RETRY_MAX_ATTEMPTS) {
        throw error;
      }

      const delayMs = Math.min(
        fallbackDelayMs(attempt),
        RETRY_MAX_DELAY_MS,
      );
      await sleep(delayMs);
      throwIfAborted(signal);
      continue;
    }

    if (
      !canRetry ||
      !isRetryableHttpStatus(response.status) ||
      attempt >= RETRY_MAX_ATTEMPTS
    ) {
      return response;
    }

    throwIfAborted(signal);

    const retryAfterMs = parseRetryAfterDelayMs(response, now);
    const delayMs = retryAfterMs ?? fallbackDelayMs(attempt);
    await sleep(Math.min(delayMs, RETRY_MAX_DELAY_MS));
    throwIfAborted(signal);
  }

  // The loop always returns or throws before this point.  Keep a defensive
  // failure for future edits without fabricating a provider response.
  throw new Error("Retry loop exhausted unexpectedly.");
}

/** Descriptive aliases for callers that prefer retry-oriented terminology. */
export const retryFetch = fetchWithRetry;
export const retryGet = fetchWithRetry;
