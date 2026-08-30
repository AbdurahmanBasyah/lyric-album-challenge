import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getServerEnvironment } from "../../../../lib/env";
import { refreshAccessToken } from "../../../../lib/auth/spotify";
import {
  AUTH_SESSION_COOKIE_NAME,
  decryptSession,
  encryptSession,
  getClearCookieOptions,
  getSessionCookieOptions,
  isSessionExpiringSoon,
  usesSecureCookies,
} from "../../../../lib/auth/session";

export const runtime = "nodejs";

function createSessionResponse(authenticated: boolean): NextResponse {
  return NextResponse.json(
    { authenticated },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(): Promise<NextResponse> {
  const cookieStore = await cookies();
  const encodedSession = cookieStore.get(AUTH_SESSION_COOKIE_NAME)?.value;

  if (!encodedSession) {
    return createSessionResponse(false);
  }

  let environment;

  try {
    environment = getServerEnvironment();
  } catch {
    const response = createSessionResponse(false);
    response.cookies.set(
      AUTH_SESSION_COOKIE_NAME,
      "",
      getClearCookieOptions(false),
    );
    return response;
  }

  const secure = usesSecureCookies(environment.NEXT_PUBLIC_APP_URL);
  let session;

  try {
    // Read an expired payload only inside this server boundary so a valid
    // refresh token can be used once before the session is discarded.
    session = decryptSession(encodedSession, environment.AUTH_SESSION_SECRET, {
      allowExpired: true,
    });
  } catch {
    const response = createSessionResponse(false);
    response.cookies.set(
      AUTH_SESSION_COOKIE_NAME,
      "",
      getClearCookieOptions(secure),
    );
    return response;
  }

  if (!isSessionExpiringSoon(session)) {
    return createSessionResponse(true);
  }

  try {
    const refreshed = await refreshAccessToken(
      session.refreshToken,
      environment,
    );
    const response = createSessionResponse(true);
    response.cookies.set(
      AUTH_SESSION_COOKIE_NAME,
      encryptSession(refreshed, environment.AUTH_SESSION_SECRET),
      getSessionCookieOptions(secure),
    );
    return response;
  } catch {
    const response = createSessionResponse(false);
    response.cookies.set(
      AUTH_SESSION_COOKIE_NAME,
      "",
      getClearCookieOptions(secure),
    );
    return response;
  }
}
