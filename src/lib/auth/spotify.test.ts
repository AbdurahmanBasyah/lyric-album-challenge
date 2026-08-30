import { describe, expect, it, vi } from "vitest";

const { cookiesMock } = vi.hoisted(() => ({ cookiesMock: vi.fn() }));

vi.mock("next/headers", () => ({ cookies: cookiesMock }));

import {
  SPOTIFY_SCOPE,
  SPOTIFY_TOKEN_URL,
  SpotifyTokenError,
  buildSpotifyAuthorizationUrl,
  createOAuthState,
  exchangeAuthorizationCode,
  refreshAccessToken,
  statesMatch,
  type SpotifyFetch,
} from "./spotify";
import { AUTH_SESSION_COOKIE_NAME, OAUTH_STATE_COOKIE_NAME } from "./session";
import { GET as startSpotifyAuth } from "../../app/api/auth/spotify/route";
import { GET as spotifyCallback } from "../../app/api/auth/spotify/callback/route";
import { GET as authSessionStatus } from "../../app/api/auth/session/route";
import { POST as logout } from "../../app/api/auth/logout/route";
import { encryptSession } from "./session";

const environment = {
  SPOTIFY_CLIENT_ID: "client-id",
  SPOTIFY_CLIENT_SECRET: "client-secret",
  SPOTIFY_REDIRECT_URI:
    "http://127.0.0.1:3000/api/auth/spotify/callback",
} as const;

const now = 1_700_000_000_000;

const serverEnvironment = {
  SPOTIFY_CLIENT_ID: environment.SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET: environment.SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REDIRECT_URI: environment.SPOTIFY_REDIRECT_URI,
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
  AUTH_SESSION_SECRET: "unit-test-session-secret-with-at-least-32-chars",
} as const;

const serverEnvironmentNames = [
  "SPOTIFY_CLIENT_ID",
  "SPOTIFY_CLIENT_SECRET",
  "SPOTIFY_REDIRECT_URI",
  "NEXT_PUBLIC_APP_URL",
  "AUTH_SESSION_SECRET",
] as const;

function saveServerEnvironment(): Record<string, string | undefined> {
  return Object.fromEntries(
    serverEnvironmentNames.map((name) => [name, process.env[name]]),
  );
}

function setServerEnvironment(): void {
  for (const name of serverEnvironmentNames) {
    process.env[name] = serverEnvironment[name];
  }
}

