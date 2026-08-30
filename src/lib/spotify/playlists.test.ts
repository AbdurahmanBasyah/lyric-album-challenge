import { describe, expect, it, vi } from "vitest";

import type { SpotifyFetch } from "../auth/spotify";
import {
  SAVED_PLAYLISTS_PAGE_SIZE,
  SpotifyPlaylistsError,
  UNTITLED_PLAYLIST_NAME,
  buildSavedPlaylistsUrl,
  buildSpotifyPlaylistUrl,
  fingerprintSpotifyPlaylistsSchemaIssue,
  getSavedPlaylists,
  parseOffsetCursor,
} from "./playlists";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function capturePlaylistError(
  action: () => Promise<unknown>,
): Promise<SpotifyPlaylistsError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof SpotifyPlaylistsError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected SpotifyPlaylistsError.");
}

function playlistItem(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    collaborative: false,
    description: null,
    external_urls: {
      spotify: "https://open.spotify.com/playlist/provider-value",
    },
    href: "https://api.spotify.com/v1/playlists/playlist-1",
    id: "playlist-1",
    images: [
      {
        height: 640,
        width: 640,
        url: "https://images.example/playlist.jpg",
      },
    ],
    name: " Playlist One ",
    owner: {
      display_name: " Owner One ",
      id: "owner-1",
    },
    public: true,
    snapshot_id: "snapshot-value",
    // Spotify's current shape uses this count. `tracks.total` below is the
    // compatibility value and deliberately differs for the preference test.
    items: {
      href: "https://api.spotify.com/v1/playlists/playlist-1/items",
      limit: 100,
      next: null,
      offset: 0,
      previous: null,
      total: 7,
    },
    tracks: {
      href: "https://api.spotify.com/v1/playlists/playlist-1/tracks",
      total: 99,
    },
    type: "playlist",
    uri: "spotify:playlist:playlist-1",
    ...overrides,
  };
}

function playlistsPayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    href: "https://api.spotify.com/v1/me/playlists?offset=0&limit=24",
    limit: SAVED_PLAYLISTS_PAGE_SIZE,
    next: "https://api.spotify.com/v1/me/playlists?offset=24&limit=24",
    offset: 0,
    previous: null,
    total: 25,
    items: [playlistItem()],
    ...overrides,
  };
}

