import { describe, expect, it, vi } from "vitest";

import type { SpotifyFetch } from "../auth/spotify";
import {
  PLAYLIST_ITEMS_PAGE_SIZE,
  SpotifyPlaylistItemsError,
  buildPlaylistItemsUrl,
  getPlaylistItems,
  parseOffsetCursor,
  type SpotifyPlaylistItemsInput,
} from "./playlist-items";

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
    album: {
      id: "album-1",
      name: " Album One ",
    },
    duration_ms: 180_000,
    track_number: 1,
    disc_number: 1,
    type: "track",
    is_playable: true,
    ...overrides,
  };
}

function wrapper(
  item: unknown,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    is_local: false,
    item,
    ...overrides,
  };
}

function playlistItemsPayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    href: "https://api.spotify.com/v1/playlists/playlist-1/items?offset=0&limit=50",
    limit: PLAYLIST_ITEMS_PAGE_SIZE,
    next:
      "https://api.spotify.com/v1/playlists/playlist-1/items?offset=50&limit=50",
    offset: 0,
    previous: null,
    total: 51,
    items: [wrapper(validTrack())],
    ...overrides,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Spotify playlist-item adapter", () => {
  it("constructs the current request and maps only TrackSummary fields", async () => {
    let requestInput: string | URL | undefined;
    let requestInit: RequestInit | undefined;
    const providerSecret = "provider-body-secret";
    const fetchMock: SpotifyFetch = async (input, init) => {
      requestInput = input;
      requestInit = init;
      return jsonResponse(
        playlistItemsPayload({
          provider_secret: providerSecret,
          items: [
            wrapper(validTrack({ provider_secret: providerSecret })),
          ],
        }),
      );
    };

    const page = await getPlaylistItems(
      "access-token",
      "playlist-1",
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
      "https://api.spotify.com/v1/playlists/playlist-1/items?limit=50&offset=0",
    );
    expect(requestUrl.pathname).toBe("/v1/playlists/playlist-1/items");
    expect(requestUrl.searchParams.get("limit")).toBe("50");
    expect(requestUrl.searchParams.get("offset")).toBe("0");
    expect(requestUrl.searchParams.get("additional_types")).toBeNull();
    expect(requestUrl.pathname).not.toContain("/tracks");
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
      .mockResolvedValueOnce(jsonResponse({ provider_secret: "ignored" }, 504))
      .mockResolvedValueOnce(
        jsonResponse(playlistItemsPayload({ next: null })),
      );
    const sleep = vi.fn(async () => undefined);

    const page = await getPlaylistItems(
      "access-token",
      "playlist-1",
      undefined,
      { fetch: fetchMock, sleep },
    );

    expect(page.items).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it("accepts the named request form, discards provider-only album metadata, and preserves order", async () => {
    const input: SpotifyPlaylistItemsInput = {
      playlistId: "playlist-1",
      accessToken: "access-token",
      fetch: async () =>
        jsonResponse(
          playlistItemsPayload({
            next: null,
            items: [
              wrapper(
                validTrack({
                  id: "track-2",
                  track_number: 2,
                  album: { name: "Second Album" },
                }),
              ),
              wrapper(validTrack({ id: "track-1", track_number: 1 })),
            ],
          }),
        ),
    };

    const page = await getPlaylistItems(input);

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
        playlistItemsPayload({
          offset: 50,
          next: null,
          total: 51,
        }),
      );
    };

    const page = await getPlaylistItems(
      "access-token",
      "playlist-1",
      "50",
      { fetch: fetchMock },
    );

    expect(requestCount).toBe(1);
    expect(new URL(String(requestInput)).searchParams.get("offset")).toBe("50");
    expect(page.nextCursor).toBeNull();
  });

  it("returns an empty page and preserves an empty-page provider cursor", async () => {
    const page = await getPlaylistItems({
      accessToken: "access-token",
      playlistId: "playlist-1",
      fetch: async () =>
        jsonResponse(
          playlistItemsPayload({
            items: [],
            next: "https://api.spotify.com/v1/playlists/playlist-1/items?offset=50",
            total: 50,
          }),
        ),
    });

    expect(page).toEqual({ items: [], nextCursor: "50" });
  });

  it("falls back to the provider page offset plus raw item count when next has no offset", async () => {
    const page = await getPlaylistItems({
      accessToken: "access-token",
      playlistId: "playlist-1",
      fetch: async () =>
        jsonResponse(
          playlistItemsPayload({
            next: "https://api.spotify.com/v1/playlists/playlist-1/items",
            items: [
              wrapper(validTrack()),
              wrapper(validTrack({ id: "track-2" })),
            ],
          }),
        ),
    });

    expect(page.nextCursor).toBe("2");
  });

  it("filters local, null, episode, unplayable, restricted, and LRCLIB-ineligible items", async () => {
    const page = await getPlaylistItems({
      accessToken: "access-token",
      playlistId: "playlist-1",
      fetch: async () =>
        jsonResponse(
          playlistItemsPayload({
            next: null,
            items: [
              { is_local: true },
              wrapper(null),
              wrapper({ type: "episode", id: "episode-1", name: "Episode" }),
              wrapper(validTrack({ id: "inner-local", is_local: true })),
              wrapper(validTrack({ id: "unplayable", is_playable: false })),
              wrapper(
                validTrack({
                  id: "restricted",
                  restrictions: { reason: "market" },
                }),
              ),
              wrapper(validTrack({ id: "too-short", duration_ms: 999 })),
              wrapper(validTrack({ id: "zero-duration", duration_ms: 0 })),
              wrapper(validTrack({ id: "too-long", duration_ms: 3_600_001 })),
              wrapper(validTrack({ id: "minimum", duration_ms: 1_000 })),
              wrapper(validTrack({ id: "maximum", duration_ms: 3_600_000 })),
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
      { album: { name: "   " } },
      { duration_ms: "180000" },
      { duration_ms: -1 },
      { track_number: 0 },
      { disc_number: 0 },
      { is_playable: "true" },
    ];

    for (const malformed of malformedTracks) {
      await expect(
        getPlaylistItems({
          accessToken: "access-token",
          playlistId: "playlist-1",
          fetch: async () =>
            jsonResponse(
              playlistItemsPayload({
                items: [wrapper(validTrack(malformed))],
              }),
            ),
        }),
      ).rejects.toEqual(new SpotifyPlaylistItemsError("unavailable"));
    }

    const page = await getPlaylistItems({
      accessToken: "access-token",
      playlistId: "playlist-1",
      fetch: async () =>
        jsonResponse(playlistItemsPayload({ items: [wrapper(null)] })),
    });

    expect(page.items).toEqual([]);

    await expect(
      getPlaylistItems({
        accessToken: "access-token",
        playlistId: "playlist-1",
        fetch: async () =>
          jsonResponse(playlistItemsPayload({ items: [null] })),
      }),
    ).rejects.toEqual(new SpotifyPlaylistItemsError("unavailable"));
  });

  it("rejects invalid IDs, tokens, and cursors before making a request", async () => {
    let requestCount = 0;
    const fetchMock: SpotifyFetch = async () => {
      requestCount += 1;
      return jsonResponse(playlistItemsPayload());
    };

    for (const playlistId of [
      "",
      " ",
      "playlist/1",
      "playlist?1",
      "playlist#1",
      "playlist%2F1",
    ]) {
      await expect(
        getPlaylistItems("access-token", playlistId, undefined, {
          fetch: fetchMock,
        }),
      ).rejects.toEqual(new SpotifyPlaylistItemsError("invalid_input"));
    }

    for (const accessToken of ["", "   "]) {
      await expect(
        getPlaylistItems(accessToken, "playlist-1", undefined, {
          fetch: fetchMock,
        }),
      ).rejects.toEqual(new SpotifyPlaylistItemsError("invalid_input"));
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
        getPlaylistItems("access-token", "playlist-1", cursor, {
          fetch: fetchMock,
        }),
      ).rejects.toEqual(new SpotifyPlaylistItemsError("invalid_cursor"));
    }

    expect(requestCount).toBe(0);
    expect(parseOffsetCursor(undefined)).toBe(0);
    expect(parseOffsetCursor("50")).toBe(50);
    expect(buildPlaylistItemsUrl("playlist-1", "50").pathname).toBe(
      "/v1/playlists/playlist-1/items",
    );
  });

  it("classifies auth, inaccessible, rate-limit, and other provider statuses without retaining bodies", async () => {
    const providerSecret = "status-provider-secret";

    await expect(
      getPlaylistItems({
        accessToken: "secret-token",
        playlistId: "playlist-1",
        fetch: async () => jsonResponse({ providerSecret }, 401),
      }),
    ).rejects.toEqual(new SpotifyPlaylistItemsError("auth"));

    await expect(
      getPlaylistItems({
        accessToken: "secret-token",
        playlistId: "playlist-1",
        fetch: async () => jsonResponse({ providerSecret }, 403),
      }),
    ).rejects.toEqual(new SpotifyPlaylistItemsError("inaccessible"));

    await expect(
      getPlaylistItems({
        accessToken: "secret-token",
        playlistId: "playlist-1",
        fetch: async () => jsonResponse({ providerSecret }, 429),
      }),
    ).rejects.toEqual(new SpotifyPlaylistItemsError("rate_limited"));

    await expect(
      getPlaylistItems({
        accessToken: "secret-token",
        playlistId: "playlist-1",
        fetch: async () => jsonResponse({ providerSecret }, 500),
      }),
    ).rejects.toEqual(new SpotifyPlaylistItemsError("unavailable"));
  });

  it("classifies invalid JSON, network failures, and invalid provider pagination neutrally", async () => {
    const providerSecret = "network-provider-secret";

    await expect(
      getPlaylistItems({
        accessToken: "secret-token",
        playlistId: "playlist-1",
        fetch: async () =>
          new Response(providerSecret, {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      }),
    ).rejects.toEqual(new SpotifyPlaylistItemsError("unavailable"));

    await expect(
      getPlaylistItems({
        accessToken: "secret-token",
        playlistId: "playlist-1",
        fetch: async () => {
          throw new Error(providerSecret);
        },
      }),
    ).rejects.toEqual(new SpotifyPlaylistItemsError("unavailable"));

    for (const next of [
      "https://evil.example/v1/playlists/playlist-1/items?offset=50",
      "http://api.spotify.com/v1/playlists/playlist-1/items?offset=50",
      "https://api.spotify.com.evil/v1/playlists/playlist-1/items?offset=50",
      "https://user:pass@api.spotify.com/v1/playlists/playlist-1/items?offset=50",
    ]) {
      const error = await getRejectedError(
        getPlaylistItems({
          accessToken: "secret-token",
          playlistId: "playlist-1",
          fetch: async () =>
            jsonResponse(playlistItemsPayload({ next })),
        }),
      );

      expect(error).toEqual(new SpotifyPlaylistItemsError("unavailable"));
    }
  });

  it("requires the current item wrapper and rejects the legacy tracks wrapper without leaking provider values", async () => {
    const providerSecret = "legacy-provider-secret";
    const error = await getRejectedError(
      getPlaylistItems({
        accessToken: "secret-token",
        playlistId: "playlist-1",
        fetch: async () =>
          jsonResponse(
            playlistItemsPayload({
              items: [
                {
                  is_local: false,
                  track: validTrack({ providerSecret }),
                },
              ],
            }),
          ),
      }),
    );

    expect(error).toEqual(new SpotifyPlaylistItemsError("unavailable"));
    expect(String(error)).not.toContain("secret-token");
    expect(String(error)).not.toContain(providerSecret);
    expect(String(error)).not.toContain("api.spotify.com");
  });

  it("rejects malformed page envelopes without leaking provider values", async () => {
    const malformedPages: unknown[] = [
      { items: [], next: null, offset: 0, total: 0 },
      playlistItemsPayload({ items: "not-an-array" }),
      playlistItemsPayload({ limit: 51 }),
      playlistItemsPayload({ offset: -1 }),
      playlistItemsPayload({ total: Number.MAX_SAFE_INTEGER + 1 }),
      playlistItemsPayload({ next: "http://api.spotify.com/v1/playlists/playlist-1/items" }),
      playlistItemsPayload({ next: "https://api.spotify.com.evil/v1/playlists/playlist-1/items" }),
    ];

    for (const malformedPage of malformedPages) {
      const error = await getRejectedError(
        getPlaylistItems({
          accessToken: "secret-token",
          playlistId: "playlist-1",
          fetch: async () => jsonResponse(malformedPage),
        }),
      );

      expect(error).toEqual(new SpotifyPlaylistItemsError("unavailable"));
      expect(String(error)).not.toContain("secret-token");
      expect(String(error)).not.toContain("api.spotify.com");
    }
  });

  it("does not mutate the provider response", async () => {
    const payload = playlistItemsPayload({
      items: [
        wrapper(
          validTrack({
            artists: [{ name: " Artist " }],
          }),
        ),
      ],
    });
    const before = JSON.stringify(payload);

    await getPlaylistItems({
      accessToken: "access-token",
      playlistId: "playlist-1",
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
