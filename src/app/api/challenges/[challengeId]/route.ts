import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  ChallengeStateError,
  type ChallengeState,
  isOpaqueChallengeId,
  renderChallenge,
} from "../../../../lib/challenge/challenge-state";
import {
  ChallengeStoreError,
  challengeStore,
} from "../../../../lib/challenge/challenge-store";
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
import { getServerEnvironment } from "../../../../lib/env";
import type { ChallengeApiErrorCode } from "../../../../types/challenge";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

const errorStatuses: Readonly<Record<ChallengeApiErrorCode, number>> = {
  AUTH_UNAVAILABLE: 503,
  SPOTIFY_AUTH_REQUIRED: 401,
  SPOTIFY_SCOPE_REQUIRED: 403,
  SPOTIFY_RATE_LIMITED: 429,
  SPOTIFY_UNAVAILABLE: 502,
  SOURCE_NOT_IN_LIBRARY: 403,
  SOURCE_INACCESSIBLE: 403,
  LYRICS_RATE_LIMITED: 429,
  LYRICS_PROVIDER_UNAVAILABLE: 502,
  INSUFFICIENT_LYRICS: 422,
  INVALID_INPUT: 400,
  INVALID_GUESS: 400,
  CHALLENGE_NOT_FOUND: 404,
  QUESTION_NOT_ACTIVE: 409,
};

type AuthenticatedRequest = Readonly<{
  session: Parameters<typeof encryptSession>[0];
  environment: ReturnType<typeof getServerEnvironment>;
  secure: boolean;
  refreshed: boolean;
}>;

function createErrorResponse(error: ChallengeApiErrorCode): NextResponse {
  return NextResponse.json(
    { error },
    {
      status: errorStatuses[error],
      headers: NO_STORE_HEADERS,
    },
  );
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

function applySessionRefresh(
  response: NextResponse,
  authentication: AuthenticatedRequest,
): NextResponse {
  if (authentication.refreshed) {
    response.cookies.set(
      AUTH_SESSION_COOKIE_NAME,
      encryptSession(
        authentication.session,
        authentication.environment.AUTH_SESSION_SECRET,
      ),
      getSessionCookieOptions(authentication.secure),
    );
  }

  return response;
}

/**
 * Public playlist challenges are bearer-style, opaque handles. They must be
 * readable without an OAuth session, while authenticated album/playlist
 * challenges retain the existing session gate. Unknown/expired handles return
 * null so the legacy unauthenticated response remains unchanged.
 */
function readAnonymousPublicChallenge(challengeId: string): ChallengeState | null {
  try {
    const challenge = challengeStore.get(challengeId);
    return challenge.source.kind === "public-playlist" ? challenge : null;
  } catch {
    return null;
  }
}

async function readAuthentication(): Promise<
  AuthenticatedRequest | NextResponse
> {
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

  let environment: ReturnType<typeof getServerEnvironment>;

  try {
    environment = getServerEnvironment();
  } catch {
    const response = createErrorResponse("AUTH_UNAVAILABLE");
    clearSessionCookie(response, false);
    return response;
  }

  const secure = usesSecureCookies(environment.NEXT_PUBLIC_APP_URL);
  let session: AuthenticatedRequest["session"];

  try {
    // Reading an expired payload here is intentional: the refresh token may
    // still renew the session before the request is treated as unauthenticated.
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

  return Object.freeze({
    session: activeSession,
    environment,
    secure,
    refreshed,
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ challengeId: string }> },
): Promise<NextResponse> {
  let routeParams: { challengeId: string };

  try {
    routeParams = await params;
  } catch {
    return createErrorResponse("CHALLENGE_NOT_FOUND");
  }

  if (
    typeof routeParams !== "object" ||
    routeParams === null ||
    typeof routeParams.challengeId !== "string" ||
    !isOpaqueChallengeId(routeParams.challengeId)
  ) {
    return createErrorResponse("CHALLENGE_NOT_FOUND");
  }

  const publicChallenge = readAnonymousPublicChallenge(routeParams.challengeId);

  if (publicChallenge !== null) {
    return NextResponse.json(
      { challenge: renderChallenge(publicChallenge) },
      { headers: NO_STORE_HEADERS },
    );
  }

  const authentication = await readAuthentication();

  if (authentication instanceof NextResponse) {
    return authentication;
  }

  let response: NextResponse;

  try {
    const challenge = challengeStore.get(routeParams.challengeId);
    response = NextResponse.json(
      { challenge: renderChallenge(challenge) },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    // Expired, unknown, malformed, and internally invalid handles share one
    // stable response. No provider or raw state error crosses this boundary.
    if (
      error instanceof ChallengeStoreError ||
      error instanceof ChallengeStateError
    ) {
      response = createErrorResponse("CHALLENGE_NOT_FOUND");
    } else {
      response = createErrorResponse("CHALLENGE_NOT_FOUND");
    }
  }

  if (response.status !== 401) {
    applySessionRefresh(response, authentication);
  }

  return response;
}
