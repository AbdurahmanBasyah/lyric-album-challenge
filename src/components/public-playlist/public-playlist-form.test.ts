import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { canonicalizePublicPlaylistInput } from "../challenge/challenge-api";

const formSource = readFileSync(
  resolve(
    process.cwd(),
    "src/components/public-playlist/public-playlist-form.tsx",
  ),
  "utf8",
);

describe("public playlist import form", () => {
  it("accepts a canonical link and strips share metadata", () => {
    expect(
      canonicalizePublicPlaylistInput(
        " https://open.spotify.com/playlist/playlist_123/?si=share#section ",
      ),
    ).toBe("https://open.spotify.com/playlist/playlist_123");
  });

  it("rejects non-canonical provider and non-playlist links", () => {
    for (const value of [
      "https://spotify.link/playlist_123",
      "spotify:playlist:playlist_123",
      "http://open.spotify.com/playlist/playlist_123",
      "https://open.spotify.com/album/album_123",
      "https://example.test/playlist/playlist_123",
    ]) {
      expect(canonicalizePublicPlaylistInput(value)).toBeNull();
    }
  });

  it("keeps the primary flow same-origin, accessible, and provider-neutral", () => {
    expect(formSource).toContain("createChallengeIntroUrl");
    expect(formSource).not.toContain("createPublicPlaylistChallenge");
    expect(formSource).toContain('aria-live="polite"');
    expect(formSource).toContain('role="status"');
    expect(formSource).toContain('aria-describedby=');
    expect(formSource).toContain('aria-invalid={hasError}');
    expect(formSource).toContain("onPaste");
    expect(formSource).toContain("useReducedMotion");
    expect(formSource).toContain('kind: "public-playlist"');
    expect(formSource).toContain("Opening challenge setup");
  });

  it("guards duplicate submits and routes only a validated source context", () => {
    expect(formSource).toMatch(/phase === "navigating"/);
    expect(formSource).toContain("router.replace(createChallengeIntroUrl(source))");
    expect(formSource).toContain("canonicalUrl.lastIndexOf");
    expect(formSource).toContain('type="url"');
    expect(formSource).toContain('type="submit"');
    expect(formSource).toContain("required");
  });
});
