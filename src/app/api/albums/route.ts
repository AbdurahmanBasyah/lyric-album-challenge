import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  refreshAccessToken,
} from "../../../lib/auth/spotify";
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
  getSavedAlbums,
  parseOffsetCursor,
  SpotifyAlbumsError,
} from "../../../lib/spotify/albums";
import type {
  AlbumsApiErrorCode,
  SavedAlbumsPage,
} from "../../../types/albums";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

const errorStatuses: Record<AlbumsApiErrorCode, number> = {
  AUTH_UNAVAILABLE: 503,
  SPOTIFY_AUTH_REQUIRED: 401,
  SPOTIFY_RATE_LIMITED: 429,
  SPOTIFY_UNAVAILABLE: 502,
  INVALID_CURSOR: 400,
};

function createErrorResponse(error: AlbumsApiErrorCode): NextResponse {
  return NextResponse.json(
    { error },
    {
      status: errorStatuses[error],
      headers: NO_STORE_HEADERS,
    },
  );
}

function createAlbumsResponse(page: SavedAlbumsPage): NextResponse {
  return NextResponse.json(page, { headers: NO_STORE_HEADERS });
}

function clearSessionCookie(response: NextResponse, secure: boolean): void {
  response.cookies.set(
    AUTH_SESSION_COOKIE_NAME,
    "",
    getClearCookieOptions(secure),
  );
}

function authRequiredResponse(secure: boolean): NextResponse {
  const response = createErrorResponse("SPOTIFY_AUTH_REQUIRED");
  clearSessionCookie(response, secure);
  return response;
}

function unavailableResponse(): NextResponse {
  return createErrorResponse("SPOTIFY_UNAVAILABLE");
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
  } catch (error) {
    if (error instanceof SpotifyAlbumsError && error.kind === "invalid_cursor") {
      return createErrorResponse("INVALID_CURSOR");
    }

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

  let page: SavedAlbumsPage;

  try {
    page = await getSavedAlbums(activeSession.accessToken, cursor);
  } catch (error) {
    if (error instanceof SpotifyAlbumsError) {
      switch (error.kind) {
        case "auth":
          return authRequiredResponse(secure);
        case "rate_limited":
          return createErrorResponse("SPOTIFY_RATE_LIMITED");
        case "invalid_cursor":
          return createErrorResponse("INVALID_CURSOR");
        case "unavailable":
        default:
          return unavailableResponse();
      }
    }

    return unavailableResponse();
  }

  const response = createAlbumsResponse(page);

  if (refreshed) {
    response.cookies.set(
      AUTH_SESSION_COOKIE_NAME,
      encryptSession(activeSession, environment.AUTH_SESSION_SECRET),
      getSessionCookieOptions(secure),
    );
  }

  return response;
}
