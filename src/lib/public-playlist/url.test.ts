import { describe, expect, it } from "vitest";

import {
  PublicPlaylistUrlError,
  canonicalizePublicPlaylistUrl,
  parsePublicPlaylistUrl,
  tryParsePublicPlaylistUrl,
} from "./url";

describe("public playlist URL parser", () => {
  it("canonicalizes whitespace, query/hash, and trailing slash", () => {
    expect(
      parsePublicPlaylistUrl(
        "  https://open.spotify.com/playlist/37i9dQZF1DX0XUsuxWHRQd/?si=abc#fragment  ",
      ),
    ).toEqual({
      playlistId: "37i9dQZF1DX0XUsuxWHRQd",
      canonicalUrl:
        "https://open.spotify.com/playlist/37i9dQZF1DX0XUsuxWHRQd",
    });
  });

  it("accepts the narrow locale prefix and removes it canonically", () => {
    expect(
      canonicalizePublicPlaylistUrl(
        "https://open.spotify.com/intl-en/playlist/playlist-1",
      ),
    ).toEqual({
      playlistId: "playlist-1",
      canonicalUrl: "https://open.spotify.com/playlist/playlist-1",
    });
  });

  it.each([
    "",
    "not a url",
    "http://open.spotify.com/playlist/playlist-1",
    "https://open.spotify.com/album/album-1",
    "https://open.spotify.com/playlist/playlist-1/extra",
    "https://open.spotify.com//playlist/playlist-1",
    "https://open.spotify.com/playlist/../playlist/playlist-1",
    "https://open.spotify.com/playlist/",
    "https://open.spotify.com/playlist/id%2Fother",
    "https://open.spotify.com.evil/playlist/playlist-1",
    "https://open.spotify.com:443/playlist/playlist-1",
    "https://spotify.link/playlist-1",
    "spotify:playlist:playlist-1",
    "https://user:password@open.spotify.com/playlist/playlist-1",
    "https://open.spotify.com:444/playlist/playlist-1",
  ])("rejects unsupported URL %s", (value) => {
    expect(() => parsePublicPlaylistUrl(value)).toThrow(PublicPlaylistUrlError);
    expect(tryParsePublicPlaylistUrl(value)).toBeNull();
  });

  it("does not return provider URLs or arbitrary identities", () => {
    expect(() =>
      parsePublicPlaylistUrl(
        "https://open.spotify.com/playlist/playlist-1?redirect=https://evil.example",
      ),
    ).not.toThrow();
    expect(tryParsePublicPlaylistUrl(null)).toBeNull();
  });

  it("accepts a standard locale with a region", () => {
    expect(
      parsePublicPlaylistUrl(
        "https://open.spotify.com/intl-en-us/playlist/playlist-1",
      ).canonicalUrl,
    ).toBe("https://open.spotify.com/playlist/playlist-1");
  });
});
