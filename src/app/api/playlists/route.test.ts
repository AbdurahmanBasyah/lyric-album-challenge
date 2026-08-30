import { afterEach, describe, expect, it, vi } from "vitest";

const { cookiesMock } = vi.hoisted(() => ({ cookiesMock: vi.fn() }));

vi.mock("next/headers", () => ({ cookies: cookiesMock }));

import { GET as getPlaylists } from "./route";
import { AUTH_SESSION_COOKIE_NAME, encryptSession } from "../../../lib/auth/session";
import {
  SAVED_PLAYLISTS_PAGE_SIZE,
  UNTITLED_PLAYLIST_NAME,
} from "../../../lib/spotify/playlists";

const sessionSecret = "unit-test-session-secret-with-at-least-32-chars";
const serverEnvironment = {
  SPOTIFY_CLIENT_ID: "client-id",
  SPOTIFY_CLIENT_SECRET: "client-secret",
  SPOTIFY_REDIRECT_URI:
    "http://127.0.0.1:3000/api/auth/spotify/callback",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
  AUTH_SESSION_SECRET: sessionSecret,
} as const;

const environmentNames = [
  "SPOTIFY_CLIENT_ID",
  "SPOTIFY_CLIENT_SECRET",
  "SPOTIFY_REDIRECT_URI",
  "NEXT_PUBLIC_APP_URL",
  "AUTH_SESSION_SECRET",
] as const;

function saveEnvironment(): Record<string, string | undefined> {
  return Object.fromEntries(
    environmentNames.map((name) => [name, process.env[name]]),
  );
}

function setEnvironment(): void {
  for (const name of environmentNames) {
    process.env[name] = serverEnvironment[name];
  }
}

function restoreEnvironment(
  previous: Record<string, string | undefined>,
): void {
  for (const name of environmentNames) {
    const value = previous[name];

    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}

function setNodeEnvironment(value: string): string | undefined {
  const mutableEnvironment = process.env as Record<string, string | undefined>;
  const previous = mutableEnvironment.NODE_ENV;
  mutableEnvironment.NODE_ENV = value;
  return previous;
}

function restoreNodeEnvironment(previous: string | undefined): void {
  const mutableEnvironment = process.env as Record<string, string | undefined>;

  if (previous === undefined) {
    delete mutableEnvironment.NODE_ENV;
  } else {
    mutableEnvironment.NODE_ENV = previous;
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function playlistsPayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    href: "https://api.spotify.com/v1/me/playlists?offset=0&limit=24",
    limit: SAVED_PLAYLISTS_PAGE_SIZE,
    next: null,
    offset: 0,
    previous: null,
    total: 1,
    items: [
      {
        id: "playlist-1",
        name: "Playlist One",
        images: [],
        owner: { display_name: "Owner One" },
        public: true,
        items: { total: 4 },
        tracks: { total: 4 },
      },
    ],
    ...overrides,
  };
}

function playlistItem(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "playlist-1",
    name: "Playlist One",
    images: [],
    owner: { display_name: "Owner One" },
    public: true,
    items: { total: 4 },
    ...overrides,
  };
}

function sessionCookie(
  expiresAt = Date.now() + 60 * 60 * 1000,
  accessToken = "server-access-token",
  refreshToken = "server-refresh-token",
): string {
  return encryptSession(
    {
      accessToken,
      refreshToken,
      expiresAt,
    },
    sessionSecret,
  );
}

afterEach(() => {
  cookiesMock.mockReset();
  vi.restoreAllMocks();
});

