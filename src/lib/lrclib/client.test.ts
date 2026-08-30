import { describe, expect, it, vi } from "vitest";

import {
  LRCLIB_GET_URL,
  LrclibError,
  getLrclibTrack,
  type LrclibFetch,
  type LrclibClientOptions,
} from "./client";
import type { TrackSummary } from "@/types/tracks";

const track: TrackSummary = {
  spotifyId: "spotify-track-id",
  name: " Track & Name ",
  artistNames: [" Primary / Artist ", "Other Artist"],
  durationMs: 201_230,
};

const clientIdentifier = "fillthelyrics-test/1.0 (test)";

function jsonResponse(value: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

function providerRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 3396226,
    name: "Provider alias",
    trackName: "Track & Name",
    artistName: "Primary / Artist",
    albumName: "Album / Edition",
    duration: 201.23,
    instrumental: false,
    plainLyrics: "private plain lyrics",
    syncedLyrics: "[00:01.23] Keep this LRC text verbatim\n",
    lyricsfile: "private Lyricsfile data",
    providerSecret: "private provider metadata",
    ...overrides,
  };
}

function options(fetchFunction: LrclibFetch): LrclibClientOptions {
  return { clientIdentifier, fetch: fetchFunction };
}

async function captureError(action: () => Promise<unknown>): Promise<LrclibError> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(LrclibError);
    return error as LrclibError;
  }

  throw new Error("Expected action to reject.");
}

