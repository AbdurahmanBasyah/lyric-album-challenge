import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getServerEnvironment } from "../../../../lib/env";
import {
  AUTH_SESSION_COOKIE_NAME,
  OAUTH_STATE_COOKIE_NAME,
  getClearCookieOptions,
  usesSecureCookies,
} from "../../../../lib/auth/session";

export const runtime = "nodejs";

export async function POST(): Promise<NextResponse> {
  await cookies();
  let secure = false;

  try {
    secure = usesSecureCookies(getServerEnvironment().NEXT_PUBLIC_APP_URL);
  } catch {
    // Clearing with non-secure options still expires the path-scoped cookies
    // when configuration is unavailable; logout remains idempotent.
  }

  const response = NextResponse.json(
    { authenticated: false },
    { headers: { "Cache-Control": "no-store" } },
  );
  const clearOptions = getClearCookieOptions(secure);
  response.cookies.set(AUTH_SESSION_COOKIE_NAME, "", clearOptions);
  response.cookies.set(OAUTH_STATE_COOKIE_NAME, "", clearOptions);

  return response;
}
