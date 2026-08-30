import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { PlaylistSummary } from "@/types/playlists";

import {
    appendPlaylists,
    createPlaylistsRequestUrl,
    getPlaylistsErrorCopy,
    mapPlaylistsError,
    parsePlaylistsErrorCode,
    parsePlaylistsResponse,
    SPOTIFY_REAUTHORIZE_ROUTE,
} from "./playlist-picker";

const playlistPickerSource = readFileSync(
    resolve(process.cwd(), "src/components/playlists/playlist-picker.tsx"),
    "utf8",
);

const firstPlaylist: PlaylistSummary = {
    spotifyId: "playlist-1",
    name: "Morning set",
    ownerName: "A listener",
    imageUrl: "https://images.example/playlist-1.jpg",
    totalItems: 18,
    itemsAvailable: true,
    isPublic: true,
    spotifyUrl: "https://open.spotify.com/playlist/playlist-1",
};

const secondPlaylist: PlaylistSummary = {
    spotifyId: "playlist-2",
    name: "Late night",
    ownerName: null,
    imageUrl: null,
    totalItems: 1,
    itemsAvailable: true,
    isPublic: null,
    spotifyUrl: "https://open.spotify.com/playlist/playlist-2?si=example",
};

const metadataOnlyPlaylist: PlaylistSummary = {
    spotifyId: "playlist-metadata-only",
    name: "Followed playlist",
    ownerName: "Another listener",
    imageUrl: "https://images.example/playlist-metadata-only.jpg",
    totalItems: null,
    itemsAvailable: false,
    isPublic: true,
    spotifyUrl:
        "https://open.spotify.com/playlist/playlist-metadata-only",
};

describe("parsePlaylistsResponse", () => {
    it("accepts the provider-neutral page shape and preserves the cursor", () => {
        expect(
            parsePlaylistsResponse({
                items: [firstPlaylist, secondPlaylist],
                nextCursor: "24",
            }),
        ).toEqual({
            items: [firstPlaylist, secondPlaylist],
            nextCursor: "24",
        });
    });

    it("accepts an empty page with no next cursor", () => {
        expect(parsePlaylistsResponse({ items: [], nextCursor: null })).toEqual({
            items: [],
            nextCursor: null,
        });
    });

    it("accepts a mixed page with known and metadata-only item availability", () => {
        expect(
            parsePlaylistsResponse({
                items: [firstPlaylist, metadataOnlyPlaylist],
                nextCursor: null,
            }),
        ).toEqual({
            items: [firstPlaylist, metadataOnlyPlaylist],
            nextCursor: null,
        });
    });

    it("keeps a known zero count selectable", () => {
        const zeroItemsPlaylist = {
            ...firstPlaylist,
            spotifyId: "playlist-empty",
            name: "Empty playlist",
            totalItems: 0,
            itemsAvailable: true,
        } satisfies PlaylistSummary;

        expect(
            parsePlaylistsResponse({
                items: [zeroItemsPlaylist],
                nextCursor: null,
            }),
        ).toEqual({
            items: [zeroItemsPlaylist],
            nextCursor: null,
        });
    });

    it("rejects malformed, unsafe, or provider-shaped payloads", () => {
        expect(
            parsePlaylistsResponse({
                items: [{ ...firstPlaylist, totalItems: "18" }],
                nextCursor: null,
            }),
        ).toBeNull();
        expect(
            parsePlaylistsResponse({
                items: [
                    {
                        id: "provider-playlist-1",
                        name: firstPlaylist.name,
                        owner: { display_name: "A listener" },
                        tracks: { total: firstPlaylist.totalItems },
                    },
                ],
                nextCursor: null,
            }),
        ).toBeNull();
        expect(
            parsePlaylistsResponse({
                items: [{ ...firstPlaylist, itemsAvailable: "yes" }],
                nextCursor: null,
            }),
        ).toBeNull();
        expect(
            parsePlaylistsResponse({
                items: [{ ...metadataOnlyPlaylist, totalItems: 0 }],
                nextCursor: null,
            }),
        ).toBeNull();
        expect(
            parsePlaylistsResponse({
                items: [{ ...firstPlaylist, totalItems: Number.MAX_SAFE_INTEGER + 1 }],
                nextCursor: null,
            }),
        ).toBeNull();
        expect(
            parsePlaylistsResponse({
                items: [{ ...firstPlaylist, spotifyUrl: "javascript:alert(1)" }],
                nextCursor: null,
            }),
        ).toBeNull();
        expect(
            parsePlaylistsResponse({ items: [firstPlaylist], nextCursor: 24 }),
        ).toBeNull();
    });
});

