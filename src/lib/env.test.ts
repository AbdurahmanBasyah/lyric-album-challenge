import { describe, expect, it } from "vitest";

import {
  EnvironmentConfigurationError,
  getServerEnvironment,
  parseEnvironment,
} from "./env";

const validEnvironment = {
  SPOTIFY_CLIENT_ID: "client-id",
  SPOTIFY_CLIENT_SECRET: "client-secret",
  SPOTIFY_REDIRECT_URI:
    "http://127.0.0.1:3000/api/auth/spotify/callback",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
  AUTH_SESSION_SECRET: "unit-test-session-secret-with-at-least-32-chars",
};

describe("parseEnvironment", () => {
  it("accepts a valid local setup", () => {
    expect(parseEnvironment(validEnvironment)).toEqual(validEnvironment);
  });

  it("accepts an HTTPS setup", () => {
    expect(
      parseEnvironment({
        ...validEnvironment,
        SPOTIFY_REDIRECT_URI: "https://fillthelyrics.example.com/api/auth/callback",
        NEXT_PUBLIC_APP_URL: "https://fillthelyrics.example.com",
      }),
    ).toEqual({
      ...validEnvironment,
      SPOTIFY_REDIRECT_URI: "https://fillthelyrics.example.com/api/auth/callback",
      NEXT_PUBLIC_APP_URL: "https://fillthelyrics.example.com",
    });
  });

  it("trims server values", () => {
    expect(
      parseEnvironment({
        SPOTIFY_CLIENT_ID: "  client-id  ",
        SPOTIFY_CLIENT_SECRET: "  client-secret  ",
        SPOTIFY_REDIRECT_URI:
          "  http://127.0.0.1:3000/api/auth/spotify/callback  ",
        NEXT_PUBLIC_APP_URL: "  http://127.0.0.1:3000  ",
        AUTH_SESSION_SECRET: `  ${validEnvironment.AUTH_SESSION_SECRET}  `,
      }),
    ).toEqual(validEnvironment);
  });

  it("accepts and trims the optional server-only YouTube API key", () => {
    expect(
      parseEnvironment({
        ...validEnvironment,
        YOUTUBE_API_KEY: "  youtube-key  ",
      }),
    ).toEqual({
      ...validEnvironment,
      YOUTUBE_API_KEY: "youtube-key",
    });

    expect(
      parseEnvironment({
        ...validEnvironment,
        YOUTUBE_API_KEY: "   ",
      }),
    ).toEqual(validEnvironment);
  });

  it.each([
    ["non-string", 42],
    ["control character", "youtube\nkey"],
    ["too long", "y".repeat(257)],
  ])("rejects an invalid optional YouTube API key (%s)", (_description, key) => {
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        YOUTUBE_API_KEY: key,
      }),
    ).toThrow(EnvironmentConfigurationError);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["whitespace-only", "   "],
  ])("rejects a %s client ID", (_description, clientId) => {
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        SPOTIFY_CLIENT_ID: clientId,
      }),
    ).toThrow(EnvironmentConfigurationError);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["whitespace-only", "   "],
  ])("rejects a %s client secret", (_description, clientSecret) => {
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        SPOTIFY_CLIENT_SECRET: clientSecret,
      }),
    ).toThrow(EnvironmentConfigurationError);
  });

  it.each([
    ["missing", undefined],
    ["weak", "too-short"],
    ["whitespace-only", "                                "],
  ])("rejects a %s session secret", (_description, sessionSecret) => {
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        AUTH_SESSION_SECRET: sessionSecret,
      }),
    ).toThrow(EnvironmentConfigurationError);
  });

  it.each([
    ["missing", undefined],
    ["malformed", "not-a-url"],
    ["localhost HTTP", "http://localhost:3000/api/auth/callback"],
    ["non-HTTP(S)", "ftp://127.0.0.1:3000/api/auth/callback"],
    ["query-bearing", "https://fillthelyrics.example.com/callback?code=1"],
  ])("rejects a %s Spotify redirect URI", (_description, redirectUri) => {
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        SPOTIFY_REDIRECT_URI: redirectUri,
      }),
    ).toThrow(EnvironmentConfigurationError);
  });

  it.each([
    ["missing", undefined],
    ["malformed", "not-a-url"],
    ["non-HTTP(S)", "ftp://fillthelyrics.example.com"],
  ])("rejects a %s app URL", (_description, appUrl) => {
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        NEXT_PUBLIC_APP_URL: appUrl,
      }),
    ).toThrow(EnvironmentConfigurationError);
  });

  it("rejects public names for server secrets", () => {
    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        NEXT_PUBLIC_SPOTIFY_CLIENT_SECRET: "must-not-be-public",
      }),
    ).toThrow(/NEXT_PUBLIC_SPOTIFY_CLIENT_SECRET/);

    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        NEXT_PUBLIC_AUTH_SESSION_SECRET: "must-not-be-public",
      }),
    ).toThrow(/NEXT_PUBLIC_AUTH_SESSION_SECRET/);

    expect(() =>
      parseEnvironment({
        ...validEnvironment,
        NEXT_PUBLIC_YOUTUBE_API_KEY: "must-not-be-public",
      }),
    ).toThrow(/NEXT_PUBLIC_YOUTUBE_API_KEY/);
  });

  it("names invalid fields without exposing their values", () => {
    const invalidClientSecret = "secret-value-that-must-not-appear";
    const invalidAppUrl = "not-a-url/private-value";

    try {
      parseEnvironment({
        ...validEnvironment,
        SPOTIFY_CLIENT_SECRET: invalidClientSecret,
        NEXT_PUBLIC_APP_URL: invalidAppUrl,
      });
      throw new Error("Expected environment parsing to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentConfigurationError);

      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("NEXT_PUBLIC_APP_URL");
      expect(message).not.toContain(invalidClientSecret);
      expect(message).not.toContain(invalidAppUrl);
    }
  });

  it("does not require real environment values at module import time", () => {
    expect(() => parseEnvironment(validEnvironment)).not.toThrow();
  });
});

