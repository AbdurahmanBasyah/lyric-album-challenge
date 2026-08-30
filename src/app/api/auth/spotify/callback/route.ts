import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getServerEnvironment, type AppEnvironment } from "../../../../../lib/env";
import {
  exchangeAuthorizationCode,
  statesMatch,
} from "../../../../../lib/auth/spotify";
import {
  AUTH_SESSION_COOKIE_NAME,
  OAUTH_STATE_COOKIE_NAME,
  encryptSession,
  getClearCookieOptions,
  getSessionCookieOptions,
  usesSecureCookies,
} from "../../../../../lib/auth/session";

export const runtime = "nodejs";

type CallbackReason = "config" | "denied" | "invalid_state" | "exchange";

function createAppRedirect(
  environment: AppEnvironment,
  auth: "success" | "error",
  reason?: CallbackReason,
): NextResponse {
  const redirectUrl = new URL("/", environment.NEXT_PUBLIC_APP_URL);
  redirectUrl.searchParams.set("auth", auth);

  if (reason) {
    redirectUrl.searchParams.set("reason", reason);
  }

  return NextResponse.redirect(redirectUrl);
}

function createUnavailableResponse(): NextResponse {
  return NextResponse.json(
    { error: "AUTH_UNAVAILABLE" },
    {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export async function GET(request: Request): Promise<NextResponse> {
  const cookieStore = await cookies();
  const stateCookie = cookieStore.get(OAUTH_STATE_COOKIE_NAME)?.value;
  const requestUrl = new URL(request.url);
  let environment: AppEnvironment | undefined;

  try {
    environment = getServerEnvironment();
  } catch {
    const unavailable = createUnavailableResponse();
    unavailable.cookies.set(
      OAUTH_STATE_COOKIE_NAME,
      "",
      getClearCookieOptions(requestUrl.protocol === "https:"),
    );
    return unavailable;
  }

  const secure = usesSecureCookies(environment.NEXT_PUBLIC_APP_URL);
  const fail = (reason: CallbackReason): NextResponse => {
    const response = createAppRedirect(environment, "error", reason);
    response.cookies.set(
      OAUTH_STATE_COOKIE_NAME,
      "",
      getClearCookieOptions(secure),
    );
    return response;
  };

  const returnedState = requestUrl.searchParams.get("state") ?? undefined;

  // Validate state before considering the provider result or exchanging code.
  if (!statesMatch(stateCookie, returnedState)) {
    return fail("invalid_state");
  }

  const providerError = requestUrl.searchParams.get("error");
  const code = requestUrl.searchParams.get("code");

  if (providerError || !code) {
    return fail("denied");
  }

  try {
    const tokens = await exchangeAuthorizationCode(code, environment);
    const response = createAppRedirect(environment, "success");
    response.cookies.set(
      AUTH_SESSION_COOKIE_NAME,
      encryptSession(tokens, environment.AUTH_SESSION_SECRET),
      getSessionCookieOptions(secure),
    );
    response.cookies.set(
      OAUTH_STATE_COOKIE_NAME,
      "",
      getClearCookieOptions(secure),
    );
    return response;
  } catch {
    return fail("exchange");
  }
}
