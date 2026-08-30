/**
 * The only playlist URL shape accepted by the anonymous import flow.
 *
 * This parser deliberately does not resolve arbitrary URLs.  The caller gets
 * a stable Spotify ID and a canonical, provider-independent URL; the resolver
 * constructs its own fixed upstream request from that ID.
 */
export const PUBLIC_PLAYLIST_HOST = "open.spotify.com";
export const PUBLIC_PLAYLIST_PROTOCOL = "https:";

const SPOTIFY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z]{2})?$/u;

export type PublicPlaylistIdentity = Readonly<{
  playlistId: string;
  canonicalUrl: string;
}>;

export class PublicPlaylistUrlError extends Error {
  readonly kind = "invalid_url" as const;

  constructor() {
    super("Public playlist URL is invalid.");
    this.name = "PublicPlaylistUrlError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function invalidUrl(): never {
  throw new PublicPlaylistUrlError();
}

/**
 * Parse one canonical public Spotify playlist URL.
 *
 * Leading/trailing whitespace is presentation noise and is trimmed.  Query
 * strings and fragments are ignored as Spotify share links commonly include
 * them.  The optional `/intl-{locale}` prefix is accepted only for a small
 * locale shape and is removed from the canonical output.
 */
export function parsePublicPlaylistUrl(value: unknown): PublicPlaylistIdentity {
  if (typeof value !== "string") {
    return invalidUrl();
  }

  const input = value.trim();

  if (input.length === 0 || input.length > 2048) {
    return invalidUrl();
  }

  let url: URL;

  try {
    url = new URL(input);
  } catch {
    return invalidUrl();
  }

  const authorityMatch = /^https:\/\/([^/?#]+)(?:[/?#]|$)/iu.exec(input);
  const authority = authorityMatch?.[1];

  // WHATWG URL normalizes an explicit default port away. Compare the raw
  // authority too so `:443`, userinfo, and alternate host spellings do not
  // become accepted as a different non-canonical identity.
  if (
    authority === undefined ||
    authority.toLowerCase() !== PUBLIC_PLAYLIST_HOST ||
    url.protocol !== PUBLIC_PLAYLIST_PROTOCOL ||
    url.hostname !== PUBLIC_PLAYLIST_HOST ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    return invalidUrl();
  }

  const rawPath = input
    .slice(input.indexOf("/", input.indexOf("//") + 2))
    .split(/[?#]/u, 1)[0];

  // Reject path normalization tricks before URL.pathname has a chance to
  // collapse them into a valid-looking path.
  if (
    rawPath.includes("//") ||
    rawPath.includes("%") ||
    /\/(?:\.{1,2})(?:\/|$)/u.test(rawPath)
  ) {
    return invalidUrl();
  }

  const playlistPath = /^\/playlist\/([^/]+)\/?$/u.exec(url.pathname);
  const localePlaylistPath =
    /^\/intl-([A-Za-z]{2,3}(?:-[A-Za-z]{2})?)\/playlist\/([^/]+)\/?$/u.exec(
      url.pathname,
    );
  const id = playlistPath?.[1] ?? localePlaylistPath?.[2];

  if (
    localePlaylistPath !== null &&
    !LOCALE_PATTERN.test(localePlaylistPath[1] ?? "")
  ) {
    return invalidUrl();
  }

  if (id === undefined || !SPOTIFY_ID_PATTERN.test(id)) {
    return invalidUrl();
  }

  const identity: PublicPlaylistIdentity = Object.freeze({
    playlistId: id,
    canonicalUrl: `https://${PUBLIC_PLAYLIST_HOST}/playlist/${id}`,
  });

  return identity;
}

/** Non-throwing convenience for client/server validation seams. */
export function tryParsePublicPlaylistUrl(
  value: unknown,
): PublicPlaylistIdentity | null {
  try {
    return parsePublicPlaylistUrl(value);
  } catch (error) {
    if (error instanceof PublicPlaylistUrlError) {
      return null;
    }

    throw error;
  }
}

/** Alias used by callers that want to emphasize canonicalization. */
export const canonicalizePublicPlaylistUrl = parsePublicPlaylistUrl;
