import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  YouTubeClientError,
  YouTubeDataApiClient,
  YOUTUBE_SEARCH_MAX_RESULTS,
  YOUTUBE_SEARCH_URL,
  YOUTUBE_VIDEOS_URL,
  parseYouTubeDuration,
} from "./youtube-client";

const searchFixture = JSON.parse(
  readFileSync(new URL("./fixtures/search-results.json", import.meta.url), "utf8"),
) as unknown;
const detailsFixture = JSON.parse(
  readFileSync(new URL("./fixtures/video-details.json", import.meta.url), "utf8"),
) as unknown;

function jsonResponse(value: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("YouTube Data API client", () => {
  it("builds the bounded search request and reduces sanitized results", async () => {
    const fetchMock = vi.fn(
      async (input: string | URL, init?: RequestInit): Promise<Response> => {
        const url = new URL(String(input));

        expect(url.origin + url.pathname).toBe(YOUTUBE_SEARCH_URL);
        expect(url.searchParams.get("part")).toBe("snippet");
        expect(url.searchParams.get("q")).toBe("Example Artist Example Song");
        expect(url.searchParams.get("type")).toBe("video");
        expect(url.searchParams.get("videoEmbeddable")).toBe("true");
        expect(url.searchParams.get("maxResults")).toBe(
          String(YOUTUBE_SEARCH_MAX_RESULTS),
        );
        expect(url.searchParams.get("key")).toBe("server-only-key");
        expect(init?.method).toBe("GET");
        expect(init?.credentials).toBe("omit");
        expect(init?.redirect).toBe("error");
        expect(init?.headers).toEqual({ Accept: "application/json" });
        return jsonResponse(searchFixture);
      },
    );

    const result = await new YouTubeDataApiClient({
      apiKey: "server-only-key",
      fetch: fetchMock,
    }).searchVideos(" Example Artist Example Song ");

    expect(result).toEqual([
      {
        videoId: "videoArt001",
        title: "Example Song",
        channelTitle: "Example Artist - Topic",
      },
      {
        videoId: "videoAudio01",
        title: "Example Artist - Example Song (Official Audio)",
        channelTitle: "Example Artist",
      },
    ]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("retries a transient search response through the injected sleep seam", async () => {
    const fetchMock = vi
      .fn(async (): Promise<Response> => jsonResponse({ providerSecret: "ignored" }, 503))
      .mockImplementationOnce(
        async () => jsonResponse({ providerSecret: "ignored" }, 503),
      )
      .mockImplementationOnce(async () => jsonResponse(searchFixture));
    const sleep = vi.fn(async () => undefined);

    const result = await new YouTubeDataApiClient({
      apiKey: "server-only-key",
      fetch: fetchMock,
      sleep,
    }).searchVideos("Artist Song");

    expect(result).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it("requests one bounded details page and filters unavailable videos", async () => {
    const fetchMock = vi.fn(
      async (input: string | URL, init?: RequestInit): Promise<Response> => {
        const url = new URL(String(input));

        expect(url.origin + url.pathname).toBe(YOUTUBE_VIDEOS_URL);
        expect(url.searchParams.get("part")).toBe(
          "snippet,contentDetails,status",
        );
        expect(url.searchParams.get("id")).toBe("videoArt001,videoAudio01");
        expect(url.searchParams.get("key")).toBe("server-only-key");
        expect(init?.headers).toEqual({ Accept: "application/json" });
        return jsonResponse(detailsFixture);
      },
    );

    const result = await new YouTubeDataApiClient({
      apiKey: "server-only-key",
      fetch: fetchMock,
    }).getVideoDetails(["videoArt001", "videoAudio01"]);

    expect(result).toEqual([
      {
        videoId: "videoArt001",
        title: "Example Song",
        channelTitle: "Example Artist - Topic",
        durationMs: 200_000,
        embeddable: true,
        licensedContent: true,
        sourceType: "other",
      },
      {
        videoId: "videoAudio01",
        title: "Example Artist - Example Song (Official Audio)",
        channelTitle: "Example Artist",
        durationMs: 201_000,
        embeddable: true,
        licensedContent: false,
        sourceType: "other",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("skips malformed search/detail items without crossing raw provider data", async () => {
    const fetchMock = vi.fn(async (input: string | URL): Promise<Response> => {
      const url = new URL(String(input));

      if (url.origin + url.pathname === YOUTUBE_SEARCH_URL) {
        return jsonResponse({
          items: [
            { id: { videoId: "bad id" }, snippet: {} },
            {
              id: { videoId: "validVideo1" },
              snippet: { title: "Valid", channelTitle: "Artist" },
            },
          ],
        });
      }

      return jsonResponse({
        items: [
          {
            id: "validVideo1",
            snippet: { title: "Valid", channelTitle: "Artist" },
            contentDetails: { duration: "not-a-duration" },
            status: { embeddable: true, privacyStatus: "public" },
          },
          {
            id: "validVideo2",
            snippet: { title: "Playable", channelTitle: "Artist" },
            contentDetails: { duration: "PT1M" },
            status: { embeddable: false, privacyStatus: "public" },
          },
        ],
      });
    });
    const client = new YouTubeDataApiClient({
      apiKey: "server-only-key",
      fetch: fetchMock,
    });

    expect(await client.searchVideos("Artist Valid")).toEqual([
      { videoId: "validVideo1", title: "Valid", channelTitle: "Artist" },
    ]);
    expect(await client.getVideoDetails(["validVideo1", "validVideo2"]))
      .toEqual([]);
    expect(JSON.stringify(searchFixture)).not.toContain("server-only-key");
  });

  it.each([
    ["PT1S", 1_000],
    ["PT2M05.5S", 125_500],
    ["PT23H", 82_800_000],
  ] as const)("parses bounded ISO duration %s", (value, expected) => {
    expect(parseYouTubeDuration(value)).toBe(expected);
  });

  it.each([
    "",
    "PT0S",
    "P1D",
    "P0DT1S",
    "P1DT1S",
    "P1Y",
    "PT1M60S",
    "PT999999H",
    "not-a-duration",
    180,
  ])("rejects invalid or unbounded ISO duration %s", (value) => {
    expect(parseYouTubeDuration(value)).toBeNull();
  });

  it("maps HTTP, malformed JSON, oversized, timeout, and network errors safely", async () => {
    for (const [status, kind] of [
      [401, "configuration"],
      [403, "forbidden"],
      [429, "rate_limited"],
      [500, "unavailable"],
    ] as const) {
      const client = new YouTubeDataApiClient({
        apiKey: "server-only-key",
        fetch: async () => jsonResponse({ error: "provider secret" }, status),
      });

      await expect(client.searchVideos("Artist Song")).rejects.toMatchObject({
        name: "YouTubeClientError",
        kind,
      });
    }

    const malformed = new YouTubeDataApiClient({
      apiKey: "server-only-key",
      fetch: async () => new Response("{not-json}", { status: 200 }),
    });
    await expect(malformed.searchVideos("Artist Song")).rejects.toMatchObject({
      kind: "invalid_response",
    });

    const oversized = new YouTubeDataApiClient({
      apiKey: "server-only-key",
      maxResponseBytes: 16,
      fetch: async () => jsonResponse(searchFixture),
    });
    await expect(oversized.searchVideos("Artist Song")).rejects.toMatchObject({
      kind: "invalid_response",
    });

    const timeout = new YouTubeDataApiClient({
      apiKey: "server-only-key",
      timeoutMs: 1,
      fetch: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("provider body and key")),
          );
        }),
    });
    await expect(timeout.searchVideos("Artist Song")).rejects.toMatchObject({
      kind: "timeout",
    });

    const network = new YouTubeDataApiClient({
      apiKey: "server-only-key",
      fetch: async () => {
        throw new Error("provider response body");
      },
    });
    const error = await network.searchVideos("Artist Song").catch((value) => value);
    expect(error).toBeInstanceOf(YouTubeClientError);
    expect(String(error)).not.toContain("provider response body");
    expect(String(error)).not.toContain("key");
  });

  it("rejects missing or invalid keys before making a request", async () => {
    expect(() => new YouTubeDataApiClient({ apiKey: "" })).toThrow(
      YouTubeClientError,
    );
    expect(() => new YouTubeDataApiClient({ apiKey: "bad\nkey" })).toThrow(
      YouTubeClientError,
    );
  });
});