describe("playlist request and page helpers", () => {
    it("does not add a cursor to the first request and round-trips an opaque cursor", () => {
        expect(createPlaylistsRequestUrl(null)).toBe("/api/playlists");
        const requestUrl = createPlaylistsRequestUrl("cursor / with spaces");
        expect(
            new URL(requestUrl, "https://app.example").searchParams.get("cursor"),
        ).toBe("cursor / with spaces");
    });

    it("accumulates pages without duplicating stable playlist IDs", () => {
        expect(appendPlaylists([firstPlaylist], [firstPlaylist, secondPlaylist])).toEqual(
            [firstPlaylist, secondPlaylist],
        );
    });
});

describe("playlist error mapping", () => {
    it("keeps missing scopes distinct from authentication and rate limits", () => {
        expect(
            mapPlaylistsError(401, { error: "SPOTIFY_AUTH_REQUIRED" }),
        ).toBe("unauthenticated");
        expect(
            mapPlaylistsError(403, { error: "SPOTIFY_SCOPE_REQUIRED" }),
        ).toBe("scope-required");
        expect(
            mapPlaylistsError(429, { error: "SPOTIFY_RATE_LIMITED" }),
        ).toBe("rate-limited");
        expect(mapPlaylistsError(502, { error: "SPOTIFY_UNAVAILABLE" })).toBe(
            "unavailable",
        );
        expect(mapPlaylistsError(500, { error: "SPOTIFY_UNAVAILABLE" })).toBe(
            "unavailable",
        );
        expect(parsePlaylistsErrorCode({ error: "access_token" })).toBeNull();
    });

    it("provides a retry state for unavailable Spotify without a misleading reconnect", () => {
        const unavailableCopy = getPlaylistsErrorCopy("unavailable");

        expect(unavailableCopy.heading).toContain("couldn't load");
        expect(unavailableCopy.detail).toContain("Try again");
        expect(unavailableCopy.detail).not.toContain("scope");
        expect(unavailableCopy.detail).not.toContain("SPOTIFY_UNAVAILABLE");
        expect(playlistPickerSource).toContain('status === "unavailable"');
        expect(playlistPickerSource).toContain("Try again");
    });

    it("provides a reconnect route and copy without echoing provider codes", () => {
        expect(SPOTIFY_REAUTHORIZE_ROUTE).toBe(
            "/api/auth/spotify?reauthorize=1",
        );
        expect(getPlaylistsErrorCopy("scope-required").heading).toContain(
            "Reconnect Spotify",
        );
        expect(getPlaylistsErrorCopy("scope-required").detail).not.toContain(
            "SPOTIFY_SCOPE_REQUIRED",
        );
    });
});

describe("playlist picker motion, selection, and link accessibility", () => {
    it("keeps cards visible before motion hydration", () => {
        expect(playlistPickerSource).toMatch(/initial=\{\{\s*opacity:\s*1\b/);
        expect(playlistPickerSource).not.toMatch(
            /initial=\{\{[^}]*opacity:\s*0\b/,
        );
    });

    it("uses same-origin no-store fetching and accessible external links", () => {
        expect(playlistPickerSource).toContain('credentials: "same-origin"');
        expect(playlistPickerSource).toContain('cache: "no-store"');
        expect(playlistPickerSource).toContain('aria-pressed={selected}');
        expect(playlistPickerSource).toContain('target="_blank"');
        expect(playlistPickerSource).toContain('rel="noopener noreferrer"');
        expect(playlistPickerSource).toContain(
            "aria-label={`Open ${playlist.name} on Spotify",
        );
        expect(playlistPickerSource).not.toContain(
            'fetch("https://api.spotify.com',
        );
    });

    it("keeps unknown counts truthful and makes metadata-only cards unavailable", () => {
        expect(playlistPickerSource).toContain(
            'return "Track details unavailable"',
        );
        expect(playlistPickerSource).toContain("itemsAvailable");
        expect(playlistPickerSource).toContain(
            "disabled={!playlist.itemsAvailable}",
        );
        expect(playlistPickerSource).toContain(
            "aria-disabled={!playlist.itemsAvailable}",
        );
        expect(playlistPickerSource).toContain(
            "disabled:cursor-not-allowed disabled:opacity-70",
        );
        expect(playlistPickerSource).toContain(
            "This playlist must be owned or collaborative",
        );
        expect(playlistPickerSource).toContain(
            "playlist.itemsAvailable ? undefined : availabilityHintId",
        );
        expect(playlistPickerSource).toContain(
            "playlist.itemsAvailable\n                                    }",
        );
        expect(playlistPickerSource).not.toContain(
            "Track details unavailable` : `${totalItems}",
        );
    });

    it("renders the scope-required reconnect CTA", () => {
        expect(playlistPickerSource).toContain(
            "href={SPOTIFY_REAUTHORIZE_ROUTE}",
        );
        expect(playlistPickerSource).toContain("Reconnect Spotify");
    });
});
