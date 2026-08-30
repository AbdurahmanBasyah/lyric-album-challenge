import { describe, expect, it } from "vitest";

import type { TrackSummary } from "../../types/tracks";
import {
  SpotifyAlbumTracksError,
  type SpotifyAlbumTracksPage,
} from "../spotify/album-tracks";
import {
  SpotifyPlaylistItemsError,
  type SpotifyPlaylistItemsPage,
} from "../spotify/playlist-items";
import {
  MAX_SOURCE_TRACK_PAGES,
  MAX_SOURCE_TRACK_POSITIONS,
  SOURCE_TRACKS_PAGE_SIZE,
  SourceTrackCollectionError,
  collectSourceTracks,
  type ChallengeSource,
} from "./source-tracks";

function track(
  spotifyId: string,
  overrides: Partial<TrackSummary> = {},
): TrackSummary {
  return {
    spotifyId,
    name: `Track ${spotifyId}`,
    artistNames: ["Artist"],
    durationMs: 180_000,
    ...overrides,
  };
}

function albumPage(
  items: readonly TrackSummary[],
  nextCursor: string | null = null,
): SpotifyAlbumTracksPage {
  return { items, nextCursor };
}

function playlistPage(
  items: readonly TrackSummary[],
  nextCursor: string | null = null,
): SpotifyPlaylistItemsPage {
  return { items, nextCursor };
}

const albumSource: ChallengeSource = {
  kind: "album",
  spotifyId: "album-1",
  name: "Selected Album",
};

const playlistSource: ChallengeSource = {
  kind: "playlist",
  spotifyId: "playlist-1",
};

