import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { MAX_SOURCE_TRACK_POSITIONS } from "../challenge/source-tracks";
import {
  PublicPlaylistResolverError,
  SPOTIFY_EMBED_PLAYLIST_BASE_URL,
  SPOTIFY_EMBED_PLAYLIST_PATH,
  SpotifyEmbedPlaylistResolver,
  normalizePublicPlaylistTrack,
} from "./public-playlist-resolver";

const playlistUrl =
  "https://open.spotify.com/playlist/playlist-1?si=ignored#ignored";
const embedFixture = readFileSync(
  new URL("./fixtures/spotify-embed-playlist.html", import.meta.url),
  "utf8",
);

function completeTrack(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    uri: "spotify:track:" + id,
    title: "Track " + id,
    subtitle: "Artist",
    duration: 180_000,
    isPlayable: true,
    ...overrides,
  };
}

function playlistEntity(
  tracks: readonly unknown[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: "playlist",
    id: "playlist-1",
    uri: "spotify:playlist:playlist-1",
    name: "Fixture playlist",
    trackList: tracks,
    ...overrides,
  };
}

function embedPayload(
  entity: Record<string, unknown>,
): Record<string, unknown> {
  return {
    props: {
      pageProps: {
        state: {
          data: {
            entity,
          },
        },
      },
    },
  };
}

function embedHtml(payload: unknown): string {
  return (
    "<!doctype html><html><body>" +
    '<script id="__NEXT_DATA__" type="application/json">' +
    JSON.stringify(payload) +
    "</script></body></html>"
  );
}

function response(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html" },
  });
}

async function getRejectedError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected promise to reject.");
}