describe("LRCLIB exact lookup adapter", () => {
  it("constructs one exact request without optional album metadata", async () => {
    const fetchMock = vi.fn<LrclibFetch>(async () =>
      jsonResponse(providerRecord()),
    );

    await getLrclibTrack(track, options(fetchMock));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    const requestUrl = new URL(String(input));

    expect(requestUrl.origin + requestUrl.pathname).toBe(LRCLIB_GET_URL);
    expect(requestUrl.searchParams.get("track_name")).toBe("Track & Name");
    expect(requestUrl.searchParams.get("artist_name")).toBe("Primary / Artist");
    expect(requestUrl.searchParams.get("album_name")).toBeNull();
    expect(requestUrl.searchParams.get("duration")).toBe("201.23");
    expect(requestUrl.searchParams.get("spotifyId")).toBeNull();
    expect(requestUrl.searchParams.get("trackNumber")).toBeNull();
    expect(new Headers(init?.headers).get("accept")).toBe("application/json");
    expect(new Headers(init?.headers).get("lrclib-client")).toBe(
      clientIdentifier,
    );
    expect(init?.method).toBe("GET");
  });

  it("retries a transient lookup failure through the injected sleep seam", async () => {
    const fetchMock = vi
      .fn<LrclibFetch>()
      .mockResolvedValueOnce(jsonResponse({ providerSecret: "ignored" }, 503))
      .mockResolvedValueOnce(jsonResponse(providerRecord()));
    const sleep = vi.fn(async () => undefined);

    const result = await getLrclibTrack(
      track,
      { ...options(fetchMock), sleep },
    );

    expect(result?.id).toBe(3396226);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it("reduces a valid provider response and preserves synced LRC text verbatim", async () => {
    const fetchMock: LrclibFetch = async () => jsonResponse(providerRecord());

    const result = await getLrclibTrack(track, options(fetchMock));

    expect(result).toEqual({
      id: 3396226,
      trackName: "Track & Name",
      artistName: "Primary / Artist",
      albumName: "Album / Edition",
      duration: 201.23,
      instrumental: false,
      syncedLyrics: "[00:01.23] Keep this LRC text verbatim\n",
    });
    expect(JSON.stringify(result)).not.toContain("plainLyrics");
    expect(JSON.stringify(result)).not.toContain("Lyricsfile");
    expect(JSON.stringify(result)).not.toContain("providerSecret");
    expect(Object.keys(result ?? {}).sort()).toEqual([
      "albumName",
      "artistName",
      "duration",
      "id",
      "instrumental",
      "syncedLyrics",
      "trackName",
    ]);
  });

  it("accepts instrumental records with null synced lyrics", async () => {
    const fetchMock: LrclibFetch = async () =>
      jsonResponse(
        providerRecord({ instrumental: true, syncedLyrics: null }),
      );

    await expect(getLrclibTrack(track, options(fetchMock))).resolves.toEqual({
      id: 3396226,
      trackName: "Track & Name",
      artistName: "Primary / Artist",
      albumName: "Album / Edition",
      duration: 201.23,
      instrumental: true,
      syncedLyrics: null,
    });
  });

  it("omits album_name even when provider response includes album metadata", async () => {
    let requestInput: string | URL | undefined;
    const fetchMock: LrclibFetch = async (input) => {
      requestInput = input;
      return jsonResponse(providerRecord());
    };

    await getLrclibTrack(track, options(fetchMock));

    const requestUrl = new URL(String(requestInput));
    expect(requestUrl.searchParams.get("album_name")).toBeNull();
    expect(requestUrl.searchParams.get("track_name")).toBe("Track & Name");
    expect(requestUrl.searchParams.get("artist_name")).toBe("Primary / Artist");
  });

  it("returns null for a 404 without reading or retaining the response body", async () => {
    const bodyReader = vi.fn(async () => {
      throw new Error("provider body must not be read");
    });
    const fetchMock: LrclibFetch = async () => {
      const response = new Response("provider secret body", { status: 404 });
      response.json = bodyReader;
      return response;
    };

    await expect(getLrclibTrack(track, options(fetchMock))).resolves.toBeNull();
    expect(bodyReader).not.toHaveBeenCalled();
  });

  it("distinguishes 429 and parses only a canonical safe Retry-After value", async () => {
    const accepted = await captureError(() =>
      getLrclibTrack(
        track,
        options(async () =>
          jsonResponse({ providerSecret: "do not retain" }, 429, {
            "Retry-After": "37",
          }),
        ),
      ),
    );
    expect(accepted.kind).toBe("rate_limited");
    expect(accepted.retryAfterSeconds).toBe(37);
    expect(accepted.category).toBeNull();

    for (const retryAfter of [
      undefined,
      "",
      "01",
      "-1",
      "1.5",
      "1e2",
      "9007199254740992",
    ]) {
      const error = await captureError(() =>
        getLrclibTrack(
          track,
          options(async () =>
            jsonResponse(
              { providerSecret: "do not retain" },
              429,
              retryAfter === undefined
                ? undefined
                : { "Retry-After": retryAfter },
            ),
          ),
        ),
      );
      expect(error.kind).toBe("rate_limited");
      expect(error.retryAfterSeconds).toBeNull();
    }
  });

  it("maps other HTTP failures and network failures to fixed unavailable categories", async () => {
    const httpError = await captureError(() =>
      getLrclibTrack(
        track,
        options(async () =>
          jsonResponse({ providerSecret: "do not retain" }, 503),
        ),
      ),
    );
    expect(httpError).toEqual(new LrclibError("unavailable", { category: "http" }));

    const networkError = await captureError(() =>
      getLrclibTrack(
        track,
        options(async () => {
          throw new Error("provider exception detail");
        }),
      ),
    );
    expect(networkError).toEqual(
      new LrclibError("unavailable", { category: "network" }),
    );
  });

  it("classifies invalid JSON and malformed required fields without exposing details", async () => {
    const invalidJson = await captureError(() =>
      getLrclibTrack(
        track,
        options(async () => new Response("provider secret body", { status: 200 })),
      ),
    );
    expect(invalidJson).toEqual(new LrclibError("invalid_response"));

    for (const malformed of [
      providerRecord({ id: 0 }),
      providerRecord({ trackName: "   " }),
      providerRecord({ artistName: "   " }),
      providerRecord({ albumName: "   " }),
      providerRecord({ duration: 0 }),
      providerRecord({ duration: Number.POSITIVE_INFINITY }),
      providerRecord({ instrumental: "false" }),
      providerRecord({ syncedLyrics: 42 }),
    ]) {
      const error = await captureError(() =>
        getLrclibTrack(
          track,
          options(async () => jsonResponse(malformed)),
        ),
      );
      expect(error).toEqual(new LrclibError("invalid_response"));
    }
  });

  it("rejects invalid input and configuration before making a request", async () => {
    const fetchMock = vi.fn<LrclibFetch>(async () =>
      jsonResponse(providerRecord()),
    );
    const invalidTracks: TrackSummary[] = [
      { ...track, name: "   " },
      { ...track, artistNames: [] },
      { ...track, artistNames: ["   "] },
      { ...track, durationMs: Number.NaN },
      { ...track, durationMs: 0 },
      { ...track, durationMs: 999 },
      { ...track, durationMs: 3_600_001 },
      { ...track, durationMs: Number.POSITIVE_INFINITY },
    ];

    for (const invalidTrack of invalidTracks) {
      await expect(
        getLrclibTrack(invalidTrack, options(fetchMock)),
      ).rejects.toEqual(new LrclibError("input"));
    }

    await expect(
      getLrclibTrack(track, { clientIdentifier: "   ", fetch: fetchMock }),
    ).rejects.toEqual(new LrclibError("configuration"));
    await expect(
      getLrclibTrack(track, {
        clientIdentifier: "identifier\nforbidden",
        fetch: fetchMock,
      }),
    ).rejects.toEqual(new LrclibError("configuration"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not leak query values, provider bodies, lyrics, or exception details through errors", async () => {
    const sensitiveTrack: TrackSummary = {
      ...track,
      name: "track-query-secret",
      artistNames: ["artist-query-secret"],
      spotifyId: "spotify-id-secret",
    };
    const error = await captureError(() =>
      getLrclibTrack(
        sensitiveTrack,
        options(async () => {
          throw new Error(
            "network exception provider-body-secret lyric-secret track-query-secret",
          );
        }),
      ),
    );
    const serialized = JSON.stringify(error);
    const rendered = `${error.name}:${error.message}:${error.stack ?? ""}:${serialized}`;

    expect(rendered).not.toContain("track-query-secret");
    expect(rendered).not.toContain("artist-query-secret");
    expect(rendered).not.toContain("spotify-id-secret");
    expect(rendered).not.toContain("provider-body-secret");
    expect(rendered).not.toContain("lyric-secret");
    expect(rendered).not.toContain("network exception");
    expect(rendered).not.toContain("https://lrclib.net");
  });
});
