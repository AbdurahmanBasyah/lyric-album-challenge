import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { refreshAccessToken } from "../../../lib/auth/spotify";
import {
  AUTH_SESSION_COOKIE_NAME,
  decryptSession,
  encryptSession,
  getClearCookieOptions,
  getSessionCookieOptions,
  isSessionExpiringSoon,
  usesSecureCookies,
} from "../../../lib/auth/session";
import { getServerEnvironment } from "../../../lib/env";
import {
  getSavedPlaylists,
  parseOffsetCursor,
  SpotifyPlaylistsError,
} from "../../../lib/spotify/playlists";
import type {
  PlaylistsApiErrorCode,
  SavedPlaylistsPage,
} from "../../../types/playlists";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

const errorStatuses: Record<PlaylistsApiErrorCode, number> = {
  AUTH_UNAVAILABLE: 503,
  SPOTIFY_AUTH_REQUIRED: 401,
  SPOTIFY_SCOPE_REQUIRED: 403,
  SPOTIFY_RATE_LIMITED: 429,
  SPOTIFY_UNAVAILABLE: 502,
  INVALID_CURSOR: 400,
};

function diagnosticHeaderValue(error: SpotifyPlaylistsError): string {
  if (error.reason === "invalid_response_schema") {
    return `${error.reason}:${error.schemaDiagnostic ?? "response_shape_other"}`;
  }

  return error.providerStatus === undefined
    ? error.reason
    : `${error.reason}:${error.providerStatus}`;
}

function createErrorResponse(
  error: PlaylistsApiErrorCode,
  diagnosticError?: SpotifyPlaylistsError,
): NextResponse {
  const headers = new Headers(NO_STORE_HEADERS);

  if (
    process.env.NODE_ENV === "development" &&
    diagnosticError !== undefined
  ) {
    headers.set(
      "X-Fillthelyrics-Diagnostic",
      diagnosticHeaderValue(diagnosticError),
    );
  }

  return NextResponse.json(
    { error },
    {
      status: errorStatuses[error],
      headers,
    },
  );
}

function createPlaylistsResponse(page: SavedPlaylistsPage): NextResponse {
  return NextResponse.json(page, { headers: NO_STORE_HEADERS });
}

function clearSessionCookie(response: NextResponse, secure: boolean): void {
  response.cookies.set(
    AUTH_SESSION_COOKIE_NAME,
    "",
    getClearCookieOptions(secure),
  );
}

function authRequiredResponse(
  secure: boolean,
  diagnosticError?: SpotifyPlaylistsError,
): NextResponse {
  const response = createErrorResponse(
    "SPOTIFY_AUTH_REQUIRED",
    diagnosticError,
  );
  clearSessionCookie(response, secure);
  return response;
}

export async function GET(request: Request): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  const cursorValues = requestUrl.searchParams.getAll("cursor");

  // A duplicate cursor is ambiguous and must not be silently selected by the
  // URLSearchParams first-value behavior.
  if (cursorValues.length > 1) {
    return createErrorResponse("INVALID_CURSOR");
  }

  const cursor = cursorValues[0];

  try {
    parseOffsetCursor(cursor);
  } catch {
    return createErrorResponse("INVALID_CURSOR");
  }

  let cookieStore;

  try {
    cookieStore = await cookies();
  } catch {
    return createErrorResponse("AUTH_UNAVAILABLE");
  }

  const encodedSession = cookieStore.get(AUTH_SESSION_COOKIE_NAME)?.value;

  if (!encodedSession) {
    return createErrorResponse("SPOTIFY_AUTH_REQUIRED");
  }

  let environment;

  try {
    environment = getServerEnvironment();
  } catch {
    const response = createErrorResponse("AUTH_UNAVAILABLE");
    clearSessionCookie(response, false);
    return response;
  }

  const secure = usesSecureCookies(environment.NEXT_PUBLIC_APP_URL);
  let session;

  try {
    // An expired payload is read only inside this server boundary so its
    // refresh token can be exchanged once before the cookie is discarded.
    session = decryptSession(encodedSession, environment.AUTH_SESSION_SECRET, {
      allowExpired: true,
    });
  } catch {
    return authRequiredResponse(secure);
  }

  let activeSession = session;
  let refreshed = false;

  if (isSessionExpiringSoon(session)) {
    try {
      activeSession = await refreshAccessToken(
        session.refreshToken,
        environment,
      );
      refreshed = true;
    } catch {
      return authRequiredResponse(secure);
    }
  }

  let page: SavedPlaylistsPage;

  try {
    page = await getSavedPlaylists(activeSession.accessToken, cursor);
  } catch (error) {
    if (error instanceof SpotifyPlaylistsError) {
      switch (error.kind) {
        case "auth":
          return authRequiredResponse(secure, error);
        case "scope":
          return createErrorResponse("SPOTIFY_SCOPE_REQUIRED", error);
        case "rate_limited":
          return createErrorResponse("SPOTIFY_RATE_LIMITED", error);
        case "invalid_cursor":
          return createErrorResponse("INVALID_CURSOR", error);
        case "unavailable":
        default:
          return createErrorResponse("SPOTIFY_UNAVAILABLE", error);
      }
    }

    return createErrorResponse("SPOTIFY_UNAVAILABLE");
  }

  const response = createPlaylistsResponse(page);

  if (refreshed) {
    response.cookies.set(
      AUTH_SESSION_COOKIE_NAME,
      encryptSession(activeSession, environment.AUTH_SESSION_SECRET),
      getSessionCookieOptions(secure),
    );
  }

  return response;
}
