import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  ChallengeStateError,
  isOpaqueChallengeId,
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
import {
  getServerEnvironment,
  type AppEnvironment,
} from "../../../../../../../lib/env";
import {
  resolveChallengeQuestionPlayback,
  type ChallengePlaybackResolver,
} from "../../../../../../../lib/playback/youtube-playback";
import {
  createYouTubeResolver,
  type YouTubeResolverOptions,
} from "../../../../../../../lib/youtube/youtube-resolver";
import type { ChallengeApiErrorCode } from "../../../../../../../types/challenge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const MAX_PLAYBACK_REQUEST_BYTES = 4 * 1024;

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
  environment: AppEnvironment;
  secure: boolean;
  refreshed: boolean;
}>;

type PlaybackRouteDependencies = Readonly<{
  /** Test/server seam; production uses the accepted resolver factory. */
  resolver?: ChallengePlaybackResolver;
  createResolver?: (
    options?: YouTubeResolverOptions,
  ) => ChallengePlaybackResolver;
  resolverOptions?: YouTubeResolverOptions;
  readEnvironment?: () => AppEnvironment;
  readCookies?: typeof cookies;
  refreshToken?: typeof refreshAccessToken;
}>;

type PlaybackRouteParams = Readonly<{
  challengeId: string;
  questionId: string;
}>;

class PlaybackRequestError extends Error {
  constructor() {
    super("Invalid playback request.");
    this.name = "PlaybackRequestError";
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
 * Public playlist challenges are anonymous bearer-style handles. Reading one
 * does not touch cookies or the OAuth environment. A non-public challenge is
 * intentionally returned as null so the legacy session gate remains intact.
 */
function readAnonymousPublicChallenge(challengeId: string) {
  try {
    const challenge = challengeStore.get(challengeId);
    return challenge.source.kind === "public-playlist" ? challenge : null;
  } catch {
    return null;
  }
}

async function readAuthentication(
  dependencies: PlaybackRouteDependencies,
): Promise<AuthenticatedRequest | NextResponse> {
  let cookieStore;

  try {
    cookieStore = await (dependencies.readCookies ?? cookies)();
  } catch {
    return createErrorResponse("AUTH_UNAVAILABLE");
  }

  const encodedSession = cookieStore.get(AUTH_SESSION_COOKIE_NAME)?.value;

  if (!encodedSession) {
    return createErrorResponse("SPOTIFY_AUTH_REQUIRED");
  }

  let environment: AppEnvironment;

  try {
    environment = (dependencies.readEnvironment ?? getServerEnvironment)();
  } catch {
    const response = createErrorResponse("AUTH_UNAVAILABLE");
    clearSessionCookie(response, false);
    return response;
  }

  const secure = usesSecureCookies(environment.NEXT_PUBLIC_APP_URL);
  let session: AuthenticatedRequest["session"];

  try {
    // Keep the existing refresh-before-authorization behavior for legacy
    // album and authenticated-playlist challenges.
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
      activeSession = await (dependencies.refreshToken ?? refreshAccessToken)(
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
      Number(contentLength) > MAX_PLAYBACK_REQUEST_BYTES)
  ) {
    throw new PlaybackRequestError();
  }
}

/** Empty bytes and the strictly empty JSON object are the only valid bodies. */
async function validatePlaybackBody(request: Request): Promise<void> {
  validateContentLength(request);

  let text: string;

  try {
    text = await request.text();
  } catch {
    throw new PlaybackRequestError();
  }

  if (text.length > MAX_PLAYBACK_REQUEST_BYTES) {
    throw new PlaybackRequestError();
  }

  const trimmed = text.trim();

  if (trimmed.length === 0) {
    return;
  }

  let value: unknown;

  try {
    value = JSON.parse(trimmed) as unknown;
  } catch {
    throw new PlaybackRequestError();
  }

  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 0
  ) {
    throw new PlaybackRequestError();
  }
}

function readRouteParams(value: unknown): PlaybackRouteParams | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const params = value as Record<string, unknown>;

