import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { AlbumSummary } from "@/types/albums";

import {
    appendAlbums,
    createAlbumsRequestUrl,
    getAlbumsErrorCopy,
    mapAlbumsError,
    parseAlbumsErrorCode,
    parseAlbumsResponse,
} from "./album-picker";

const albumPickerSource = readFileSync(
    resolve(process.cwd(), "src/components/albums/album-picker.tsx"),
    "utf8",
);

const firstAlbum: AlbumSummary = {
    spotifyId: "album-1",
    name: "First album",
    artistNames: ["A band"],
    imageUrl: "https://images.example/album-1.jpg",
    totalTracks: 10,
};

const secondAlbum: AlbumSummary = {
    spotifyId: "album-2",
    name: "Second album",
    artistNames: ["Another band", "Guest"],
    imageUrl: null,
    totalTracks: 1,
};

describe("parseAlbumsResponse", () => {
    it("accepts the provider-neutral page shape and preserves the cursor", () => {
        expect(
            parseAlbumsResponse({
                items: [firstAlbum, secondAlbum],
                nextCursor: "opaque-offset-24",
            }),
        ).toEqual({
            items: [firstAlbum, secondAlbum],
            nextCursor: "opaque-offset-24",
        });
    });

    it("accepts an empty page with no next cursor", () => {
        expect(parseAlbumsResponse({ items: [], nextCursor: null })).toEqual({
            items: [],
            nextCursor: null,
        });
    });

    it("rejects malformed or provider-shaped payloads", () => {
        expect(
            parseAlbumsResponse({
                items: [{ ...firstAlbum, totalTracks: "10" }],
                nextCursor: null,
            }),
        ).toBeNull();
        expect(
            parseAlbumsResponse({
                items: [
                    {
                        id: "provider-album-1",
                        name: firstAlbum.name,
                        artists: [{ name: "A band" }],
                        images: [{ url: firstAlbum.imageUrl }],
                        tracks: { total: firstAlbum.totalTracks },
                    },
                ],
                nextCursor: null,
            }),
        ).toBeNull();
        expect(
            parseAlbumsResponse({ items: [firstAlbum], nextCursor: 24 }),
        ).toBeNull();
    });
});

describe("album request and page helpers", () => {
    it("does not add a cursor to the first request and round-trips an opaque cursor", () => {
        expect(createAlbumsRequestUrl(null)).toBe("/api/albums");
        const requestUrl = createAlbumsRequestUrl("cursor / with spaces");
        expect(new URL(requestUrl, "https://app.example").searchParams.get("cursor")).toBe(
            "cursor / with spaces",
        );
    });

    it("accumulates pages without duplicating stable album IDs", () => {
        expect(appendAlbums([firstAlbum], [firstAlbum, secondAlbum])).toEqual([
            firstAlbum,
            secondAlbum,
        ]);
    });
});

describe("album error mapping", () => {
    it("maps auth and rate-limit responses without exposing provider fields", () => {
        expect(mapAlbumsError(401, { error: "SPOTIFY_AUTH_REQUIRED" })).toBe(
            "unauthenticated",
        );
        expect(mapAlbumsError(429, { error: "SPOTIFY_RATE_LIMITED" })).toBe(
            "rate-limited",
        );
        expect(mapAlbumsError(502, { error: "SPOTIFY_UNAVAILABLE" })).toBe(
            "error",
        );
        expect(parseAlbumsErrorCode({ error: "access_token" })).toBeNull();
        expect(getAlbumsErrorCopy("error").detail).not.toContain("SPOTIFY");
    });
});

describe("album picker motion and accessibility source", () => {
    it("keeps cards visible before motion hydration", () => {
        expect(albumPickerSource).toMatch(/initial=\{\{\s*opacity:\s*1\b/);
        expect(albumPickerSource).not.toMatch(/initial=\{\{[^}]*opacity:\s*0\b/);
    });

    it("includes an accessible selection state and same-origin API request", () => {
        expect(albumPickerSource).toContain('aria-pressed={selected}');
        expect(albumPickerSource).toContain('credentials: "same-origin"');
        expect(albumPickerSource).toContain('fetch(createAlbumsRequestUrl(cursor)');
    });
});