describe("getServerEnvironment", () => {
  it("reads process.env only when called", () => {
    const names = [
      "SPOTIFY_CLIENT_ID",
      "SPOTIFY_CLIENT_SECRET",
      "SPOTIFY_REDIRECT_URI",
      "NEXT_PUBLIC_APP_URL",
      "AUTH_SESSION_SECRET",
      "YOUTUBE_API_KEY",
      "NEXT_PUBLIC_SPOTIFY_CLIENT_SECRET",
      "NEXT_PUBLIC_AUTH_SESSION_SECRET",
      "NEXT_PUBLIC_YOUTUBE_API_KEY",
    ] as const;
    const previous = Object.fromEntries(
      names.map((name) => [name, process.env[name]]),
    );

    process.env.SPOTIFY_CLIENT_ID = validEnvironment.SPOTIFY_CLIENT_ID;
    process.env.SPOTIFY_CLIENT_SECRET = validEnvironment.SPOTIFY_CLIENT_SECRET;
    process.env.SPOTIFY_REDIRECT_URI = validEnvironment.SPOTIFY_REDIRECT_URI;
    process.env.NEXT_PUBLIC_APP_URL = validEnvironment.NEXT_PUBLIC_APP_URL;
    process.env.AUTH_SESSION_SECRET = validEnvironment.AUTH_SESSION_SECRET;
    delete process.env.YOUTUBE_API_KEY;
    delete process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_SECRET;
    delete process.env.NEXT_PUBLIC_AUTH_SESSION_SECRET;
    delete process.env.NEXT_PUBLIC_YOUTUBE_API_KEY;

    try {
      expect(getServerEnvironment()).toEqual(validEnvironment);
    } finally {
      for (const name of names) {
        const value = previous[name];

        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
  });
});
