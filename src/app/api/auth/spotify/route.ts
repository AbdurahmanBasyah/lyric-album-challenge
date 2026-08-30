import { NextResponse } from "next/server";

import { getServerEnvironment } from "../../../../lib/env";
import {
  buildSpotifyAuthorizationUrl,
  createOAuthState,
} from "../../../../lib/auth/spotify";
import {
  OAUTH_STATE_COOKIE_NAME,
  getStateCookieOptions,
  usesSecureCookies,
} from "../../../../lib/auth/session";

export const runtime = "nodejs";

export function GET(request?: Request): NextResponse {
  let environment;

  try {
    environment = getServerEnvironment();
  } catch {
    return NextResponse.json(
      { error: "AUTH_UNAVAILABLE" },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const state = createOAuthState();
  const reauthorizeValues = request
    ? new URL(request.url).searchParams.getAll("reauthorize")
    : [];
  const showDialog =
    reauthorizeValues.length === 1 && reauthorizeValues[0] === "1";
  const response = NextResponse.redirect(
    buildSpotifyAuthorizationUrl(environment, state, { showDialog }),
  );
  response.cookies.set(
    OAUTH_STATE_COOKIE_NAME,
    state,
    getStateCookieOptions(usesSecureCookies(environment.NEXT_PUBLIC_APP_URL)),
  );

  return response;
}