describe("Spotify playlist adapter", () => {
  it("maps only PlaylistSummary fields and uses an app-owned HTTPS link", async () => {
    let requestInput: string | URL | undefined;
    let requestInit: RequestInit | undefined;
    const fetchMock: SpotifyFetch = async (input, init) => {
      requestInput = input;
      requestInit = init;
      return jsonResponse(playlistsPayload());
    };

    const page = await getSavedPlaylists("access-token", undefined, {
      fetch: fetchMock,
    });

    expect(page).toEqual({
      items: [
        {
          spotifyId: "playlist-1",
          name: "Playlist One",
          ownerName: "Owner One",
          imageUrl: "https://images.example/playlist.jpg",
          totalItems: 7,
          itemsAvailable: true,
          isPublic: true,
          spotifyUrl: "https://open.spotify.com/playlist/playlist-1",
        },
      ],
      nextCursor: "24",
    });
    expect(new URL(String(requestInput)).pathname).toBe("/v1/me/playlists");
    expect(new URL(String(requestInput)).searchParams.get("limit")).toBe(
      String(SAVED_PLAYLISTS_PAGE_SIZE),
    );
    expect(new URL(String(requestInput)).searchParams.get("offset")).toBe("0");
    expect(new URL(String(requestInput)).searchParams.get("access_token")).toBe(
      null,
    );
    expect(new Headers(requestInit?.headers).get("authorization")).toBe(
      "Bearer access-token",
    );
    expect(JSON.stringify(page)).not.toContain("provider-value");
    expect(JSON.stringify(page)).not.toContain("snapshot-value");
  });

  it("retries a transient provider response through the injected sleep seam", async () => {
    const fetchMock = vi
      .fn<SpotifyFetch>()
      .mockResolvedValueOnce(jsonResponse({ provider_secret: "ignored" }, 502))
      .mockResolvedValueOnce(
        jsonResponse(playlistsPayload({ next: null, total: 1 })),
      );
    const sleep = vi.fn(async () => undefined);

    const page = await getSavedPlaylists("access-token", undefined, {
      fetch: fetchMock,
      sleep,
    });

    expect(page.nextCursor).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it("keeps empty or whitespace-only playlist names with a usable fallback label", async () => {
    const page = await getSavedPlaylists("access-token", undefined, {
      fetch: async () =>
        jsonResponse(
          playlistsPayload({
            next: null,
            total: 3,
            items: [
              playlistItem({ id: "empty-name", name: "" }),
              playlistItem({ id: "whitespace-name", name: " \t  " }),
              playlistItem({ id: "trimmed-name", name: "  Saved Mix  " }),
            ],
          }),
        ),
    });

    expect(page.items.map(({ spotifyId, name }) => ({ spotifyId, name }))).toEqual(
      [
        { spotifyId: "empty-name", name: UNTITLED_PLAYLIST_NAME },
        { spotifyId: "whitespace-name", name: UNTITLED_PLAYLIST_NAME },
        { spotifyId: "trimmed-name", name: "Saved Mix" },
      ],
    );
  });

  it("prefers items.total and falls back to deprecated tracks.total", async () => {
    const current = await getSavedPlaylists("access-token", undefined, {
      fetch: async () => jsonResponse(playlistsPayload()),
    });
    const legacy = await getSavedPlaylists("access-token", undefined, {
      fetch: async () =>
        jsonResponse(
          playlistsPayload({
            items: [playlistItem({ items: undefined })],
          }),
        ),
    });

    expect(current.items[0]?.totalItems).toBe(7);
    expect(current.items[0]?.itemsAvailable).toBe(true);
    expect(legacy.items[0]?.totalItems).toBe(99);
    expect(legacy.items[0]?.itemsAvailable).toBe(true);
  });

  it("keeps zero counts available and maps metadata-only playlists as unknown", async () => {
    const zero = await getSavedPlaylists("access-token", undefined, {
      fetch: async () =>
        jsonResponse(
          playlistsPayload({
            next: null,
            total: 1,
            items: [playlistItem({ items: { total: 0 }, tracks: undefined })],
          }),
        ),
    });
    const metadataOnly = await getSavedPlaylists("access-token", undefined, {
      fetch: async () =>
        jsonResponse(
          playlistsPayload({
            next: null,
            items: [
              playlistItem({
                id: "metadata-only",
                name: "Metadata Only",
                items: undefined,
                tracks: undefined,
              }),
            ],
          }),
        ),
    });

    expect(zero.items[0]?.totalItems).toBe(0);
    expect(zero.items[0]?.itemsAvailable).toBe(true);
    expect(metadataOnly.items[0]).toMatchObject({
      spotifyId: "metadata-only",
      name: "Metadata Only",
      totalItems: null,
      itemsAvailable: false,
    });
    expect(metadataOnly.nextCursor).toBeNull();
  });

  it("maps current, legacy, and metadata-only playlists in one page", async () => {
    const page = await getSavedPlaylists("access-token", undefined, {
      fetch: async () =>
        jsonResponse(
          playlistsPayload({
            next: null,
            total: 3,
            items: [
              playlistItem({ id: "current", name: "Current" }),
              playlistItem({
                id: "legacy",
                name: "Legacy",
                items: undefined,
                tracks: { total: 3 },
              }),
              playlistItem({
                id: "metadata-only",
                name: "Metadata Only",
                items: undefined,
                tracks: undefined,
              }),
            ],
          }),
        ),
    });

    expect(page.items.map(({ spotifyId, totalItems, itemsAvailable }) => ({
      spotifyId,
      totalItems,
      itemsAvailable,
    }))).toEqual([
      { spotifyId: "current", totalItems: 7, itemsAvailable: true },
      { spotifyId: "legacy", totalItems: 3, itemsAvailable: true },
      { spotifyId: "metadata-only", totalItems: null, itemsAvailable: false },
    ]);
  });

  it("accepts null or omitted cover metadata and skips unavailable placeholders", async () => {
    const page = await getSavedPlaylists("access-token", undefined, {
      fetch: async () =>
        jsonResponse(
          playlistsPayload({
            next: "https://api.spotify.com/v1/me/playlists?limit=24",
            items: [
              null,
              playlistItem({
                id: "no-cover",
                name: "No Cover",
                images: null,
                items: { total: 2 },
                tracks: undefined,
              }),
              playlistItem({
                id: "cover-omitted",
                name: "Cover Omitted",
                images: [{}],
                owner: { display_name: "  " },
                items: undefined,
                tracks: undefined,
              }),
              playlistItem({
                id: "cover-missing",
                name: "Cover Missing",
                images: undefined,
                items: undefined,
                tracks: undefined,
              }),
            ],
          }),
        ),
    });

    expect(page.items).toEqual([
      {
        spotifyId: "no-cover",
        name: "No Cover",
        ownerName: "Owner One",
        imageUrl: null,
        totalItems: 2,
        itemsAvailable: true,
        isPublic: true,
        spotifyUrl: "https://open.spotify.com/playlist/no-cover",
      },
      {
        spotifyId: "cover-omitted",
        name: "Cover Omitted",
        ownerName: null,
        imageUrl: null,
        totalItems: null,
        itemsAvailable: false,
        isPublic: true,
        spotifyUrl: "https://open.spotify.com/playlist/cover-omitted",
      },
      {
        spotifyId: "cover-missing",
        name: "Cover Missing",
        ownerName: "Owner One",
        imageUrl: null,
        totalItems: null,
        itemsAvailable: false,
        isPublic: true,
        spotifyUrl: "https://open.spotify.com/playlist/cover-missing",
      },
    ]);
    // The null provider entry still occupies a position in the page, so the
    // opaque cursor advances by all provider entries rather than mapped cards.
    expect(page.nextCursor).toBe("4");
  });

  it("uses supplied decimal cursors and returns null at the end of a page", async () => {
    let requestInput: string | URL | undefined;
    const page = await getSavedPlaylists("access-token", "24", {
      fetch: async (input) => {
        requestInput = input;
        return jsonResponse(
          playlistsPayload({
            next: null,
            offset: 24,
            total: 25,
          }),
        );
      },
    });

    expect(page.nextCursor).toBeNull();
    expect(new URL(String(requestInput)).searchParams.get("offset")).toBe("24");
    expect(parseOffsetCursor(undefined)).toBe(0);
    expect(parseOffsetCursor("24")).toBe(24);
    expect(buildSavedPlaylistsUrl("24").searchParams.get("offset")).toBe("24");
    expect(buildSpotifyPlaylistUrl("playlist-1")).toBe(
      "https://open.spotify.com/playlist/playlist-1",
    );
  });

  it("rejects malformed cursors without making a provider request", async () => {
    const requests: Array<string | URL> = [];
    const fetchMock: SpotifyFetch = async (input) => {
      requests.push(input);
      return jsonResponse(playlistsPayload());
    };

    for (const cursor of [
      "",
      "-1",
      "01",
      "1.5",
      "not-an-offset",
      "9007199254740992",
    ]) {
      await expect(
        getSavedPlaylists("access-token", cursor, { fetch: fetchMock }),
      ).rejects.toEqual(new SpotifyPlaylistsError("invalid_cursor"));
    }

    await expect(
      getSavedPlaylists("", undefined, { fetch: fetchMock }),
    ).rejects.toEqual(new SpotifyPlaylistsError("auth"));
    expect(requests).toHaveLength(0);
  });

  it("classifies malformed payloads, provider statuses, and network failures safely", async () => {
    await expect(
      getSavedPlaylists("access-token", undefined, {
        fetch: async () => jsonResponse({ items: [] }),
      }),
    ).rejects.toEqual(new SpotifyPlaylistsError("unavailable"));

    await expect(
      getSavedPlaylists("access-token", undefined, {
        fetch: async () =>
          new Response("not-json", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      }),
    ).rejects.toEqual(new SpotifyPlaylistsError("unavailable"));

    await expect(
      getSavedPlaylists("access-token", undefined, {
        fetch: async () => jsonResponse({ provider_secret: "must-not-leak" }, 401),
      }),
    ).rejects.toEqual(new SpotifyPlaylistsError("auth"));

    await expect(
      getSavedPlaylists("access-token", undefined, {
        fetch: async () => jsonResponse({ provider_secret: "must-not-leak" }, 403),
      }),
    ).rejects.toEqual(new SpotifyPlaylistsError("scope"));

    await expect(
      getSavedPlaylists("access-token", undefined, {
        fetch: async () => jsonResponse({ provider_secret: "must-not-leak" }, 429),
      }),
    ).rejects.toEqual(new SpotifyPlaylistsError("rate_limited"));

    await expect(
      getSavedPlaylists("access-token", undefined, {
        fetch: async () => jsonResponse({ provider_secret: "must-not-leak" }, 500),
      }),
    ).rejects.toEqual(new SpotifyPlaylistsError("unavailable"));

    await expect(
      getSavedPlaylists("access-token", undefined, {
        fetch: async () => {
          throw new Error("provider-secret-network-detail");
        },
      }),
    ).rejects.toEqual(new SpotifyPlaylistsError("unavailable"));
  });

  it("keeps internal failure reasons typed and non-sensitive", async () => {
    const providerStatus = await capturePlaylistError(() =>
      getSavedPlaylists("access-token", undefined, {
        fetch: async () =>
          jsonResponse({ provider_secret: "must-not-leak" }, 503),
      }),
    );
    const networkFailure = await capturePlaylistError(() =>
      getSavedPlaylists("access-token", undefined, {
        fetch: async () => {
          throw new Error("provider-secret-network-detail");
        },
      }),
    );
    const invalidJson = await capturePlaylistError(() =>
      getSavedPlaylists("access-token", undefined, {
        fetch: async () => new Response("not-json", { status: 200 }),
      }),
    );
    const invalidSchema = await capturePlaylistError(() =>
      getSavedPlaylists("access-token", undefined, {
        fetch: async () => jsonResponse({ items: [] }),
      }),
    );
    const invalidPagination = await capturePlaylistError(() =>
      getSavedPlaylists("access-token", undefined, {
        fetch: async () =>
          jsonResponse(
            playlistsPayload({
              next: "https://api.spotify.com/v1/me/playlists?offset=not-an-offset",
            }),
          ),
      }),
    );
    const invalidCursor = await capturePlaylistError(() =>
      getSavedPlaylists("access-token", "not-an-offset", {
        fetch: async () => jsonResponse(playlistsPayload()),
      }),
    );
    const mapping = await capturePlaylistError(async () => {
      buildSpotifyPlaylistUrl("playlist/1");
    });

    expect(providerStatus).toMatchObject({
      kind: "unavailable",
      reason: "provider_http_status",
      providerStatus: 503,
    });
    expect(networkFailure).toMatchObject({
      kind: "unavailable",
      reason: "network_failure",
      providerStatus: undefined,
    });
    expect(invalidJson).toMatchObject({
      kind: "unavailable",
      reason: "invalid_json",
      providerStatus: undefined,
    });
    expect(invalidSchema).toMatchObject({
      kind: "unavailable",
      reason: "invalid_response_schema",
      providerStatus: undefined,
    });
    expect(invalidPagination).toMatchObject({
      kind: "unavailable",
      reason: "invalid_pagination",
      providerStatus: undefined,
    });
    expect(invalidCursor).toMatchObject({
      kind: "invalid_cursor",
      reason: "invalid_pagination",
      providerStatus: undefined,
    });
    expect(mapping).toMatchObject({
      kind: "unavailable",
      reason: "mapping",
      providerStatus: undefined,
    });

    for (const error of [
      providerStatus,
      networkFailure,
      invalidJson,
      invalidSchema,
      invalidPagination,
      invalidCursor,
      mapping,
    ]) {
      expect(error.message).not.toContain("provider-secret");
      expect(JSON.stringify(error)).not.toContain("provider-secret");
    }
  });

  it("rejects malformed present item counts instead of inventing one", async () => {
    for (const malformedItem of [
      { total: -1 },
      { total: 1.5 },
      { total: "7" },
      {},
    ]) {
      await expect(
        getSavedPlaylists("access-token", undefined, {
          fetch: async () =>
            jsonResponse(
              playlistsPayload({
                items: [
                  playlistItem({
                    items: malformedItem,
                    tracks: { total: 4 },
                  }),
                ],
              }),
            ),
        }),
      ).rejects.toEqual(new SpotifyPlaylistsError("unavailable"));
    }

    await expect(
      getSavedPlaylists("access-token", undefined, {
        fetch: async () =>
          jsonResponse(
            playlistsPayload({
              items: [
                playlistItem({
                  items: undefined,
                  tracks: { total: -1 },
                }),
              ],
            }),
          ),
      }),
    ).rejects.toEqual(new SpotifyPlaylistsError("unavailable"));
  });

  it("rejects malformed playlist IDs and pagination URLs safely", async () => {
    for (const id of ["", "playlist/1", "playlist id", "playlist?next=1"]) {
      await expect(
        getSavedPlaylists("access-token", undefined, {
          fetch: async () =>
            jsonResponse(
              playlistsPayload({ items: [playlistItem({ id })] }),
            ),
        }),
      ).rejects.toEqual(new SpotifyPlaylistsError("unavailable"));
    }

    await expect(
      getSavedPlaylists("access-token", undefined, {
        fetch: async () =>
          jsonResponse(playlistsPayload({ next: "not-a-url" })),
      }),
    ).rejects.toEqual(new SpotifyPlaylistsError("unavailable"));

    for (const next of [
      "http://api.spotify.com/v1/me/playlists?offset=24",
      "https://example.test/v1/me/playlists?offset=24",
      "javascript:alert(1)",
    ]) {
      await expect(
        getSavedPlaylists("access-token", undefined, {
          fetch: async () => jsonResponse(playlistsPayload({ next })),
        }),
      ).rejects.toEqual(new SpotifyPlaylistsError("unavailable"));
    }

    await expect(
      getSavedPlaylists("access-token", undefined, {
        fetch: async () =>
          jsonResponse(
            playlistsPayload({
              next: "https://api.spotify.com/v1/me/playlists?offset=not-an-offset",
            }),
          ),
      }),
    ).rejects.toEqual(new SpotifyPlaylistsError("unavailable"));

    expect(() => buildSpotifyPlaylistUrl("playlist/1")).toThrow(
      new SpotifyPlaylistsError("unavailable"),
    );
  });

  it("rejects a present malformed image URL without exposing provider details", async () => {
    for (const image of [{ url: "not-a-url" }, { url: "javascript:alert(1)" }]) {
      await expect(
        getSavedPlaylists("access-token", undefined, {
          fetch: async () =>
            jsonResponse(
              playlistsPayload({
                items: [playlistItem({ images: [image] })],
              }),
            ),
        }),
      ).rejects.toEqual(new SpotifyPlaylistsError("unavailable"));
    }
  });

  it("rejects missing, null, and non-string playlist names with safe diagnostics", async () => {
    const malformedNames: Array<{
      label: string;
      name: unknown;
      diagnostic: string;
    }> = [
      {
        label: "missing",
        name: undefined,
        diagnostic: "playlist_name_missing",
      },
      { label: "null", name: null, diagnostic: "playlist_name_type" },
      { label: "number", name: 42, diagnostic: "playlist_name_type" },
      {
        label: "object",
        name: { provider: "secret" },
        diagnostic: "playlist_name_type",
      },
    ];

    for (const { label, name, diagnostic } of malformedNames) {
      const error = await capturePlaylistError(() =>
        getSavedPlaylists("access-token", undefined, {
          fetch: async () =>
            jsonResponse(
              playlistsPayload({
                items: [playlistItem({ id: `malformed-${label}`, name })],
              }),
            ),
        }),
      );

      expect(error.kind).toBe("unavailable");
      expect(error.reason).toBe("invalid_response_schema");
      expect(error.schemaDiagnostic).toBe(diagnostic);
      expect(error.message).not.toContain("secret");
      expect(JSON.stringify(error)).not.toContain("secret");
    }
  });
});

describe("Spotify playlist schema diagnostics", () => {
  it("maps every supported page, playlist, count, and image field category", () => {
    const cases: Array<{
      issue: Record<string, unknown>;
      expected: string;
    }> = [
      {
        issue: {
          code: "invalid_type",
          expected: "array",
          input: undefined,
          path: ["items"],
        },
        expected: "page_items_missing",
      },
      {
        issue: {
          code: "invalid_type",
          expected: "array",
          input: "provider-value",
          path: ["items"],
        },
        expected: "page_items_type",
      },
      {
        issue: {
          code: "too_small",
          input: [],
          path: ["items"],
        },
        expected: "page_items_invalid",
      },
      {
        issue: {
          code: "invalid_type",
          expected: "number",
          input: undefined,
          path: ["limit"],
        },
        expected: "page_limit_missing",
      },
      {
        issue: {
          code: "invalid_type",
          expected: "number",
          input: "24",
          path: ["limit"],
        },
        expected: "page_limit_type",
      },
      {
        issue: { code: "too_small", input: 0, path: ["limit"] },
        expected: "page_limit_invalid",
      },
      {
        issue: {
          code: "invalid_type",
          expected: "string",
          input: undefined,
          path: ["next"],
        },
        expected: "page_next_missing",
      },
      {
        issue: {
          code: "invalid_type",
          expected: "string",
          input: 24,
          path: ["next"],
        },
        expected: "page_next_type",
      },
      {
        issue: {
          code: "invalid_format",
          input: "provider-url",
          path: ["next"],
        },
        expected: "page_next_invalid",
      },
      {
        issue: {
          code: "invalid_type",
          expected: "number",
          input: undefined,
          path: ["offset"],
        },
        expected: "page_offset_missing",
      },
      {
        issue: {
          code: "invalid_type",
          expected: "number",
          input: "0",
          path: ["offset"],
        },
        expected: "page_offset_type",
      },
      {
        issue: { code: "too_small", input: -1, path: ["offset"] },
        expected: "page_offset_invalid",
      },
      {
        issue: {
          code: "invalid_type",
          expected: "number",
          input: undefined,
          path: ["total"],
        },
        expected: "page_total_missing",
      },
      {
        issue: {
          code: "invalid_type",
          expected: "number",
          input: "25",
          path: ["total"],
        },
        expected: "page_total_type",
      },
      {
        issue: { code: "custom", input: 1e30, path: ["total"] },
        expected: "page_total_invalid",
      },
      {
        issue: {
          code: "invalid_type",
          expected: "object",
          input: "provider-item",
          path: ["items", 17],
        },
        expected: "playlist_item_type",
      },
      {
        issue: {
          code: "invalid_type",
          expected: "string",
          input: undefined,
          path: ["items", 17, "id"],
        },
        expected: "playlist_id_missing",
      },
      {
        issue: {
          code: "invalid_type",
          expected: "string",
          input: 17,
          path: ["items", 17, "id"],
        },
        expected: "playlist_id_type",
      },
      {
        issue: {
          code: "invalid_format",
          input: "playlist/provider-value",
          path: ["items", 17, "id"],
        },
        expected: "playlist_id_invalid",
      },
      {
        issue: {
          code: "invalid_type",
          expected: "string",
          input: undefined,
          path: ["items", 17, "name"],
        },
        expected: "playlist_name_missing",
      },
      {
        issue: {
          code: "invalid_type",
          expected: "string",
          input: 17,
          path: ["items", 17, "name"],
        },
        expected: "playlist_name_type",
      },
      {
        issue: {
          code: "too_small",
          input: "",
          path: ["items", 17, "name"],
        },
        expected: "playlist_name_invalid",
      },
      {
        issue: {
          code: "invalid_type",
          expected: "object",
          input: undefined,
          path: ["items", 17, "owner"],
        },
        expected: "playlist_owner_missing",
      },
      {
        issue: {
          code: "invalid_type",
          expected: "object",
          input: "provider-owner",
          path: ["items", 17, "owner"],
        },
        expected: "playlist_owner_type",
      },
      {
        issue: {
          code: "custom",
          input: "provider-owner",
          path: ["items", 17, "owner", "display_name"],
        },
        expected: "playlist_owner_invalid",
      },
      {
        issue: {
          code: "invalid_type",
          expected: "object",
          input: undefined,
          path: ["items", 17, "items"],
        },
        expected: "playlist_count_missing",
      },
      {
        issue: {
          code: "invalid_type",
          expected: "object",
          input: "provider-count",
          path: ["items", 17, "items"],
        },
        expected: "playlist_count_type",
      },
      {
        issue: {
          code: "custom",
          input: 1e30,
          path: ["items", 17, "items", "total"],
        },
        expected: "playlist_count_invalid",
      },
      {
        issue: {
          code: "invalid_type",
          expected: "boolean",
          input: "provider-public",
          path: ["items", 17, "public"],
        },
        expected: "playlist_public_type",
      },
      {
        issue: {
          code: "invalid_value",
          input: "provider-public",
          path: ["items", 17, "public"],
        },
        expected: "playlist_public_invalid",
      },
      {
        issue: {
          code: "invalid_type",
          expected: "array",
          input: "provider-images",
          path: ["items", 17, "images"],
        },
        expected: "playlist_images_type",
      },
      {
        issue: {
          code: "invalid_format",
          input: "provider-images",
          path: ["items", 17, "images"],
        },
        expected: "playlist_images_invalid",
      },
      {
        issue: {
          code: "invalid_type",
          expected: "string",
          input: undefined,
          path: ["url"],
        },
        expected: "image_url_missing",
      },
      {
        issue: {
          code: "invalid_type",
          expected: "string",
          input: "provider-image-value",
          path: ["url"],
        },
        expected: "image_url_type",
      },
      {
        issue: {
          code: "invalid_format",
          input: "provider-image-value",
          path: ["url"],
        },
        expected: "image_url_invalid",
      },
    ];

    for (const { issue, expected } of cases) {
      expect(fingerprintSpotifyPlaylistsSchemaIssue(issue)).toBe(expected);
    }
  });

  it("collapses unknown issue codes and paths without leaking provider data", () => {
    const diagnostic = fingerprintSpotifyPlaylistsSchemaIssue({
      code: "provider_internal_error",
      expected: "provider-secret-type",
      input: "provider-secret-value",
      message: "provider-secret-message",
      path: ["items", 987654, "provider_secret_field"],
    });

    expect(diagnostic).toBe("response_shape_other");
    expect(diagnostic).not.toContain("provider");
    expect(diagnostic).not.toContain("987654");
  });

  it("keeps error diagnostics non-enumerable and runtime values allowlisted", () => {
    const error = new SpotifyPlaylistsError("unavailable", {
      reason: "provider-secret-reason" as never,
      schemaDiagnostic: "provider-secret-diagnostic" as never,
    });

    expect(error.reason).toBe("mapping");
    expect(error.schemaDiagnostic).toBe("response_shape_other");
    expect(Object.keys(error)).toEqual(["name", "kind"]);
    expect(Object.keys(error)).not.toContain("reason");
    expect(Object.keys(error)).not.toContain("schemaDiagnostic");
    expect(JSON.stringify(error)).not.toContain("provider-secret");
  });
});
