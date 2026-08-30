import { afterEach, describe, expect, it, vi } from "vitest";

const { cookiesMock } = vi.hoisted(() => ({ cookiesMock: vi.fn() }));

vi.mock("next/headers", () => ({ cookies: cookiesMock }));

import { GET as getAlbums } from "../../app/api/albums/route";
import {
  SAVED_ALBUMS_PAGE_SIZE,
  SpotifyAlbumsError,
  buildSavedAlbumsUrl,
  getSavedAlbums,
  parseOffsetCursor,
  type SpotifyAlbumsRequestDependencies,
} from "./albums";
import type { SpotifyFetch } from "../auth/spotify";
import {
  AUTH_SESSION_COOKIE_NAME,
  encryptSession,
} from "../auth/session";

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

function albumsPayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    href: "https://api.spotify.com/v1/me/albums?offset=0&limit=24",
    limit: SAVED_ALBUMS_PAGE_SIZE,
    next: "https://api.spotify.com/v1/me/albums?offset=24&limit=24",
    offset: 0,
    previous: null,
    total: 25,
    items: [
      {
        added_at: "2026-01-01T00:00:00Z",
        album: {
          id: "album-1",
          name: " Album One ",
          artists: [{ id: "artist-1", name: " Artist One " }],
          images: [
            { height: 640, width: 640, url: "https://images.example/one.jpg" },
            { height: 300, width: 300, url: "https://images.example/one-small.jpg" },
          ],
          total_tracks: 12,
        },
      },
    ],
    ...overrides,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sessionCookie(expiresAt = Date.now() + 60 * 60 * 1000): string {
  return encryptSession(
    {
      accessToken: "server-access-token",
      refreshToken: "server-refresh-token",
      expiresAt,
    },
    sessionSecret,
  );
}

afterEach(() => {
  cookiesMock.mockReset();
  vi.restoreAllMocks();
});

