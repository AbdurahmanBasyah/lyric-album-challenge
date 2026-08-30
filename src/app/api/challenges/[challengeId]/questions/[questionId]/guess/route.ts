import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  createGuessResponse,
  ChallengeStateError,
  MAX_GUESS_ANSWER_LENGTH,
  MAX_GUESS_ANSWERS,
  type ChallengeState,
} from "../../../../../../../lib/challenge/challenge-state";
import {
  ChallengeStoreError,
  challengeStore,
} from "../../../../../../../lib/challenge/challenge-store";
import { refreshAccessToken } from "../../../../../../../lib/auth/spotify";
import {
  AUTH_SESSION_COOKIE_NAME,
  decryptSession,
  encryptSession,
  getClearCookieOptions,
  getSessionCookieOptions,
  isSessionExpiringSoon,
  usesSecureCookies,
} from "../../../../../../../lib/auth/session";
import { getServerEnvironment } from "../../../../../../../lib/env";
import type { ChallengeApiErrorCode } from "../../../../../../../types/challenge";

export const runtime = "nodejs";

export const MAX_GUESS_REQUEST_BYTES = 16 * 1024;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

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

class GuessRequestError extends Error {
  constructor() {
    super("Invalid challenge guess request.");
    this.name = "GuessRequestError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

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
 * Public playlist challenges are anonymous bearer-style handles. Only a
 * server-created public source may use this path; authenticated library
 * challenges still go through the existing OAuth/session gate below.
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

function validateContentLength(request: Request): void {
  const contentLength = request.headers.get("content-length");

  if (
    contentLength !== null &&
    (!/^(?:0|[1-9]\d*)$/u.test(contentLength) ||
      Number(contentLength) > MAX_GUESS_REQUEST_BYTES)
  ) {
    throw new GuessRequestError();
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  validateContentLength(request);

  let text: string;

  try {
    text = await request.text();
  } catch {
    throw new GuessRequestError();
  }

  if (text.length > MAX_GUESS_REQUEST_BYTES) {
    throw new GuessRequestError();
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new GuessRequestError();
  }
}

function parseGuessBody(value: unknown): Readonly<{ answers: Readonly<Record<string, string>> }> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GuessRequestError();
  }

  const body = value as Record<string, unknown>;

  if (
    Object.keys(body).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(body, "answers")
  ) {
    throw new GuessRequestError();
  }

  const answers = body.answers;

  if (typeof answers !== "object" || answers === null || Array.isArray(answers)) {
    throw new GuessRequestError();
  }

  const answerRecord = answers as Record<string, unknown>;
  const keys = Object.keys(answerRecord);

  if (keys.length > MAX_GUESS_ANSWERS) {
    throw new GuessRequestError();
  }

  for (const key of keys) {
    const answer = answerRecord[key];

    if (
      key.length === 0 ||
      key.length > 128 ||
      typeof answer !== "string" ||
      answer.length > MAX_GUESS_ANSWER_LENGTH ||
      CONTROL_CHARACTER_PATTERN.test(answer)
    ) {
      throw new GuessRequestError();
    }
  }

  return Object.freeze({ answers: answerRecord as Record<string, string> });
}

function mapGuessError(error: unknown): NextResponse {
  if (error instanceof ChallengeStoreError) {
    switch (error.kind) {
      case "invalid_id":
      case "not_found":
      case "question_not_found":
        return createErrorResponse("CHALLENGE_NOT_FOUND");
      case "invalid_input":
      case "id_generation":
      default:
        return createErrorResponse("CHALLENGE_NOT_FOUND");
    }
  }

  if (error instanceof ChallengeStateError) {
    switch (error.kind) {
      case "question_finished":
        return createErrorResponse("QUESTION_NOT_ACTIVE");
      case "invalid_guess":
      case "invalid_input":
      case "invalid_source":
      case "invalid_seed":
      case "invalid_id":
      case "invalid_candidates":
      case "insufficient_lyrics":
      default:
        return createErrorResponse("INVALID_GUESS");
    }
  }

  return createErrorResponse("CHALLENGE_NOT_FOUND");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ challengeId: string; questionId: string }> },
): Promise<NextResponse> {
  let body: Readonly<{ answers: Readonly<Record<string, string>> }>;

  try {
    body = parseGuessBody(await readJsonBody(request));
  } catch {
    return createErrorResponse("INVALID_GUESS");
  }

  let routeParams: { challengeId: string; questionId: string };

  try {
    routeParams = await params;
  } catch {
    return createErrorResponse("CHALLENGE_NOT_FOUND");
  }

  if (
    typeof routeParams.challengeId !== "string" ||
    typeof routeParams.questionId !== "string"
  ) {
    return createErrorResponse("CHALLENGE_NOT_FOUND");
  }

  const publicChallenge = readAnonymousPublicChallenge(routeParams.challengeId);

  if (publicChallenge !== null) {
    try {
      const result = challengeStore.guess(
        routeParams.challengeId,
        routeParams.questionId,
        body.answers,
      );

      return NextResponse.json(createGuessResponse(result), {
        headers: NO_STORE_HEADERS,
      });
    } catch (error) {
      return mapGuessError(error);
    }
  }

  const authentication = await readAuthentication();

  if (authentication instanceof NextResponse) {
    return authentication;
  }

  let response: NextResponse;

  try {
    const result = challengeStore.guess(
      routeParams.challengeId,
      routeParams.questionId,
      body.answers,
    );
    response = NextResponse.json(
      createGuessResponse(result),
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    response = mapGuessError(error);
  }

  if (response.status !== 401) {
    applySessionRefresh(response, authentication);
  }

  return response;
}
