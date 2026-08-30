import { z } from "zod";

import type { SpotifyFetch } from "../auth/spotify";
import {
  fetchWithRetry,
  type RetryClock,
  type RetrySleep,
} from "../http/retry";
import type { SavedAlbumsPage } from "../../types/albums";

export const SPOTIFY_SAVED_ALBUMS_URL =
  "https://api.spotify.com/v1/me/albums";

/**
 * A deliberately small page keeps the picker responsive and bounds the
 * amount of provider data held by one request. Spotify currently accepts a
 * maximum limit of 50 for this endpoint.
 */
export const SAVED_ALBUMS_PAGE_SIZE = 24;
const MAX_SAFE_OFFSET = Number.MAX_SAFE_INTEGER;

export type SpotifyAlbumsErrorKind =
  | "auth"
  | "rate_limited"
  | "unavailable"
  | "invalid_cursor";

/**
 * Provider errors are intentionally reduced to categories. In particular,
 * no provider response body is retained on this error.
 */
export class SpotifyAlbumsError extends Error {
  readonly kind: SpotifyAlbumsErrorKind;

  constructor(kind: SpotifyAlbumsErrorKind) {
    super(
      kind === "invalid_cursor"
        ? "Spotify albums cursor is invalid."
        : "Spotify albums request failed.",
    );
    this.name = "SpotifyAlbumsError";
    this.kind = kind;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type SpotifyAlbumsRequestDependencies = Readonly<{
  fetch?: SpotifyFetch;
  sleep?: RetrySleep;
  now?: RetryClock;
}>;

const spotifyArtistSchema = z
  .object({
    name: z.string().trim().min(1),
  })
  .passthrough();

const spotifyImageSchema = z
  .object({
    url: z.string().trim().url(),
  })
  .passthrough();

const spotifyAlbumSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    artists: z.array(spotifyArtistSchema).min(1),
    images: z.array(spotifyImageSchema),
    total_tracks: z.number().int().nonnegative(),
  })
  .passthrough();

const spotifySavedAlbumItemSchema = z
  .object({
    album: spotifyAlbumSchema,
  })
  .passthrough();

const spotifySavedAlbumsResponseSchema = z
  .object({
    items: z.array(spotifySavedAlbumItemSchema),
    limit: z.number().int().min(1).max(50),
    next: z.string().trim().min(1).nullable(),
    offset: z
      .number()
      .int()
      .nonnegative()
      .refine(Number.isSafeInteger),
    total: z
      .number()
      .int()
      .nonnegative()
      .refine(Number.isSafeInteger),
  })
  .passthrough();

type SpotifySavedAlbumsResponse = z.infer<
  typeof spotifySavedAlbumsResponseSchema
>;

/**
 * Parses the application's opaque offset cursor. The browser only receives
 * this decimal value; provider pagination URLs never cross this boundary.
 */
export function parseOffsetCursor(cursor?: string): number {
  if (
    typeof cursor !== "string" &&
    cursor !== undefined
  ) {
    throw new SpotifyAlbumsError("invalid_cursor");
  }

  if (cursor === undefined) {
    return 0;
  }

  // Canonical decimal form avoids ambiguous values such as signs, fractions,
  // whitespace, and alternate encodings of the same offset.
  if (!/^(?:0|[1-9]\d*)$/.test(cursor)) {
    throw new SpotifyAlbumsError("invalid_cursor");
  }

  const offset = Number(cursor);

  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > MAX_SAFE_OFFSET
  ) {
    throw new SpotifyAlbumsError("invalid_cursor");
  }

  return offset;
}

export function buildSavedAlbumsUrl(cursor?: string): URL {
  const offset = parseOffsetCursor(cursor);
  const url = new URL(SPOTIFY_SAVED_ALBUMS_URL);
  url.searchParams.set("limit", String(SAVED_ALBUMS_PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  return url;
}

function mapAlbumItem(item: SpotifySavedAlbumsResponse["items"][number]) {
  const album = item.album;

  return {
    spotifyId: album.id,
    name: album.name,
    artistNames: album.artists.map((artist) => artist.name),
    imageUrl: album.images[0]?.url ?? null,
    totalTracks: album.total_tracks,
  };
}

function classifyProviderResponse(response: Response): SpotifyAlbumsErrorKind {
  if (response.status === 401) {
    return "auth";
  }

  if (response.status === 429) {
    return "rate_limited";
  }

  return "unavailable";
}

function getNextCursor(page: SpotifySavedAlbumsResponse): string | null {
  if (page.next === null) {
    return null;
  }

  // Spotify's `next` URL is provider-owned and never leaves this adapter. If
  // it contains an offset, use that authoritative value; the item count is a
  // safe fallback for test doubles or future provider URL variants.
  let nextOffset = page.offset + page.items.length;

  let providerNextUrl: URL;

  try {
    providerNextUrl = new URL(page.next);
  } catch {
    // The response schema already requires a non-empty next value. A
    // provider URL that cannot be parsed falls back to the local offset.
    return Number.isSafeInteger(nextOffset) && nextOffset >= 0
      ? String(nextOffset)
      : null;
  }

  const providerOffset = providerNextUrl.searchParams.get("offset");

  if (providerOffset !== null) {
    try {
      nextOffset = parseOffsetCursor(providerOffset);
    } catch {
      throw new SpotifyAlbumsError("unavailable");
    }
  }

  return Number.isSafeInteger(nextOffset) && nextOffset >= 0
    ? String(nextOffset)
    : null;
}

/**
 * Fetches one page of the current user's saved albums. The access token is a
 * server-held argument and is used only to construct the outbound bearer
 * header. The returned value contains only application-owned album fields.
 */
export async function getSavedAlbums(
  accessToken: string,
  cursor?: string,
  dependencies: SpotifyAlbumsRequestDependencies = {},
): Promise<SavedAlbumsPage> {
  if (typeof accessToken !== "string" || accessToken.trim().length === 0) {
    throw new SpotifyAlbumsError("auth");
  }

  const url = buildSavedAlbumsUrl(cursor);
  let response: Response;

  try {
    response = await fetchWithRetry(
      url.toString(),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        fetch: dependencies.fetch,
        sleep: dependencies.sleep,
        now: dependencies.now,
      },
    );
  } catch {
    throw new SpotifyAlbumsError("unavailable");
  }

  if (!response.ok) {
    throw new SpotifyAlbumsError(classifyProviderResponse(response));
  }

  let rawResponse: unknown;

  try {
    rawResponse = await response.json();
  } catch {
    throw new SpotifyAlbumsError("unavailable");
  }

  const parsed = spotifySavedAlbumsResponseSchema.safeParse(rawResponse);

  if (!parsed.success) {
    throw new SpotifyAlbumsError("unavailable");
  }

  const page = parsed.data;

  return {
    items: page.items.map(mapAlbumItem),
    nextCursor: getNextCursor(page),
  };
}
