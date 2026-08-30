import { describe, expect, it } from "vitest";

import type { SpotifyFetch } from "../auth/spotify";
import {
  SPOTIFY_LIBRARY_CONTAINS_URL,
  SpotifyLibraryContainsError,
  buildLibraryContainsUrl,
  checkLibraryContains,
} from "./library-contains";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function rejectedError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the promise to reject.");
}

describe("Spotify library membership adapter", () => {
  it("builds the current library URI endpoint for albums and playlists", () => {
    expect(buildLibraryContainsUrl("album", "album-1").toString()).toBe(
      `${SPOTIFY_LIBRARY_CONTAINS_URL}?uris=spotify%3Aalbum%3Aalbum-1`,
    );
    expect(buildLibraryContainsUrl("playlist", "playlist_1").toString()).toBe(
      `${SPOTIFY_LIBRARY_CONTAINS_URL}?uris=spotify%3Aplaylist%3Aplaylist_1`,
    );
  });

  it("sends one encoded URI with GET, Accept, and a server-side bearer token", async () => {
    let requestInput: string | URL | undefined;
    let requestInit: RequestInit | undefined;
    const fetchMock: SpotifyFetch = async (input, init) => {
      requestInput = input;
      requestInit = init;
      return jsonResponse([true]);
    };

    await expect(
      checkLibraryContains(" access-token ", "album", " album-1 ", {
        fetch: fetchMock,
      }),
    ).resolves.toBe(true);

    const requestUrl = new URL(String(requestInput));
    expect(requestUrl.origin + requestUrl.pathname).toBe(
      SPOTIFY_LIBRARY_CONTAINS_URL,
    );
    expect(String(requestInput)).toContain("uris=spotify%3Aalbum%3Aalbum-1");
    expect(requestUrl.searchParams.get("uris")).toBe("spotify:album:album-1");
    expect(requestUrl.searchParams.get("access_token")).toBeNull();
    expect(requestInit?.method).toBe("GET");
    expect(requestInit?.body).toBeUndefined();
    expect(new Headers(requestInit?.headers).get("accept")).toBe(
      "application/json",
    );
    expect(new Headers(requestInit?.headers).get("authorization")).toBe(
      "Bearer access-token",
    );
  });

  it("supports the named request form and returns a false membership distinctly", async () => {
    let receivedKind: string | undefined;
    let receivedId: string | undefined;

    const result = await checkLibraryContains({
      accessToken: "access-token",
      kind: "playlist",
      spotifyId: " playlist-1 ",
      dependencies: {
        fetch: async (input) => {
          const uri = new URL(String(input)).searchParams.get("uris") ?? "";
          [, receivedKind, receivedId] = uri.split(":");
          return jsonResponse([false]);
        },
      },
    });

    expect(result).toBe(false);
    expect(receivedKind).toBe("playlist");
    expect(receivedId).toBe("playlist-1");
  });

  it("rejects invalid access tokens, kinds, and IDs before fetch", async () => {
    let requestCount = 0;
    const fetchMock: SpotifyFetch = async () => {
      requestCount += 1;
      return jsonResponse([true]);
    };

    for (const accessToken of ["", "   ", "token\nwith-control"]) {
      await expect(
        checkLibraryContains(accessToken, "album", "album-1", {
          fetch: fetchMock,
        }),
      ).rejects.toEqual(new SpotifyLibraryContainsError("invalid_input"));
    }

    for (const kind of ["track", "", undefined] as unknown[]) {
      await expect(
        checkLibraryContains({
          accessToken: "access-token",
          kind: kind as "album",
          spotifyId: "album-1",
          fetch: fetchMock,
        }),
      ).rejects.toEqual(new SpotifyLibraryContainsError("invalid_input"));
    }

    for (const spotifyId of [
      "",
      " ",
      "album/1",
      "album?1",
      "album#1",
      "spotify:album:album-1",
      "https://open.spotify.com/album/album-1",
      "album%2F1",
      "album 1",
    ]) {
      await expect(
        checkLibraryContains("access-token", "album", spotifyId, {
          fetch: fetchMock,
        }),
      ).rejects.toEqual(new SpotifyLibraryContainsError("invalid_input"));
    }

    expect(requestCount).toBe(0);
  });

  it("rejects ambiguous dependency forms without making a request", async () => {
    let requestCount = 0;
    const fetchMock: SpotifyFetch = async () => {
      requestCount += 1;
      return jsonResponse([true]);
    };

    await expect(
      checkLibraryContains({
        accessToken: "access-token",
        kind: "album",
        spotifyId: "album-1",
        fetch: fetchMock,
        dependencies: { fetch: fetchMock },
      }),
    ).rejects.toEqual(new SpotifyLibraryContainsError("invalid_input"));

    await expect(
      checkLibraryContains({
        accessToken: "access-token",
        kind: "album",
        spotifyId: "album-1",
        dependencies: { fetch: "not-a-function" as never },
      }),
    ).rejects.toEqual(new SpotifyLibraryContainsError("invalid_input"));

    expect(requestCount).toBe(0);
  });

  it("requires exactly one boolean in a successful provider response", async () => {
    const malformedResponses: unknown[] = [
      [],
      [true, false],
      ["true"],
      [1],
      [null],
      { contains: true },
      [true, "provider-secret"],
    ];

    for (const payload of malformedResponses) {
      const error = await rejectedError(
        checkLibraryContains("access-token", "album", "album-1", {
          fetch: async () => jsonResponse(payload),
        }),
      );

      expect(error).toEqual(new SpotifyLibraryContainsError("invalid_response"));
      expect(String(error)).not.toContain("provider-secret");
      expect(JSON.stringify(error)).not.toContain("provider-secret");
    }
  });

  it("maps provider statuses to stable typed categories", async () => {
    const cases = [
      [400, "invalid_response"],
      [401, "auth"],
      [403, "scope"],
      [429, "rate_limited"],
      [500, "unavailable"],
      [503, "unavailable"],
      [404, "unavailable"],
    ] as const;

    for (const [status, kind] of cases) {
      const providerSecret = "provider-body-secret";
      const error = await rejectedError(
        checkLibraryContains("access-token", "album", "album-1", {
          fetch: async () => jsonResponse({ providerSecret }, status),
        }),
      );

      expect(error).toEqual(new SpotifyLibraryContainsError(kind));
      expect(String(error)).not.toContain(providerSecret);
      expect(String(error)).not.toContain("api.spotify.com");
      expect(JSON.stringify(error)).not.toContain(providerSecret);
    }
  });

  it("maps network and JSON failures without retaining exception or provider details", async () => {
    const networkSecret = "network-provider-secret";

    const networkError = await rejectedError(
      checkLibraryContains("access-token", "playlist", "playlist-1", {
        fetch: async () => {
          throw new Error(networkSecret);
        },
      }),
    );
    expect(networkError).toEqual(new SpotifyLibraryContainsError("unavailable"));
    expect(String(networkError)).not.toContain(networkSecret);

    const invalidJsonError = await rejectedError(
      checkLibraryContains("access-token", "playlist", "playlist-1", {
        fetch: async () =>
          new Response(networkSecret, {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      }),
    );
    expect(invalidJsonError).toEqual(
      new SpotifyLibraryContainsError("invalid_response"),
    );
    expect(String(invalidJsonError)).not.toContain(networkSecret);
  });

  it("does not mutate the named input or injected provider response", async () => {
    const payload = [true];
    const input = {
      accessToken: " access-token ",
      kind: "album" as const,
      spotifyId: " album-1 ",
    };
    const inputBefore = JSON.stringify(input);
    const payloadBefore = JSON.stringify(payload);

    await expect(
      checkLibraryContains({
        ...input,
        dependencies: {
          fetch: async () =>
            ({ ok: true, status: 200, json: async () => payload }) as Response,
        },
      }),
    ).resolves.toBe(true);

    expect(JSON.stringify(input)).toBe(inputBefore);
    expect(JSON.stringify(payload)).toBe(payloadBefore);
  });
});

