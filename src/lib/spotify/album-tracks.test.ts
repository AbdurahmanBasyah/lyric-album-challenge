import { describe, expect, it, vi } from "vitest";

import type { SpotifyFetch } from "../auth/spotify";
import {
  ALBUM_TRACKS_PAGE_SIZE,
  SpotifyAlbumTracksError,
  buildAlbumTracksUrl,
  getAlbumTracks,
  parseOffsetCursor,
  type SpotifyAlbumTracksInput,
} from "./album-tracks";

function validTrack(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "track-1",
    name: " Track One ",
    artists: [
      { id: "artist-1", name: " First Artist " },
      { id: "artist-2", name: "Second Artist" },
    ],
    duration_ms: 180_000,
    track_number: 1,
    disc_number: 1,
    type: "track",
    is_playable: true,
    ...overrides,
  };
}

function albumTracksPayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    href: "https://api.spotify.com/v1/albums/album-1/tracks?offset=0&limit=50",
    limit: ALBUM_TRACKS_PAGE_SIZE,
    next:
      "https://api.spotify.com/v1/albums/album-1/tracks?offset=50&limit=50",
    offset: 0,
    previous: null,
    total: 51,
    items: [validTrack()],
    ...overrides,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Spotify album-track adapter", () => {
  it("constructs the current request and maps only TrackSummary fields", async () => {
    let requestInput: string | URL | undefined;
    let requestInit: RequestInit | undefined;
    const providerSecret = "provider-body-secret";
    const fetchMock: SpotifyFetch = async (input, init) => {
      requestInput = input;
      requestInit = init;
      return jsonResponse(
        albumTracksPayload({
          provider_secret: providerSecret,
          items: [validTrack({ provider_secret: providerSecret })],
        }),
      );
    };

    const page = await getAlbumTracks(
      "access-token",
      "album-1",
      " Selected Album ",
      undefined,
      { fetch: fetchMock },
    );

    expect(page).toEqual({
      items: [
        {
          spotifyId: "track-1",
          name: "Track One",
          artistNames: ["First Artist", "Second Artist"],
          durationMs: 180_000,
        },
      ],
      nextCursor: "50",
    });

    const requestUrl = new URL(String(requestInput));
    expect(requestUrl.toString()).toBe(
      "https://api.spotify.com/v1/albums/album-1/tracks?limit=50&offset=0",
    );
    expect(requestUrl.pathname).toBe("/v1/albums/album-1/tracks");
    expect(requestUrl.searchParams.get("limit")).toBe("50");
    expect(requestUrl.searchParams.get("offset")).toBe("0");
    expect(requestUrl.searchParams.get("additional_types")).toBeNull();
    expect(new Headers(requestInit?.headers).get("accept")).toBe(
      "application/json",
    );
    expect(new Headers(requestInit?.headers).get("authorization")).toBe(
      "Bearer access-token",
    );
    expect(requestInit?.method).toBe("GET");
    expect(requestInit?.body).toBeUndefined();
    expect(JSON.stringify(page)).not.toContain(providerSecret);
    expect(JSON.stringify(page)).not.toContain("api.spotify.com");
  });

  it("retries a transient page failure through the injected sleep seam", async () => {
    const fetchMock = vi
      .fn<SpotifyFetch>()
      .mockResolvedValueOnce(jsonResponse({ provider_secret: "ignored" }, 500))
      .mockResolvedValueOnce(
        jsonResponse(albumTracksPayload({ next: null })),
      );
    const sleep = vi.fn(async () => undefined);

    const page = await getAlbumTracks(
      "access-token",
      "album-1",
      "Album Name",
      undefined,
      { fetch: fetchMock, sleep },
    );

    expect(page.items).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it("accepts the named request form and preserves provider order", async () => {
    const input: SpotifyAlbumTracksInput = {
      albumId: "album-1",
      albumName: "Album Name",
      accessToken: "access-token",
      fetch: async () =>
        jsonResponse(
          albumTracksPayload({
            next: null,
            items: [
              validTrack({ id: "track-2", track_number: 2 }),
              validTrack({ id: "track-1", track_number: 1 }),
            ],
          }),
        ),
    };

    const page = await getAlbumTracks(input);

    expect(page.items.map((track) => track.spotifyId)).toEqual([
      "track-2",
      "track-1",
    ]);
    expect(
      page.items.every(
        (track) => !Object.prototype.hasOwnProperty.call(track, "albumName"),
      ),
    ).toBe(true);
    expect(page.nextCursor).toBeNull();
  });

  it("uses a supplied canonical cursor and does not fetch another page", async () => {
    let requestCount = 0;
    let requestInput: string | URL | undefined;
    const fetchMock: SpotifyFetch = async (input) => {
      requestCount += 1;
      requestInput = input;
      return jsonResponse(
        albumTracksPayload({
          offset: 50,
          next: null,
          total: 51,
        }),
      );
    };

    const page = await getAlbumTracks(
      "access-token",
      "album-1",
      "Album Name",
      "50",
      { fetch: fetchMock },
    );

    expect(requestCount).toBe(1);
    expect(new URL(String(requestInput)).searchParams.get("offset")).toBe("50");
    expect(page.nextCursor).toBeNull();
  });

  it("returns an empty page and preserves an empty-page provider cursor", async () => {
    const page = await getAlbumTracks(
      "access-token",
      "album-1",
      "Album Name",
      undefined,
      {
        fetch: async () =>
          jsonResponse(
            albumTracksPayload({
              items: [],
              next: "https://api.spotify.com/v1/albums/album-1/tracks?offset=50",
              total: 50,
            }),
          ),
      },
    );

    expect(page).toEqual({ items: [], nextCursor: "50" });
  });

  it("falls back to the provider page offset plus raw item count when next has no offset", async () => {
    const page = await getAlbumTracks({
      accessToken: "access-token",
      albumId: "album-1",
      albumName: "Album Name",
      fetch: async () =>
        jsonResponse(
          albumTracksPayload({
            next: "https://api.spotify.com/v1/albums/album-1/tracks",
            items: [validTrack(), validTrack({ id: "track-2" })],
          }),
        ),
    });

    expect(page.nextCursor).toBe("2");
  });

  it("filters only explicit local, explicitly unplayable, and LRCLIB-ineligible durations", async () => {
    const page = await getAlbumTracks({
      accessToken: "access-token",
      albumId: "album-1",
      albumName: "Album Name",
      fetch: async () =>
        jsonResponse(
          albumTracksPayload({
            next: null,
            items: [
              { is_local: true },
              { is_playable: false },
              validTrack({ id: "too-short", duration_ms: 999 }),
              validTrack({ id: "too-long", duration_ms: 3_600_001 }),
              validTrack({ id: "minimum", duration_ms: 1_000 }),
              validTrack({ id: "maximum", duration_ms: 3_600_000 }),
            ],
          }),
        ),
    });

    expect(page.items.map((track) => track.spotifyId)).toEqual([
      "minimum",
      "maximum",
    ]);
  });

  it("fails the entire page when a retained track has malformed required metadata", async () => {
    const malformedTracks = [
      { id: "" },
      { name: "   " },
      { artists: [] },
      { artists: [{ name: "   " }] },
      { duration_ms: "180000" },
      { duration_ms: -1 },
      { track_number: 0 },
      { disc_number: 0 },
      { is_playable: "true" },
    ];

    for (const malformed of malformedTracks) {
      await expect(
        getAlbumTracks({
          accessToken: "access-token",
          albumId: "album-1",
          albumName: "Album Name",
          fetch: async () =>
            jsonResponse(
              albumTracksPayload({
                items: [validTrack(malformed)],
              }),
            ),
        }),
      ).rejects.toEqual(new SpotifyAlbumTracksError("unavailable"));
    }

    await expect(
      getAlbumTracks({
        accessToken: "access-token",
        albumId: "album-1",
        albumName: "Album Name",
        fetch: async () => jsonResponse(albumTracksPayload({ items: [null] })),
      }),
    ).rejects.toEqual(new SpotifyAlbumTracksError("unavailable"));
  });

  it("rejects invalid IDs, album names, tokens, and cursors before making a request", async () => {
    let requestCount = 0;
    const fetchMock: SpotifyFetch = async () => {
      requestCount += 1;
      return jsonResponse(albumTracksPayload());
    };

    for (const albumId of ["", " ", "album/1", "album?1", "album#1", "album%2F1"]) {
      await expect(
        getAlbumTracks("access-token", albumId, "Album Name", undefined, {
          fetch: fetchMock,
        }),
      ).rejects.toEqual(new SpotifyAlbumTracksError("invalid_input"));
    }

    for (const albumName of ["", "   "]) {
      await expect(
        getAlbumTracks("access-token", "album-1", albumName, undefined, {
          fetch: fetchMock,
        }),
      ).rejects.toEqual(new SpotifyAlbumTracksError("invalid_input"));
    }

    for (const accessToken of ["", "   "]) {
      await expect(
        getAlbumTracks(accessToken, "album-1", "Album Name", undefined, {
          fetch: fetchMock,
        }),
      ).rejects.toEqual(new SpotifyAlbumTracksError("invalid_input"));
    }

    for (const cursor of [
      "",
      "01",
      "-1",
      "1.5",
      "not-an-offset",
      "9007199254740992",
    ]) {
      await expect(
        getAlbumTracks("access-token", "album-1", "Album Name", cursor, {
          fetch: fetchMock,
        }),
      ).rejects.toEqual(new SpotifyAlbumTracksError("invalid_cursor"));
    }

    expect(requestCount).toBe(0);
    expect(parseOffsetCursor(undefined)).toBe(0);
    expect(parseOffsetCursor("50")).toBe(50);
    expect(buildAlbumTracksUrl("album-1", "50").pathname).toBe(
      "/v1/albums/album-1/tracks",
    );
  });

  it("classifies auth, rate-limit, and other provider statuses without retaining bodies", async () => {
    const providerSecret = "status-provider-secret";

    await expect(
      getAlbumTracks({
        accessToken: "secret-token",
        albumId: "album-1",
        albumName: "Album Name",
        fetch: async () => jsonResponse({ providerSecret }, 401),
      }),
    ).rejects.toEqual(new SpotifyAlbumTracksError("auth"));

    await expect(
      getAlbumTracks({
        accessToken: "secret-token",
        albumId: "album-1",
        albumName: "Album Name",
        fetch: async () => jsonResponse({ providerSecret }, 429),
      }),
    ).rejects.toEqual(new SpotifyAlbumTracksError("rate_limited"));

    await expect(
      getAlbumTracks({
        accessToken: "secret-token",
        albumId: "album-1",
        albumName: "Album Name",
        fetch: async () => jsonResponse({ providerSecret }, 500),
      }),
    ).rejects.toEqual(new SpotifyAlbumTracksError("unavailable"));
  });

  it("classifies invalid JSON, network failures, and invalid provider pagination neutrally", async () => {
    const providerSecret = "network-provider-secret";

    await expect(
      getAlbumTracks({
        accessToken: "secret-token",
        albumId: "album-1",
        albumName: "Album Name",
        fetch: async () =>
          new Response(providerSecret, {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      }),
    ).rejects.toEqual(new SpotifyAlbumTracksError("unavailable"));

    await expect(
      getAlbumTracks({
        accessToken: "secret-token",
        albumId: "album-1",
        albumName: "Album Name",
        fetch: async () => {
          throw new Error(providerSecret);
        },
      }),
    ).rejects.toEqual(new SpotifyAlbumTracksError("unavailable"));

    await expect(
      getAlbumTracks({
        accessToken: "secret-token",
        albumId: "album-1",
        albumName: "Album Name",
        fetch: async () =>
          jsonResponse(
            albumTracksPayload({
              next: "https://evil.example/v1/albums/album-1/tracks?offset=50",
            }),
          ),
      }),
    ).rejects.toEqual(new SpotifyAlbumTracksError("unavailable"));
  });

  it("rejects malformed page envelopes without leaking provider values", async () => {
    const malformedPages: unknown[] = [
      { items: [], next: null, offset: 0, total: 0 },
      albumTracksPayload({ items: "not-an-array" }),
      albumTracksPayload({ limit: 51 }),
      albumTracksPayload({ offset: -1 }),
      albumTracksPayload({ total: Number.MAX_SAFE_INTEGER + 1 }),
      albumTracksPayload({ next: "http://api.spotify.com/v1/albums/album-1/tracks" }),
      albumTracksPayload({ next: "https://api.spotify.com.evil/v1/albums/album-1/tracks" }),
      albumTracksPayload({ next: "https://user:pass@api.spotify.com/v1/albums/album-1/tracks" }),
    ];

    for (const malformedPage of malformedPages) {
      const error = await getRejectedError(
        getAlbumTracks({
          accessToken: "secret-token",
          albumId: "album-1",
          albumName: "Album Name",
          fetch: async () => jsonResponse(malformedPage),
        }),
      );

      expect(error).toEqual(new SpotifyAlbumTracksError("unavailable"));
      expect(String(error)).not.toContain("secret-token");
      expect(String(error)).not.toContain("api.spotify.com");
      expect(String(error)).not.toContain("evil.example");
    }
  });

  it("does not mutate the provider response", async () => {
    const payload = albumTracksPayload({
      items: [
        validTrack({
          artists: [{ name: " Artist " }],
        }),
      ],
    });
    const before = JSON.stringify(payload);

    await getAlbumTracks({
      accessToken: "access-token",
      albumId: "album-1",
      albumName: "Album Name",
      fetch: async () =>
        ({
          ok: true,
          status: 200,
          json: async () => payload,
        }) as Response,
    });

    expect(JSON.stringify(payload)).toBe(before);
  });
});

async function getRejectedError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the promise to reject.");
}
