import { describe, expect, it, vi } from "vitest";

import {
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_ATTEMPTS,
  RETRY_MAX_DELAY_MS,
  fetchWithRetry,
  isRetryableHttpStatus,
  parseRetryAfterDelayMs,
  type RetryFetch,
} from "./retry";

function response(status = 200, headers?: HeadersInit): Response {
  return new Response(null, { status, headers });
}

describe("bounded GET retry helper", () => {
  it("retries a transient HTTP response once and returns the later success", async () => {
    const fetchMock = vi
      .fn<RetryFetch>()
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200));
    const sleep = vi.fn(async () => undefined);

    const result = await fetchWithRetry(
      "https://provider.example/resource",
      { method: "GET" },
      { fetch: fetchMock, sleep },
    );

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(RETRY_BASE_DELAY_MS);
  });

  it("retries a transient network failure once without duplicating side effects", async () => {
    const firstFailure = new Error("transport detail must stay with caller");
    const fetchMock = vi
      .fn<RetryFetch>()
      .mockRejectedValueOnce(firstFailure)
      .mockResolvedValueOnce(response(200));
    const sleep = vi.fn(async () => undefined);

    await expect(
      fetchWithRetry(
        "https://provider.example/resource",
        { method: "GET" },
        { fetch: fetchMock, sleep },
      ),
    ).resolves.toMatchObject({ status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      fetchMock.mock.calls[1]?.[1],
    );
  });

  it("returns a final rate limit after exactly two total attempts", async () => {
    const fetchMock = vi
      .fn<RetryFetch>()
      .mockResolvedValueOnce(response(429, { "Retry-After": "1" }))
      .mockResolvedValueOnce(response(429, { "Retry-After": "999999" }));
    const sleep = vi.fn(async () => undefined);

    const result = await fetchWithRetry(
      "https://provider.example/resource",
      { method: "GET" },
      { fetch: fetchMock, sleep },
    );

    expect(result.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(RETRY_MAX_ATTEMPTS);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1_000);
  });

  it("caps valid Retry-After values and falls back for malformed values", () => {
    expect(
      parseRetryAfterDelayMs(response(429, { "Retry-After": "999999" })),
    ).toBe(RETRY_MAX_DELAY_MS);
    expect(
      parseRetryAfterDelayMs(response(429, { "Retry-After": "0" })),
    ).toBe(0);

    for (const value of ["", "01", "-1", "1.5", "1e2", "9007199254740992"]) {
      expect(
        parseRetryAfterDelayMs(response(429, { "Retry-After": value })),
      ).toBeNull();
    }

    const now = Date.parse("Wed, 15 Nov 2023 00:00:02 GMT");
    expect(
      parseRetryAfterDelayMs(
        response(429, { "Retry-After": "Wed, 15 Nov 2023 00:00:01 GMT" }),
        () => now,
      ),
    ).toBe(0);
  });

  it.each([400, 401, 403, 404, 409, 422])(
    "does not retry permanent or auth status %s",
    async (status) => {
      const fetchMock = vi.fn<RetryFetch>().mockResolvedValue(response(status));
      const sleep = vi.fn(async () => undefined);

      const result = await fetchWithRetry(
        "https://provider.example/resource",
        { method: "GET" },
        { fetch: fetchMock, sleep },
      );

      expect(result.status).toBe(status);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    },
  );

  it.each([408, 425, 429, 500, 502, 503, 504])(
    "recognizes transient status %s",
    (status) => {
      expect(isRetryableHttpStatus(status)).toBe(true);
    },
  );

  it("never retries a POST, even when its response is transient", async () => {
    const fetchMock = vi.fn<RetryFetch>().mockResolvedValue(response(503));
    const sleep = vi.fn(async () => undefined);

    const result = await fetchWithRetry(
      "https://provider.example/resource",
      { method: "POST", body: "one side effect" },
      { fetch: fetchMock, sleep },
    );

    expect(result.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("propagates an aborted request without retrying or sleeping", async () => {
    const controller = new AbortController();
    const abortError = new DOMException("aborted", "AbortError");
    const fetchMock = vi.fn<RetryFetch>(async () => {
      controller.abort();
      throw abortError;
    });
    const sleep = vi.fn(async () => undefined);

    await expect(
      fetchWithRetry(
        "https://provider.example/resource",
        { method: "GET", signal: controller.signal },
        { fetch: fetchMock, sleep },
      ),
    ).rejects.toBe(abortError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not delay or retry schema-invalid success responses", async () => {
    const fetchMock = vi.fn<RetryFetch>().mockResolvedValue(response(200));
    const sleep = vi.fn(async () => undefined);

    const result = await fetchWithRetry(
      "https://provider.example/resource",
      { method: "GET" },
      { fetch: fetchMock, sleep },
    );

    // Schema validation belongs to the adapter; this transport helper only
    // sees the successful status and therefore cannot manufacture a retry.
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
