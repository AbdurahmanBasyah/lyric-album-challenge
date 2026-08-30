import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
    parseSessionState,
    readCallbackFeedback,
} from "./spotify-auth-panel";

const spotifyAuthPanelSource = readFileSync(
    resolve(process.cwd(), "src/components/auth/spotify-auth-panel.tsx"),
    "utf8",
);

describe("readCallbackFeedback", () => {
    it("accepts local success markers and removes callback params", () => {
        expect(readCallbackFeedback("?auth=success&reason=ignored&view=landing")).toEqual({
            kind: "success",
            message: "Spotify connection completed.",
            cleanedSearch: "?view=landing",
        });
    });

    it("maps provider failures to a generic message without echoing reason", () => {
        const result = readCallbackFeedback(
            "?auth=error&reason=authorization_code_secret_value",
        );

        expect(result).toEqual({
            kind: "error",
            message: "We couldn't connect to Spotify. Please try again.",
            cleanedSearch: "",
        });
        expect(result?.message).not.toContain("authorization_code_secret_value");
    });

    it("ignores unrelated or unsupported markers", () => {
        expect(readCallbackFeedback("?reason=invalid_state")).toBeNull();
        expect(readCallbackFeedback("?auth=cancelled&reason=provider")).toBeNull();
    });
});

describe("parseSessionState", () => {
    it("accepts only the public authenticated boolean", () => {
        expect(parseSessionState({ authenticated: true })).toBe("authenticated");
        expect(parseSessionState({ authenticated: false })).toBe("anonymous");
    });

    it("does not expose or depend on token-shaped fields", () => {
        expect(
            parseSessionState({
                authenticated: true,
                access_token: "access-secret",
                refresh_token: "refresh-secret",
            }),
        ).toBe("authenticated");
        expect(parseSessionState({ access_token: "access-secret" })).toBeNull();
        expect(parseSessionState({ authenticated: "true" })).toBeNull();
        expect(parseSessionState(null)).toBeNull();
    });
});

describe("authenticated library entry point", () => {
    it("exposes a same-origin saved-library link", () => {
        expect(spotifyAuthPanelSource).toMatch(
            /href=["']\/albums["'][\s\S]*Choose a saved album or playlist/,
        );
        expect(spotifyAuthPanelSource).toContain(
            "Spotify connected. Your saved albums and playlists are ready.",
        );
    });
});