describe("collectSourceTracks", () => {
  it("exports the bounded MVP source policy", () => {
    expect(SOURCE_TRACKS_PAGE_SIZE).toBe(50);
    expect(MAX_SOURCE_TRACK_PAGES).toBe(4);
    expect(MAX_SOURCE_TRACK_POSITIONS).toBe(200);
  });

  it("dispatches an album source only to the album loader", async () => {
    let albumCalls = 0;
    let playlistCalls = 0;

    const result = await collectSourceTracks(albumSource, "access-token", {
      loadAlbumPage: async () => {
        albumCalls += 1;
        return albumPage([track("album-track")]);
      },
      loadPlaylistPage: async () => {
        playlistCalls += 1;
        return playlistPage([track("unexpected")]);
      },
    });

    expect(result.tracks.map(({ spotifyId }) => spotifyId)).toEqual([
      "album-track",
    ]);
    expect(albumCalls).toBe(1);
    expect(playlistCalls).toBe(0);
  });

  it("dispatches a playlist source only to the playlist loader", async () => {
    let albumCalls = 0;
    let playlistCalls = 0;

    const result = await collectSourceTracks(playlistSource, "access-token", {
      loadAlbumPage: async () => {
        albumCalls += 1;
        return albumPage([track("unexpected")]);
      },
      loadPlaylistPage: async () => {
        playlistCalls += 1;
        return playlistPage([track("playlist-track")]);
      },
    });

    expect(result.tracks.map(({ spotifyId }) => spotifyId)).toEqual([
      "playlist-track",
    ]);
    expect(albumCalls).toBe(0);
    expect(playlistCalls).toBe(1);
  });

  it("propagates the album name and follows canonical cursors sequentially", async () => {
    const requests: Array<{
      accessToken: string;
      albumId: string;
      albumName: string;
      cursor?: string;
    }> = [];
    const pages: Record<string, SpotifyAlbumTracksPage> = {
      "__first__": albumPage([track("track-0")], "50"),
      "50": albumPage([track("track-1")], "100"),
      "100": albumPage([track("track-2")]),
    };

    const result = await collectSourceTracks(
      {
        kind: "album",
        spotifyId: "album-1",
        name: "  Selected Album  ",
      },
      "  access-token  ",
      {
        loadAlbumPage: async (request) => {
          requests.push(request);
          return pages[request.cursor ?? "__first__"];
        },
      },
    );

    expect(result).toEqual({
      tracks: [track("track-0"), track("track-1"), track("track-2")],
      pagesFetched: 3,
      sourceTruncated: false,
    });
    expect(requests).toEqual([
      {
        accessToken: "access-token",
        albumId: "album-1",
        albumName: "Selected Album",
      },
      {
        accessToken: "access-token",
        albumId: "album-1",
        albumName: "Selected Album",
        cursor: "50",
      },
      {
        accessToken: "access-token",
        albumId: "album-1",
        albumName: "Selected Album",
        cursor: "100",
      },
    ]);
  });

  it("continues after a fully filtered empty page", async () => {
    const cursors: Array<string | undefined> = [];

    const result = await collectSourceTracks(albumSource, "access-token", {
      loadAlbumPage: async ({ cursor }) => {
        cursors.push(cursor);

        if (cursor === undefined) {
          return albumPage([], "50");
        }

        return albumPage([track("after-empty")]);
      },
    });

    expect(result.tracks.map(({ spotifyId }) => spotifyId)).toEqual([
      "after-empty",
    ]);
    expect(result.pagesFetched).toBe(2);
    expect(cursors).toEqual([undefined, "50"]);
  });

  it("stops at four pages, never requests a fifth, and reports truncation", async () => {
    const cursors: Array<string | undefined> = [];

    const result = await collectSourceTracks(playlistSource, "access-token", {
      loadPlaylistPage: async ({ cursor }) => {
        cursors.push(cursor);
        const pageIndex = cursors.length - 1;
        return playlistPage([track(`track-${pageIndex}`)], `${(pageIndex + 1) * 50}`);
      },
    });

    expect(cursors).toEqual([undefined, "50", "100", "150"]);
    expect(cursors).toHaveLength(MAX_SOURCE_TRACK_PAGES);
    expect(result.pagesFetched).toBe(MAX_SOURCE_TRACK_PAGES);
    expect(result.tracks).toHaveLength(MAX_SOURCE_TRACK_PAGES);
    expect(result.sourceTruncated).toBe(true);
    expect(result.tracks.length).toBeLessThanOrEqual(MAX_SOURCE_TRACK_POSITIONS);
  });

  it("deduplicates by Spotify ID and keeps the first occurrence", async () => {
    const result = await collectSourceTracks(playlistSource, "access-token", {
      loadPlaylistPage: async ({ cursor }) =>
        cursor === undefined
          ? playlistPage([
              track("same", { name: "First occurrence" }),
              track("same", { name: "Second occurrence" }),
              track("first-page"),
            ], "50")
          : playlistPage([
              track("same", { name: "Third occurrence" }),
              track("second-page"),
            ]),
    });

    expect(result.tracks.map(({ spotifyId }) => spotifyId)).toEqual([
      "same",
      "first-page",
      "second-page",
    ]);
    expect(result.tracks[0]?.name).toBe("First occurrence");
  });

  it("rejects repeated cursors and pagination cycles before another request", async () => {
    let requestCount = 0;
    const error = await getRejectedError(
      collectSourceTracks(albumSource, "access-token", {
        loadAlbumPage: async ({ cursor }) => {
          requestCount += 1;
          return cursor === undefined
            ? albumPage([track("first")], "50")
            : albumPage([track("second")], "50");
        },
      }),
    );

    expect(error).toEqual(new SourceTrackCollectionError("pagination_cycle"));
    expect(requestCount).toBe(2);
  });

  it("preserves typed adapter error identity and category", async () => {
    const adapterError = new SpotifyAlbumTracksError("auth");

    await expect(
      collectSourceTracks(albumSource, "access-token", {
        loadAlbumPage: async () => {
          throw adapterError;
        },
      }),
    ).rejects.toBe(adapterError);
  });

  it("sanitizes unexpected loader errors without leaking their detail", async () => {
    const providerSecret = "provider-body-with-access-token";
    const error = await getRejectedError(
      collectSourceTracks(playlistSource, "access-token", {
        loadPlaylistPage: async () => {
          throw new Error(providerSecret);
        },
      }),
    );

    expect(error).toEqual(new SourceTrackCollectionError("invalid_page"));
    expect(String(error)).not.toContain(providerSecret);
  });

  it("preserves typed playlist adapter errors", async () => {
    const adapterError = new SpotifyPlaylistItemsError("inaccessible");

    await expect(
      collectSourceTracks(playlistSource, "access-token", {
        loadPlaylistPage: async () => {
          throw adapterError;
        },
      }),
    ).rejects.toBe(adapterError);
  });

  it("rejects invalid source and token before making a loader call", async () => {
    let requestCount = 0;
    const loader = async () => {
      requestCount += 1;
      return albumPage([]);
    };

    const invalidSources: unknown[] = [
      { kind: "album", spotifyId: "https://open.spotify.com/album/id", name: "Album" },
      { kind: "album", spotifyId: "album/1", name: "Album" },
      { kind: "album", spotifyId: "album-1", name: "   " },
      { kind: "artist", spotifyId: "artist-1", name: "Artist" },
      { kind: "playlist", spotifyId: "playlist?1" },
    ];

    for (const source of invalidSources) {
      await expect(
        collectSourceTracks(source as ChallengeSource, "access-token", {
          loadAlbumPage: loader,
        }),
      ).rejects.toEqual(new SourceTrackCollectionError("invalid_source"));
    }

    await expect(
      collectSourceTracks(albumSource, "   ", { loadAlbumPage: loader }),
    ).rejects.toEqual(new SourceTrackCollectionError("invalid_token"));
    expect(requestCount).toBe(0);
  });

  it("accepts the object request form and aliases the injected loaders", async () => {
    const result = await collectSourceTracks({
      source: playlistSource,
      accessToken: "access-token",
      loaders: {
        playlistItems: async () => playlistPage([track("object-form")]),
      },
    });

    expect(result.tracks.map(({ spotifyId }) => spotifyId)).toEqual([
      "object-form",
    ]);
  });

  it("does not mutate input and returns recursively immutable reduced output", async () => {
    const providerTrack = {
      ...track("immutable"),
      artistNames: ["Artist"],
      providerSecret: "provider-secret",
    } as TrackSummary & { providerSecret: string };
    const source = {
      kind: "album" as const,
      spotifyId: "album-1",
      name: "Album",
      providerSecret: "source-secret",
    };
    const before = JSON.stringify({ source, providerTrack });

    const result = await collectSourceTracks(source, "access-token", {
      loadAlbumPage: async () => albumPage([providerTrack]),
    });

    expect(JSON.stringify({ source, providerTrack })).toBe(before);
    expect(result).toEqual({
      tracks: [track("immutable")],
      pagesFetched: 1,
      sourceTruncated: false,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.tracks)).toBe(true);
    expect(Object.isFrozen(result.tracks[0])).toBe(true);
    expect(Object.isFrozen(result.tracks[0]?.artistNames)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("provider-secret");
    expect(JSON.stringify(result)).not.toContain("source-secret");
    expect(JSON.stringify(result)).not.toContain("access-token");
  });

  it("rejects malformed pages and cursors without leaking their values", async () => {
    const providerUrl = "https://api.spotify.com/secret?cursor=900";
    const malformedPages: unknown[] = [
      { items: [], nextCursor: undefined },
      { items: "not-an-array", nextCursor: null },
      { items: [], nextCursor: providerUrl },
      { items: [], nextCursor: "01" },
      { items: [], nextCursor: "9007199254740992" },
      {
        items: Array.from({ length: SOURCE_TRACKS_PAGE_SIZE + 1 }, () =>
          track("too-many"),
        ),
        nextCursor: null,
      },
    ];

    for (const page of malformedPages) {
      const error = await getRejectedError(
        collectSourceTracks(playlistSource, "secret-token", {
          loadPlaylistPage: async () => page as SpotifyPlaylistItemsPage,
        }),
      );

      expect(error).toEqual(new SourceTrackCollectionError("invalid_page"));
      expect(String(error)).not.toContain("secret-token");
      expect(String(error)).not.toContain(providerUrl);
      expect(String(error)).not.toContain("9007199254740992");
    }
  });

  it("keeps adapter fields provider-neutral when a loader returns extra fields", async () => {
    const extraTrack = {
      ...track("reduced"),
      providerRecord: { secret: "provider-secret" },
      providerUrl: "https://api.spotify.com/v1/tracks/reduced",
    };

    const result = await collectSourceTracks(albumSource, "access-token", {
      loadAlbumPage: async () =>
        albumPage([extraTrack as TrackSummary & Record<string, unknown>]),
    });

    expect(result.tracks[0]).toEqual(track("reduced"));
    expect(JSON.stringify(result)).not.toContain("providerRecord");
    expect(JSON.stringify(result)).not.toContain("providerUrl");
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