  if (
    typeof params.challengeId !== "string" ||
    typeof params.questionId !== "string" ||
    !isOpaqueChallengeId(params.challengeId) ||
    !isOpaqueChallengeId(params.questionId)
  ) {
    return null;
  }

  return Object.freeze({
    challengeId: params.challengeId,
    questionId: params.questionId,
  });
}

function readQuestion(
  params: PlaybackRouteParams,
): Readonly<{
  challenge: ReturnType<typeof challengeStore.get>;
  question: ReturnType<typeof challengeStore.getQuestion>["question"];
}> | null {
  try {
    const found = challengeStore.getQuestion(
      params.challengeId,
      params.questionId,
    );

    return Object.freeze({
      challenge: found.challenge,
      question: found.question,
    });
  } catch (error) {
    if (
      error instanceof ChallengeStoreError ||
      error instanceof ChallengeStateError
    ) {
      return null;
    }

    return null;
  }
}

function createResolver(
  dependencies: PlaybackRouteDependencies,
  apiKey: unknown,
): ChallengePlaybackResolver {
  if (dependencies.resolver !== undefined) {
    return dependencies.resolver;
  }

  const factory = dependencies.createResolver ?? createYouTubeResolver;
  const baseOptions = {
    ...(dependencies.resolverOptions ?? {}),
  };

  // An explicitly supplied resolverOptions.apiKey is useful for tests and
  // takes precedence; otherwise private requests use the validated server
  // environment while public requests fall through to process.env in the
  // server-only resolver.
  const options: YouTubeResolverOptions =
    baseOptions.apiKey === undefined && apiKey !== undefined
      ? { ...baseOptions, apiKey }
      : baseOptions;

  return factory(options);
}

async function handleTerminalPlayback(
  params: PlaybackRouteParams,
  dependencies: PlaybackRouteDependencies,
  apiKey: unknown,
): Promise<NextResponse> {
  const found = readQuestion(params);

  if (found === null) {
    return createErrorResponse("CHALLENGE_NOT_FOUND");
  }

  if (found.question.status === "active") {
    return createErrorResponse("QUESTION_NOT_ACTIVE");
  }

  let payload;

  try {
    const resolver = createResolver(dependencies, apiKey);
    // The playback helper derives the optional startAtMs from this
    // server-owned terminal window. No request field can override it, and no
    // end boundary is fabricated when the lyric window has none.
    payload = await resolveChallengeQuestionPlayback(found.question, resolver);
  } catch {
    // Resolver construction is optional provider work. Keep provider failures
    // from becoming route failures or leaking constructor diagnostics.
    payload = {
      playback: {
        provider: "youtube" as const,
        status: "unavailable" as const,
        reason: "unavailable" as const,
      },
    };
  }

  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}

export function createPlaybackPostHandler(
  dependencies: PlaybackRouteDependencies = {},
): (
  request: Request,
  context: { params: Promise<{ challengeId: string; questionId: string }> },
) => Promise<NextResponse> {
  return async (
    request: Request,
    context: { params: Promise<{ challengeId: string; questionId: string }> },
  ): Promise<NextResponse> => {
    try {
      await validatePlaybackBody(request);
    } catch {
      return createErrorResponse("INVALID_INPUT");
    }

    let params: PlaybackRouteParams | null;

    try {
      params = readRouteParams(await context.params);
    } catch {
      params = null;
    }

    if (params === null) {
      return createErrorResponse("CHALLENGE_NOT_FOUND");
    }

    const publicChallenge = readAnonymousPublicChallenge(params.challengeId);

    if (publicChallenge !== null) {
      return handleTerminalPlayback(params, dependencies, undefined);
    }

    const authentication = await readAuthentication(dependencies);

    if (authentication instanceof NextResponse) {
      return authentication;
    }

    let response: NextResponse;

    try {
      response = await handleTerminalPlayback(
        params,
        dependencies,
        authentication.environment.YOUTUBE_API_KEY ?? null,
      );
    } catch {
      response = createErrorResponse("CHALLENGE_NOT_FOUND");
    }

    return applySessionRefresh(response, authentication);
  };
}

export const POST = createPlaybackPostHandler();