describe("Spotify Embed public playlist resolver", () => {
  it("reads the sanitized Embed fixture through the exact fixed target", async () => {
    const fetchMock = vi.fn(
      async (input: string | URL, init?: RequestInit): Promise<Response> => {
        expect(String(input)).toBe(
          SPOTIFY_EMBED_PLAYLIST_BASE_URL +
            SPOTIFY_EMBED_PLAYLIST_PATH +
            "/playlist-1",
        );
        expect(init?.method).toBe("GET");
        expect(init?.headers).toEqual({ Accept: "text/html" });
        expect(init?.credentials).toBe("omit");
        expect(init?.redirect).toBe("error");
        expect(init?.headers).not.toHaveProperty("Authorization");
        return response(embedFixture);
      },
    );

    const result = await new SpotifyEmbedPlaylistResolver({
      fetch: fetchMock,
    }).resolvePlaylist(playlistUrl);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      spotifyId: "playlist-1",
      canonicalUrl: "https://open.spotify.com/playlist/playlist-1",
      name: "Fixture playlist",
      tracks: [
        {
          spotifyId: "track-1",
          name: "Track One",
          artistNames: ["Artist One"],
          durationMs: 180_000,
        },
        {
          spotifyId: "track-2",
          name: "Track Two",
          artistNames: ["Artist Two"],
          durationMs: 181_000,
        },
      ],
      sourceTruncated: false,
    });
  });

  it("retries a transient Embed response through the injected sleep seam", async () => {
    const fetchMock = vi
      .fn(async (): Promise<Response> => response("provider body", 503))
      .mockImplementationOnce(async () => response("provider body", 503))
      .mockImplementationOnce(async () => response(embedFixture));
    const sleep = vi.fn(async () => undefined);

    const result = await new SpotifyEmbedPlaylistResolver({
      fetch: fetchMock,
      sleep,
    }).resolvePlaylist(playlistUrl);

    expect(result.tracks).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it("normalizes minimal existing TrackSummary records without retaining extras", () => {
    const direct = normalizePublicPlaylistTrack({
      spotifyId: "track-direct",
      name: " Direct track ",
      artistNames: [" Artist "],
      durationMs: 180_000,
      providerSecret: "must-not-cross",
    });

    expect(direct).toEqual({
      spotifyId: "track-direct",
      name: "Direct track",
      artistNames: ["Artist"],
      durationMs: 180_000,
    });
    expect(JSON.stringify(direct)).not.toContain("must-not-cross");
  });

  it("skips zero and out-of-range Embed durations before the LRCLIB seam", async () => {
    const tracks = [
      completeTrack("zero", { duration: 0 }),
      completeTrack("too-short", { duration: 999 }),
      completeTrack("too-long", { duration: 3_600_001 }),
      completeTrack("negative", { duration: -1 }),
      completeTrack("fractional", { duration: 180_000.5 }),
      completeTrack("string", { duration: "180000" }),
      completeTrack("minimum", { duration: 1_000 }),
      completeTrack("maximum", { duration: 3_600_000 }),
    ];
    const resolver = new SpotifyEmbedPlaylistResolver({
      fetch: async () => response(embedHtml(embedPayload(playlistEntity(tracks)))),
    });

    const result = await resolver.resolvePlaylist(playlistUrl);

    expect(result.tracks.map((track) => track.spotifyId)).toEqual([
      "minimum",
      "maximum",
    ]);
  });

  it("accepts the common tracks.items and wrapped-track payload variants", async () => {
    const variants: readonly unknown[] = [
      {
        props: {
          pageProps: {
            playlist: {
              id: "playlist-1",
              name: "Items playlist",
              items: [completeTrack("items-track")],
            },
          },
        },
      },
      {
        props: {
          pageProps: {
            data: {
              playlist: {
                playlistId: "playlist-1",
                title: "Tracks playlist",
                tracks: { items: [{ track: completeTrack("wrapped-track") }] },
              },
            },
          },
        },
      },
      {
        dehydratedState: {
          queries: [
            {
              state: {
                data: {
                  entity: playlistEntity([completeTrack("query-track")]),
                },
              },
            },
          ],
        },
      },
    ];

    for (const payload of variants) {
      const resolver = new SpotifyEmbedPlaylistResolver({
        fetch: async () => response(embedHtml(payload)),
      });
      const result = await resolver.resolvePlaylist(playlistUrl);

      expect(result.tracks).toHaveLength(1);
      expect(result.tracks[0]?.spotifyId).toMatch(
        /^(items|wrapped|query)-track$/u,
      );
    }
  });

  it("drops incomplete, local, restricted, unplayable, and duplicate entries", async () => {
    const tracks = [
      completeTrack("duplicate", { title: "first" }),
      completeTrack("duplicate", { title: "second" }),
      { uri: "spotify:track:malformed", title: "No artist", duration: 1_000 },
      completeTrack("local", { isLocal: true }),
      completeTrack("restricted", { restricted: true }),
      completeTrack("malformed-restricted", { restricted: "yes" }),
      completeTrack("unavailable", { isPlayable: false }),
      completeTrack("valid-2", { artists: [{ name: "Second artist" }] }),
    ];
    const resolver = new SpotifyEmbedPlaylistResolver({
      fetch: async () => response(embedHtml(embedPayload(playlistEntity(tracks)))),
    });

    const result = await resolver.resolvePlaylist(playlistUrl);

    expect(result.tracks.map((track) => track.spotifyId)).toEqual([
      "duplicate",
      "valid-2",
    ]);
    expect(result.tracks[0]?.name).toBe("first");
  });

  it("normalizes the live Embed sparse-track shape without inventing fields", async () => {
    const liveShape = [
      {
        uri: "spotify:track:live-track",
        title: "A current Embed track",
        subtitle: "Artist",
        duration: 180_000,
        isPlayable: true,
      },
    ];
    const resolver = new SpotifyEmbedPlaylistResolver({
      fetch: async () =>
        response(embedHtml(embedPayload(playlistEntity(liveShape)))),
    });

    const result = await resolver.resolvePlaylist(playlistUrl);

    expect(result.tracks).toEqual([
      {
        spotifyId: "live-track",
        name: "A current Embed track",
        artistNames: ["Artist"],
        durationMs: 180_000,
      },
    ]);
    expect(result.sourceTruncated).toBe(false);
  });

  it("bounds the returned source sample at 200 positions", async () => {
    const tracks = Array.from(
      { length: MAX_SOURCE_TRACK_POSITIONS + 1 },
      (_, index) => completeTrack("track-" + index),
    );
    const resolver = new SpotifyEmbedPlaylistResolver({
      fetch: async () => response(embedHtml(embedPayload(playlistEntity(tracks)))),
    });

    const result = await resolver.resolvePlaylist(playlistUrl);

    expect(result.tracks).toHaveLength(MAX_SOURCE_TRACK_POSITIONS);
    expect(result.sourceTruncated).toBe(true);
  });

  it("maps HTTP failures to stable provider categories", async () => {
    const cases: Array<[number, PublicPlaylistResolverError["kind"]]> = [
      [401, "private"],
      [403, "private"],
      [404, "not_found"],
      [429, "rate_limited"],
      [500, "unavailable"],
      [400, "invalid_response"],
    ];

    for (const [status, kind] of cases) {
      const resolver = new SpotifyEmbedPlaylistResolver({
        fetch: async () => response("provider-secret-body", status),
      });

      await expect(resolver.resolvePlaylist(playlistUrl)).rejects.toMatchObject({
        name: "PublicPlaylistResolverError",
        kind,
      });
    }
  });

  it("rejects missing, duplicate, malformed, unexpected, and mismatched payloads", async () => {
    const validJson = embedHtml(embedPayload(playlistEntity([])))
      .replace('<script id="__NEXT_DATA__" type="application/json">', "")
      .replace("</script>", "");
    const invalidHtml = [
      "<html></html>",
      '<script id="__NEXT_DATA__" type="application/json">{not-json}</script>',
      '<script id="__NEXT_DATA__" type="application/json">{"props":{}}</script>',
      '<script id="__NEXT_DATA__" type="application/json">' +
        validJson +
        '</script><script id="__NEXT_DATA__" type="application/json">{}</script>',
      embedHtml(embedPayload(playlistEntity([], { id: "other-playlist" }))),
      embedHtml(embedPayload(playlistEntity([], { trackList: "not-array" }))),
      '<script id="__NEXT_DATA__">{"props":{}}</script>',
    ];

    for (const html of invalidHtml) {
      const resolver = new SpotifyEmbedPlaylistResolver({
        fetch: async () => response(html),
      });

      await expect(resolver.resolvePlaylist(playlistUrl)).rejects.toMatchObject({
        kind: "invalid_response",
      });
    }
  });

  it("returns an empty valid source when all exposed positions are unplayable", async () => {
    const resolver = new SpotifyEmbedPlaylistResolver({
      fetch: async () => response(embedHtml(embedPayload(playlistEntity([])))),
    });

    await expect(resolver.resolvePlaylist(playlistUrl)).resolves.toMatchObject({
      spotifyId: "playlist-1",
      tracks: [],
      sourceTruncated: false,
    });
  });

  it("bounds HTML and embedded JSON independently", async () => {
    const oversized = new SpotifyEmbedPlaylistResolver({
      maxHtmlBytes: 16,
      fetch: async () => response("<!doctype html>too-large-body"),
    });
    await expect(oversized.resolvePlaylist(playlistUrl)).rejects.toMatchObject({
      kind: "invalid_response",
    });

    const oversizedNextData = new SpotifyEmbedPlaylistResolver({
      maxNextDataBytes: 32,
      fetch: async () =>
        response(embedHtml(embedPayload(playlistEntity([])))),
    });
    await expect(
      oversizedNextData.resolvePlaylist(playlistUrl),
    ).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("decodes safe HTML entities inside the JSON script", async () => {
    const payload = embedPayload(
      playlistEntity([], { name: "A &amp; B" }),
    );
    const resolver = new SpotifyEmbedPlaylistResolver({
      fetch: async () => response(embedHtml(payload)),
    });

    const result = await resolver.resolvePlaylist(playlistUrl);

    expect(result.name).toBe("A & B");
  });

  it("rejects arbitrary input targets and never follows redirects", async () => {
    const fetchMock = vi.fn(async () => response(embedFixture));
    const resolver = new SpotifyEmbedPlaylistResolver({ fetch: fetchMock });

    await expect(
      resolver.resolvePlaylist("https://evil.example/playlist/playlist-1"),
    ).rejects.toMatchObject({ kind: "invalid_input" });
    expect(fetchMock).not.toHaveBeenCalled();

    const redirectResolver = new SpotifyEmbedPlaylistResolver({
      fetch: async (_input, init) => {
        expect(init?.redirect).toBe("error");
        throw new Error("redirect target should not be followed");
      },
    });
    await expect(
      redirectResolver.resolvePlaylist(playlistUrl),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("aborts slow requests at the configured timeout", async () => {
    let aborted = false;
    const resolver = new SpotifyEmbedPlaylistResolver({
      timeoutMs: 1,
      fetch: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("provider timeout body"));
          });
        }),
    });

    await expect(resolver.resolvePlaylist(playlistUrl)).rejects.toMatchObject({
      kind: "unavailable",
    });
    expect(aborted).toBe(true);
  });

  it("enforces the timeout even when an injected fetch ignores abort", async () => {
    const resolver = new SpotifyEmbedPlaylistResolver({
      timeoutMs: 5,
      fetch: async () => new Promise<Response>(() => undefined),
    });

    await expect(resolver.resolvePlaylist(playlistUrl)).rejects.toMatchObject({
      kind: "unavailable",
    });
  });

  it("sanitizes network errors and never exposes response bodies", async () => {
    const resolver = new SpotifyEmbedPlaylistResolver({
      fetch: async () => {
        throw new Error("provider body, token, and secret");
      },
    });
    const error = await getRejectedError(resolver.resolvePlaylist(playlistUrl));

    expect(error).toBeInstanceOf(PublicPlaylistResolverError);
    expect(String(error)).not.toContain("provider body");
    expect(String(error)).not.toContain("token");
  });
});