function restoreServerEnvironment(previous: Record<string, string | undefined>): void {
  for (const name of serverEnvironmentNames) {
    const value = previous[name];

    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}

function tokenResponse(
  overrides: Record<string, unknown> = {},
): Response {
  return new Response(
    JSON.stringify({
      access_token: "access-token",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "refresh-token",
      scope: SPOTIFY_SCOPE,
      ...overrides,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

function errorResponse(status = 400): Response {
  return new Response(JSON.stringify({ error: "invalid_grant" }), { status });
}

describe("Spotify authorization", () => {
  it("builds an authorization URL with the exact required scope", () => {
    const state = "cryptographic-state";
    const url = buildSpotifyAuthorizationUrl(environment, state);

    expect(url.origin + url.pathname).toBe(
      "https://accounts.spotify.com/authorize",
    );
    expect(url.searchParams.get("client_id")).toBe(environment.SPOTIFY_CLIENT_ID);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(
      environment.SPOTIFY_REDIRECT_URI,
    );
    expect(url.searchParams.get("state")).toBe(state);
    expect(url.searchParams.getAll("scope")).toEqual([SPOTIFY_SCOPE]);
    expect(SPOTIFY_SCOPE).toBe(
      "user-library-read playlist-read-private playlist-read-collaborative",
    );
    expect(url.searchParams.get("show_dialog")).toBeNull();
  });

  it("adds the provider dialog only for the explicit re-consent option", () => {
    const state = "cryptographic-state";
    const reauthorizeUrl = buildSpotifyAuthorizationUrl(environment, state, {
      showDialog: true,
    });
    const regularUrl = buildSpotifyAuthorizationUrl(environment, state, {
      showDialog: false,
    });

    expect(reauthorizeUrl.searchParams.get("show_dialog")).toBe("true");
    expect(regularUrl.searchParams.get("show_dialog")).toBeNull();
  });

  it("generates high-entropy state values and rejects missing or mismatched state", () => {
    const first = createOAuthState();
    const second = createOAuthState();

    expect(first).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(second).not.toBe(first);
    expect(statesMatch(first, first)).toBe(true);
    expect(statesMatch(first, second)).toBe(false);
    expect(statesMatch(first, undefined)).toBe(false);
    expect(statesMatch(undefined, first)).toBe(false);
  });
});

describe("Spotify token exchange", () => {
  it("sends a form-encoded authorization-code request with Basic auth", async () => {
    let capturedInput: string | URL | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchMock: SpotifyFetch = async (input, init) => {
      capturedInput = input;
      capturedInit = init;
      return tokenResponse();
    };

    const result = await exchangeAuthorizationCode("authorization-code", environment, {
      fetch: fetchMock,
      now: () => now,
    });

    expect(capturedInput).toBe(SPOTIFY_TOKEN_URL);
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.headers).toEqual({
      Authorization: `Basic ${Buffer.from(
        `${environment.SPOTIFY_CLIENT_ID}:${environment.SPOTIFY_CLIENT_SECRET}`,
      ).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    });

    const body = new URLSearchParams(capturedInit?.body as URLSearchParams);
    expect(Object.fromEntries(body.entries())).toEqual({
      grant_type: "authorization_code",
      code: "authorization-code",
      redirect_uri: environment.SPOTIFY_REDIRECT_URI,
    });
    expect(result).toEqual({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: now + 3_600_000,
      scope: SPOTIFY_SCOPE,
    });
  });

  it("rejects malformed token responses without exposing provider data", async () => {
    const secret = environment.SPOTIFY_CLIENT_SECRET;
    const fetchMock: SpotifyFetch = async () =>
      new Response(JSON.stringify({ access_token: secret }), { status: 200 });

    await expect(
      exchangeAuthorizationCode("authorization-code", environment, {
        fetch: fetchMock,
      }),
    ).rejects.toMatchObject({ name: "SpotifyTokenError" });
  });

  it("rejects provider errors without echoing raw error bodies or credentials", async () => {
    const fetchMock: SpotifyFetch = async () => errorResponse();

    await expect(
      exchangeAuthorizationCode("authorization-code", environment, {
        fetch: fetchMock,
      }),
    ).rejects.toEqual(new SpotifyTokenError("exchange"));
  });

  it("requires a refresh token in the initial authorization response", async () => {
    const fetchMock: SpotifyFetch = async () =>
      tokenResponse({ refresh_token: undefined });

    await expect(
      exchangeAuthorizationCode("authorization-code", environment, {
        fetch: fetchMock,
      }),
    ).rejects.toEqual(new SpotifyTokenError("exchange"));
  });
});

describe("Spotify token refresh", () => {
  it("retains the existing refresh token when Spotify omits a replacement", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchMock: SpotifyFetch = async (_input, init) => {
      capturedInit = init;
      return tokenResponse({ refresh_token: undefined, expires_in: 1800 });
    };

    const result = await refreshAccessToken("old-refresh-token", environment, {
      fetch: fetchMock,
      now: () => now,
    });

    const body = new URLSearchParams(capturedInit?.body as URLSearchParams);
    expect(Object.fromEntries(body.entries())).toEqual({
      grant_type: "refresh_token",
      refresh_token: "old-refresh-token",
    });
    expect(result.refreshToken).toBe("old-refresh-token");
    expect(result.expiresAt).toBe(now + 1_800_000);
  });

  it("uses a replacement refresh token when Spotify provides one", async () => {
    const fetchMock: SpotifyFetch = async () =>
      tokenResponse({ refresh_token: "new-refresh-token" });

    const result = await refreshAccessToken("old-refresh-token", environment, {
      fetch: fetchMock,
      now: () => now,
    });

    expect(result.refreshToken).toBe("new-refresh-token");
  });

  it("rejects an invalid or revoked refresh grant", async () => {
    const fetchMock: SpotifyFetch = async () => errorResponse(400);

    await expect(
      refreshAccessToken("revoked-refresh-token", environment, {
        fetch: fetchMock,
      }),
    ).rejects.toEqual(new SpotifyTokenError("refresh"));
  });
});

describe("Spotify auth route handlers", () => {
  it("redirects to Spotify and stores state in a short-lived HTTP-only cookie", () => {
    const previous = saveServerEnvironment();
    setServerEnvironment();

    try {
      const response = startSpotifyAuth();
      const location = response.headers.get("location");
      const stateCookie = response.cookies.get(OAUTH_STATE_COOKIE_NAME);

      expect(response.status).toBe(307);
      expect(location).toContain("https://accounts.spotify.com/authorize");
      expect(new URL(location ?? "").searchParams.get("scope")).toBe(
        SPOTIFY_SCOPE,
      );
      expect(stateCookie?.value).toMatch(/^[A-Za-z0-9_-]{40,}$/);
      expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    } finally {
      restoreServerEnvironment(previous);
    }
  });

  it("forces Spotify's consent dialog only for reauthorize=1", () => {
    const previous = saveServerEnvironment();
    setServerEnvironment();

    try {
      const reauthorizeResponse = startSpotifyAuth(
        new Request(
          "http://127.0.0.1:3000/api/auth/spotify?reauthorize=1",
        ),
      );
      const reauthorizeLocation = reauthorizeResponse.headers.get("location");
      expect(
        new URL(reauthorizeLocation ?? "").searchParams.get("show_dialog"),
      ).toBe("true");
      expect(reauthorizeLocation).not.toContain("reauthorize");

      const ordinaryResponse = startSpotifyAuth(
        new Request(
          "http://127.0.0.1:3000/api/auth/spotify?reauthorize=true",
        ),
      );
      const ordinaryLocation = ordinaryResponse.headers.get("location");
      expect(
        new URL(ordinaryLocation ?? "").searchParams.get("show_dialog"),
      ).toBeNull();

      const duplicateResponse = startSpotifyAuth(
        new Request(
          "http://127.0.0.1:3000/api/auth/spotify?reauthorize=1&reauthorize=0",
        ),
      );
      const duplicateLocation = duplicateResponse.headers.get("location");
      expect(
        new URL(duplicateLocation ?? "").searchParams.get("show_dialog"),
      ).toBeNull();
    } finally {
      restoreServerEnvironment(previous);
    }
  });

  it("exchanges a valid callback and clears the one-time state cookie", async () => {
    const previous = saveServerEnvironment();
    const state = "callback-state-value";
    const cookieStore = { get: vi.fn(() => ({ value: state })) };
    cookiesMock.mockResolvedValue(cookieStore);
    setServerEnvironment();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(tokenResponse());

    try {
      const response = await spotifyCallback(
        new Request(
          `http://127.0.0.1:3000/api/auth/spotify/callback?code=authorization-code&state=${state}`,
        ),
      );
      const location = response.headers.get("location");
      const sessionCookie = response.cookies.get(AUTH_SESSION_COOKIE_NAME);
      const clearedState = response.cookies.get(OAUTH_STATE_COOKIE_NAME);

      expect(response.status).toBe(307);
      expect(location).toBe("http://127.0.0.1:3000/?auth=success");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sessionCookie?.value).toBeTruthy();
      expect(sessionCookie?.value).not.toContain("access-token");
      expect(sessionCookie?.value).not.toContain("refresh-token");
      expect(clearedState?.value).toBe("");
    } finally {
      fetchMock.mockRestore();
      restoreServerEnvironment(previous);
    }
  });

  it("rejects callback state mismatch before code exchange and still consumes state", async () => {
    const previous = saveServerEnvironment();
    const cookieStore = { get: vi.fn(() => ({ value: "expected-state" })) };
    cookiesMock.mockResolvedValue(cookieStore);
    setServerEnvironment();
    const fetchMock = vi.spyOn(globalThis, "fetch");

    try {
      const response = await spotifyCallback(
        new Request(
          "http://127.0.0.1:3000/api/auth/spotify/callback?code=authorization-code&state=wrong-state",
        ),
      );
      const location = response.headers.get("location");

      expect(response.status).toBe(307);
      expect(location).toBe(
        "http://127.0.0.1:3000/?auth=error&reason=invalid_state",
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(response.cookies.get(OAUTH_STATE_COOKIE_NAME)?.value).toBe("");
    } finally {
      fetchMock.mockRestore();
      restoreServerEnvironment(previous);
    }
  });

  it("refreshes a near-expiry session server-side without returning tokens", async () => {
    const previous = saveServerEnvironment();
    setServerEnvironment();
    const encodedSession = encryptSession(
      {
        accessToken: "old-access-token",
        refreshToken: "old-refresh-token",
        expiresAt: Date.now() + 1_000,
      },
      serverEnvironment.AUTH_SESSION_SECRET,
    );
    cookiesMock.mockResolvedValue({
      get: vi.fn(() => ({ value: encodedSession })),
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      tokenResponse({ access_token: "new-access-token" }),
    );

    try {
      const response = await authSessionStatus();
      const body = await response.json();

      expect(body).toEqual({ authenticated: true });
      expect(JSON.stringify(body)).not.toContain("access-token");
      expect(JSON.stringify(body)).not.toContain("refresh-token");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(response.cookies.get(AUTH_SESSION_COOKIE_NAME)?.value).toBeTruthy();
    } finally {
      fetchMock.mockRestore();
      restoreServerEnvironment(previous);
    }
  });

  it("makes logout idempotent and clears both auth cookies", async () => {
    const previous = saveServerEnvironment();
    setServerEnvironment();
    cookiesMock.mockResolvedValue({ get: vi.fn() });

    try {
      const response = await logout();
      const body = await response.json();

      expect(body).toEqual({ authenticated: false });
      expect(response.cookies.get(AUTH_SESSION_COOKIE_NAME)?.value).toBe("");
      expect(response.cookies.get(OAUTH_STATE_COOKIE_NAME)?.value).toBe("");
    } finally {
      restoreServerEnvironment(previous);
    }
  });
});