describe("Spotify saved albums adapter", () => {
  it("maps only AlbumSummary fields, sends a bearer token, and returns an offset cursor", async () => {
    let requestInput: string | URL | undefined;
    let requestInit: RequestInit | undefined;
    const fetchMock: SpotifyFetch = async (input, init) => {
      requestInput = input;
      requestInit = init;
      return jsonResponse(albumsPayload());
    };
    const dependencies: SpotifyAlbumsRequestDependencies = { fetch: fetchMock };

    const page = await getSavedAlbums("access-token", undefined, dependencies);

    expect(page).toEqual({
      items: [
        {
          spotifyId: "album-1",
          name: "Album One",
          artistNames: ["Artist One"],
          imageUrl: "https://images.example/one.jpg",
          totalTracks: 12,
        },
      ],
      nextCursor: "24",
    });
    expect(new URL(String(requestInput)).pathname).toBe("/v1/me/albums");
    expect(new URL(String(requestInput)).searchParams.get("limit")).toBe(
      String(SAVED_ALBUMS_PAGE_SIZE),
    );
    expect(new URL(String(requestInput)).searchParams.get("offset")).toBe("0");
    expect(new URL(String(requestInput)).searchParams.get("access_token")).toBe(
      null,
    );
    expect(new Headers(requestInit?.headers).get("authorization")).toBe(
      "Bearer access-token",
    );
    expect(JSON.stringify(page)).not.toContain("added_at");
  });

  it("uses a supplied offset cursor and maps a page with no provider next URL", async () => {
    let requestInput: string | URL | undefined;
    const fetchMock: SpotifyFetch = async (input) => {
      requestInput = input;
      return jsonResponse(
        albumsPayload({
          next: null,
          offset: 24,
          total: 25,
        }),
      );
    };

    const page = await getSavedAlbums("access-token", "24", {
      fetch: fetchMock,
    });

    expect(page.nextCursor).toBeNull();
    expect(new URL(String(requestInput)).searchParams.get("offset")).toBe("24");
  });

  it("retries a transient provider response through the injected sleep seam", async () => {
    const fetchMock = vi
      .fn<SpotifyFetch>()
      .mockResolvedValueOnce(jsonResponse({ provider_secret: "ignored" }, 503))
      .mockResolvedValueOnce(
        jsonResponse(albumsPayload({ next: null, total: 1 })),
      );
    const sleep = vi.fn(async () => undefined);

    const page = await getSavedAlbums("access-token", undefined, {
      fetch: fetchMock,
      sleep,
    });

    expect(page.nextCursor).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it("rejects malformed cursors without making a provider request", async () => {
    const requests: Array<string | URL> = [];
    const fetchMock: SpotifyFetch = async (input) => {
      requests.push(input);
      return jsonResponse(albumsPayload());
    };

    for (const cursor of ["", "-1", "01", "1.5", "not-an-offset", "9007199254740992"]) {
      await expect(
        getSavedAlbums("access-token", cursor, { fetch: fetchMock }),
      ).rejects.toEqual(new SpotifyAlbumsError("invalid_cursor"));
    }

    expect(requests).toHaveLength(0);
    expect(parseOffsetCursor(undefined)).toBe(0);
    expect(parseOffsetCursor("24")).toBe(24);
    expect(buildSavedAlbumsUrl("24").searchParams.get("offset")).toBe("24");
  });

  it("turns malformed payloads, rate limits, auth failures, and network errors into neutral errors", async () => {
    await expect(
      getSavedAlbums("access-token", undefined, {
        fetch: async () => jsonResponse({ items: [] }),
      }),
    ).rejects.toEqual(new SpotifyAlbumsError("unavailable"));

    await expect(
      getSavedAlbums("access-token", undefined, {
        fetch: async () => jsonResponse({ provider_secret: "must-not-leak" }, 401),
      }),
    ).rejects.toEqual(new SpotifyAlbumsError("auth"));

    await expect(
      getSavedAlbums("access-token", undefined, {
        fetch: async () => jsonResponse({ provider_secret: "must-not-leak" }, 429),
      }),
    ).rejects.toEqual(new SpotifyAlbumsError("rate_limited"));

    await expect(
      getSavedAlbums("access-token", undefined, {
        fetch: async () => {
          throw new Error("provider-secret-network-detail");
        },
      }),
    ).rejects.toEqual(new SpotifyAlbumsError("unavailable"));
  });
});

describe("GET /api/albums", () => {
  it("requires an encrypted auth session and keeps the response provider-neutral", async () => {
    const previous = saveEnvironment();
    setEnvironment();
    cookiesMock.mockResolvedValue({ get: vi.fn() });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    try {
      const response = await getAlbums(
        new Request("http://127.0.0.1:3000/api/albums"),
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "SPOTIFY_AUTH_REQUIRED" });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
      restoreEnvironment(previous);
    }
  });

  it("loads albums through the server session, and never returns session values", async () => {
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
      .mockResolvedValue(jsonResponse(albumsPayload({ next: null, total: 1 })));

    try {
      const response = await getAlbums(
        new Request("http://127.0.0.1:3000/api/albums?cursor=0"),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        items: [
          {
            spotifyId: "album-1",
            name: "Album One",
            artistNames: ["Artist One"],
            imageUrl: "https://images.example/one.jpg",
            totalTracks: 12,
          },
        ],
        nextCursor: null,
      });
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

  it("refreshes a near-expiry encrypted session and stores only a new encrypted cookie", async () => {
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

        return jsonResponse(albumsPayload({ next: null, total: 1 }));
      },
    );

    try {
      const response = await getAlbums(
        new Request("http://127.0.0.1:3000/api/albums"),
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

  it("rejects invalid cursors before reading auth state", async () => {
    cookiesMock.mockResolvedValue({ get: vi.fn() });

    const response = await getAlbums(
      new Request("http://127.0.0.1:3000/api/albums?cursor=not-valid"),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_CURSOR" });
    expect(cookiesMock).not.toHaveBeenCalled();
  });
});