describe("GET /api/playlists", () => {
  it("requires an encrypted auth session and returns a no-store neutral error", async () => {
    const previous = saveEnvironment();
    setEnvironment();
    cookiesMock.mockResolvedValue({ get: vi.fn() });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    try {
      const response = await getPlaylists(
        new Request("http://127.0.0.1:3000/api/playlists"),
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: "SPOTIFY_AUTH_REQUIRED",
      });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
      restoreEnvironment(previous);
    }
  });

  it("loads a page through the server session without exposing session values", async () => {
    const previous = saveEnvironment();
    setEnvironment();
    cookiesMock.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === AUTH_SESSION_COOKIE_NAME
          ? { value: sessionCookie() }
          : undefined,
      ),
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(playlistsPayload()));

    try {
      const response = await getPlaylists(
        new Request("http://127.0.0.1:3000/api/playlists?cursor=0"),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        items: [
          {
            spotifyId: "playlist-1",
            name: "Playlist One",
            ownerName: "Owner One",
            imageUrl: null,
            totalItems: 4,
            itemsAvailable: true,
            isPublic: true,
            spotifyUrl: "https://open.spotify.com/playlist/playlist-1",
          },
        ],
        nextCursor: null,
      });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(JSON.stringify(body)).not.toContain("server-access-token");
      expect(JSON.stringify(body)).not.toContain("server-refresh-token");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [input, init] = fetchMock.mock.calls[0] ?? [];
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer server-access-token",
      );
      expect(String(input)).not.toContain("server-access-token");
    } finally {
      fetchMock.mockRestore();
      restoreEnvironment(previous);
    }
  });

  it("returns HTTP 200 and an app-owned fallback for an empty playlist name", async () => {
    const previous = saveEnvironment();
    setEnvironment();
    cookiesMock.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === AUTH_SESSION_COOKIE_NAME
          ? { value: sessionCookie() }
          : undefined,
      ),
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        playlistsPayload({
          items: [
            {
              id: "empty-name",
              name: "   ",
              images: [],
              owner: { display_name: "Owner One" },
              public: true,
              items: { total: 4 },
            },
          ],
        }),
      ),
    );

    try {
      const response = await getPlaylists(
        new Request("http://127.0.0.1:3000/api/playlists"),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        items: [
          {
            spotifyId: "empty-name",
            name: UNTITLED_PLAYLIST_NAME,
            ownerName: "Owner One",
            imageUrl: null,
            totalItems: 4,
            itemsAvailable: true,
            isPublic: true,
            spotifyUrl: "https://open.spotify.com/playlist/empty-name",
          },
        ],
        nextCursor: null,
      });
    } finally {
      fetchMock.mockRestore();
      restoreEnvironment(previous);
    }
  });

  it("serves current playlist metadata variants that previously became 502", async () => {
    const previous = saveEnvironment();
    setEnvironment();
    cookiesMock.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === AUTH_SESSION_COOKIE_NAME
          ? { value: sessionCookie() }
          : undefined,
      ),
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        playlistsPayload({
          next: "https://api.spotify.com/v1/me/playlists?limit=24",
          items: [
            null,
            {
              id: "playlist-no-cover",
              name: "Playlist Without Cover",
              images: [{}],
              owner: { display_name: null },
              public: null,
              items: { total: 0 },
            },
          ],
        }),
      ),
    );

    try {
      const response = await getPlaylists(
        new Request("http://127.0.0.1:3000/api/playlists"),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        items: [
          {
            spotifyId: "playlist-no-cover",
            name: "Playlist Without Cover",
            ownerName: null,
            imageUrl: null,
            totalItems: 0,
            itemsAvailable: true,
            isPublic: null,
            spotifyUrl:
              "https://open.spotify.com/playlist/playlist-no-cover",
          },
        ],
        nextCursor: "2",
      });
      expect(response.headers.get("cache-control")).toBe("no-store");
    } finally {
      fetchMock.mockRestore();
      restoreEnvironment(previous);
    }
  });

  it("returns metadata-only playlists as visible but unavailable sources", async () => {
    const previous = saveEnvironment();
    setEnvironment();
    cookiesMock.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === AUTH_SESSION_COOKIE_NAME
          ? { value: sessionCookie() }
          : undefined,
      ),
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        playlistsPayload({
          items: [
            {
              id: "metadata-only",
              name: "Metadata Only",
              images: [],
              owner: { display_name: "Owner One" },
              public: true,
            },
          ],
        }),
      ),
    );

    try {
      const response = await getPlaylists(
        new Request("http://127.0.0.1:3000/api/playlists"),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        items: [
          {
            spotifyId: "metadata-only",
            name: "Metadata Only",
            ownerName: "Owner One",
            imageUrl: null,
            totalItems: null,
            itemsAvailable: false,
            isPublic: true,
            spotifyUrl: "https://open.spotify.com/playlist/metadata-only",
          },
        ],
        nextCursor: null,
      });
      expect(response.headers.get("cache-control")).toBe("no-store");
    } finally {
      fetchMock.mockRestore();
      restoreEnvironment(previous);
    }
  });

  it("keeps malformed provider pagination as a neutral 502", async () => {
    const previous = saveEnvironment();
    setEnvironment();
    cookiesMock.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === AUTH_SESSION_COOKIE_NAME
          ? { value: sessionCookie() }
          : undefined,
      ),
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(playlistsPayload({ next: "not-a-url" })),
    );

    try {
      const response = await getPlaylists(
        new Request("http://127.0.0.1:3000/api/playlists"),
      );

      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({
        error: "SPOTIFY_UNAVAILABLE",
      });
      expect(response.headers.get("cache-control")).toBe("no-store");
    } finally {
      fetchMock.mockRestore();
      restoreEnvironment(previous);
    }
  });

  it("adds a fixed development diagnostic for a collapsed provider failure", async () => {
    const previous = saveEnvironment();
    const previousNodeEnv = setNodeEnvironment("development");
    setEnvironment();
    cookiesMock.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === AUTH_SESSION_COOKIE_NAME
          ? { value: sessionCookie() }
          : undefined,
      ),
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ provider_secret: "must-not-leak" }, 503),
    );

    try {
      const response = await getPlaylists(
        new Request("http://127.0.0.1:3000/api/playlists"),
      );

      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({
        error: "SPOTIFY_UNAVAILABLE",
      });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-fillthelyrics-diagnostic")).toBe(
        "provider_http_status:503",
      );
      expect(response.headers.get("x-fillthelyrics-diagnostic")).not.toContain(
        "provider_secret",
      );
    } finally {
      fetchMock.mockRestore();
      restoreNodeEnvironment(previousNodeEnv);
      restoreEnvironment(previous);
    }
  });

  it("adds only the allowlisted schema field fingerprint in development", async () => {
    const previous = saveEnvironment();
    const previousNodeEnv = setNodeEnvironment("development");
    setEnvironment();
    cookiesMock.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === AUTH_SESSION_COOKIE_NAME
          ? { value: sessionCookie() }
          : undefined,
      ),
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        playlistsPayload({
          items: [
            playlistItem({
              id: "playlist/provider-secret-id",
              name: "provider-secret-name",
            }),
          ],
        }),
      ),
    );

    try {
      const response = await getPlaylists(
        new Request("http://127.0.0.1:3000/api/playlists"),
      );

      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({
        error: "SPOTIFY_UNAVAILABLE",
      });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-fillthelyrics-diagnostic")).toBe(
        "invalid_response_schema:playlist_id_invalid",
      );
      expect(response.headers.get("x-fillthelyrics-diagnostic")).not.toContain(
        "provider-secret",
      );
      expect(response.headers.get("x-fillthelyrics-diagnostic")).not.toContain(
        "0",
      );
    } finally {
      fetchMock.mockRestore();
      restoreNodeEnvironment(previousNodeEnv);
      restoreEnvironment(previous);
    }
  });

  it("omits schema diagnostic details from production responses", async () => {
    const previous = saveEnvironment();
    const previousNodeEnv = setNodeEnvironment("production");
    setEnvironment();
    cookiesMock.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === AUTH_SESSION_COOKIE_NAME
          ? { value: sessionCookie() }
          : undefined,
      ),
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        playlistsPayload({
          items: [playlistItem({ id: "playlist/provider-secret-id" })],
        }),
      ),
    );

    try {
      const response = await getPlaylists(
        new Request("http://127.0.0.1:3000/api/playlists"),
      );

      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({
        error: "SPOTIFY_UNAVAILABLE",
      });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-fillthelyrics-diagnostic")).toBeNull();
    } finally {
      fetchMock.mockRestore();
      restoreNodeEnvironment(previousNodeEnv);
      restoreEnvironment(previous);
    }
  });

  it("keeps the diagnostic header out of production responses", async () => {
    const previous = saveEnvironment();
    const previousNodeEnv = setNodeEnvironment("production");
    setEnvironment();
    cookiesMock.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === AUTH_SESSION_COOKIE_NAME
          ? { value: sessionCookie() }
          : undefined,
      ),
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ provider_secret: "must-not-leak" }, 503),
    );

    try {
      const response = await getPlaylists(
        new Request("http://127.0.0.1:3000/api/playlists"),
      );

      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({
        error: "SPOTIFY_UNAVAILABLE",
      });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-fillthelyrics-diagnostic")).toBeNull();
    } finally {
      fetchMock.mockRestore();
      restoreNodeEnvironment(previousNodeEnv);
      restoreEnvironment(previous);
    }
  });

  it("maps missing playlist scopes distinctly and preserves the auth session", async () => {
    const previous = saveEnvironment();
    setEnvironment();
    const encodedSession = sessionCookie();
    cookiesMock.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === AUTH_SESSION_COOKIE_NAME
          ? { value: encodedSession }
          : undefined,
      ),
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ provider_secret: "must-not-leak" }, 403));

    try {
      const response = await getPlaylists(
        new Request("http://127.0.0.1:3000/api/playlists"),
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "SPOTIFY_SCOPE_REQUIRED",
      });
      expect(response.cookies.get(AUTH_SESSION_COOKIE_NAME)).toBeUndefined();
    } finally {
      fetchMock.mockRestore();
      restoreEnvironment(previous);
    }
  });

  it("clears a session after a provider auth failure", async () => {
    const previous = saveEnvironment();
    setEnvironment();
    cookiesMock.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === AUTH_SESSION_COOKIE_NAME
          ? { value: sessionCookie() }
          : undefined,
      ),
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({}, 401));

    try {
      const response = await getPlaylists(
        new Request("http://127.0.0.1:3000/api/playlists"),
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: "SPOTIFY_AUTH_REQUIRED",
      });
      expect(response.cookies.get(AUTH_SESSION_COOKIE_NAME)?.value).toBe("");
    } finally {
      fetchMock.mockRestore();
      restoreEnvironment(previous);
    }
  });

  it("persists a refreshed encrypted session without returning tokens", async () => {
    const previous = saveEnvironment();
    setEnvironment();
    cookiesMock.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === AUTH_SESSION_COOKIE_NAME
          ? { value: sessionCookie(Date.now() + 1_000) }
          : undefined,
      ),
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) => {
        if (String(input) === "https://accounts.spotify.com/api/token") {
          return jsonResponse({
            access_token: "refreshed-access-token",
            token_type: "Bearer",
            expires_in: 3600,
            refresh_token: "refreshed-refresh-token",
          });
        }

        return jsonResponse(playlistsPayload());
      },
    );

    try {
      const response = await getPlaylists(
        new Request("http://127.0.0.1:3000/api/playlists"),
      );

      expect(response.status).toBe(200);
      expect(response.cookies.get(AUTH_SESSION_COOKIE_NAME)?.value).toBeTruthy();
      expect(response.headers.get("set-cookie")).not.toContain(
        "refreshed-access-token",
      );
      expect(response.headers.get("set-cookie")).not.toContain(
        "refreshed-refresh-token",
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      fetchMock.mockRestore();
      restoreEnvironment(previous);
    }
  });

  it("rejects duplicate or invalid cursors before reading auth state", async () => {
    cookiesMock.mockResolvedValue({ get: vi.fn() });

    const duplicateResponse = await getPlaylists(
      new Request(
        "http://127.0.0.1:3000/api/playlists?cursor=0&cursor=24",
      ),
    );
    const invalidResponse = await getPlaylists(
      new Request("http://127.0.0.1:3000/api/playlists?cursor=not-valid"),
    );

    expect(duplicateResponse.status).toBe(400);
    expect(await duplicateResponse.json()).toEqual({
      error: "INVALID_CURSOR",
    });
    expect(invalidResponse.status).toBe(400);
    expect(await invalidResponse.json()).toEqual({
      error: "INVALID_CURSOR",
    });
    expect(cookiesMock).not.toHaveBeenCalled();
  });

  it("returns an empty page safely", async () => {
    const previous = saveEnvironment();
    setEnvironment();
    cookiesMock.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === AUTH_SESSION_COOKIE_NAME
          ? { value: sessionCookie() }
          : undefined,
      ),
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        jsonResponse(playlistsPayload({ items: [], total: 0 })),
      );

    try {
      const response = await getPlaylists(
        new Request("http://127.0.0.1:3000/api/playlists"),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ items: [], nextCursor: null });
    } finally {
      fetchMock.mockRestore();
      restoreEnvironment(previous);
    }
  });
});
