import { randomBytes } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  ChallengeCandidateError,
  buildChallengeCandidates,
} from "../../../lib/challenge/challenge-candidates";
import {
  ChallengeStateError,
  MAX_CHALLENGE_QUESTIONS,
  MAX_SEED_LENGTH,
  normalizeChallengeSeed,
  normalizeChallengeSource,
  renderChallenge,
} from "../../../lib/challenge/challenge-state";
import {
  ChallengeStoreError,
  challengeStore,
} from "../../../lib/challenge/challenge-store";
import {
  SourceAuthorizationError,
  authorizeChallengeSource,
} from "../../../lib/challenge/source-authorization";
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
import { LrclibError } from "../../../lib/lrclib/client";
import {
  SpotifyAlbumTracksError,
} from "../../../lib/spotify/album-tracks";
import {
  SpotifyLibraryContainsError,
} from "../../../lib/spotify/library-contains";
import {
  SpotifyPlaylistItemsError,
} from "../../../lib/spotify/playlist-items";
import type {
  ChallengeApiErrorCode,
  ChallengeSourceView,
} from "../../../types/challenge";

export const runtime = "nodejs";

export const MAX_CHALLENGE_REQUEST_BYTES = 16 * 1024;
export const LRCLIB_CLIENT_IDENTIFIER = "fillthelyrics/0.1.0";
export const DEFAULT_CHALLENGE_TARGET_COUNT = 5;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const PRINTABLE_SEED_PATTERN = /^[\x20-\x7e]+$/u;
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
  accessToken: string;
  session: Parameters<typeof encryptSession>[0];
  environment: ReturnType<typeof getServerEnvironment>;
  secure: boolean;
  refreshed: boolean;
}>;

type LegacyChallengeSourceView = Extract<
  ChallengeSourceView,
  { kind: "album" | "playlist" }
>;

class CreateRequestError extends Error {
  constructor() {
    super("Invalid challenge request.");
    this.name = "CreateRequestError";
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
    accessToken: activeSession.accessToken,
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
      Number(contentLength) > MAX_CHALLENGE_REQUEST_BYTES)
  ) {
    throw new CreateRequestError();
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  validateContentLength(request);

  let text: string;

  try {
    text = await request.text();
  } catch {
    throw new CreateRequestError();
  }

  if (text.length > MAX_CHALLENGE_REQUEST_BYTES) {
    throw new CreateRequestError();
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CreateRequestError();
  }
}

function parseTargetCount(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_CHALLENGE_TARGET_COUNT;
  }

  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_CHALLENGE_QUESTIONS
  ) {
    throw new CreateRequestError();
  }

  return value;
}

function createRandomSeed(): string {
  return randomBytes(24).toString("base64url");
}

function parseSeed(value: unknown): string {
  if (value === undefined) {
    return createRandomSeed();
  }

  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.trim().length > MAX_SEED_LENGTH ||
    !PRINTABLE_SEED_PATTERN.test(value.trim()) ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new CreateRequestError();
  }

  try {
    return normalizeChallengeSeed(value);
  } catch {
    throw new CreateRequestError();
  }
}

function parseCreateBody(value: unknown): Readonly<{
  source: LegacyChallengeSourceView;
  seed: string;
  targetCount: number;
}> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CreateRequestError();
  }

  const body = value as Record<string, unknown>;
  const allowedKeys = new Set(["source", "seed", "targetCount"]);

  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    throw new CreateRequestError();
  }

  let source: LegacyChallengeSourceView;

  try {
    const normalized = normalizeChallengeSource(body.source);

    // Public URL imports have a dedicated anonymous route. Keeping this
    // legacy endpoint closed to that discriminator prevents an unauthenticated
    // request from being mistaken for a library source and preserves the
    // existing OAuth contract.
    if (normalized.kind === "public-playlist") {
      throw new CreateRequestError();
    }

    source = normalized;
  } catch {
    throw new CreateRequestError();
  }

  return Object.freeze({
    source,
    seed: parseSeed(body.seed),
    targetCount: parseTargetCount(body.targetCount),
  });
}

function sourceForResponse(
  authorized: Readonly<
    | { kind: "album"; spotifyId: string; name: string }
    | { kind: "playlist"; spotifyId: string }
  >,
  requested: LegacyChallengeSourceView,
): ChallengeSourceView {
  if (authorized.kind === "album") {
    return Object.freeze({
      kind: "album",
      spotifyId: authorized.spotifyId,
      displayName: authorized.name,
    });
  }

  return Object.freeze({
    kind: "playlist",
    spotifyId: authorized.spotifyId,
    ...(requested.displayName === undefined
      ? {}
      : { displayName: requested.displayName }),
  });
}

function createProviderErrorResponse(
  error: unknown,
  secure: boolean,
): NextResponse {
  if (error instanceof SourceAuthorizationError) {
    switch (error.kind) {
      case "invalid_input":
      case "invalid_source":
        return createErrorResponse("INVALID_INPUT");
      case "invalid_token":
      case "auth":
        return authRequiredResponse(secure);
      case "not_in_library":
        return createErrorResponse("SOURCE_NOT_IN_LIBRARY");
      case "scope":
        return createErrorResponse("SPOTIFY_SCOPE_REQUIRED");
      case "rate_limited":
        return createErrorResponse("SPOTIFY_RATE_LIMITED");
      case "unavailable":
      case "invalid_response":
      default:
        return createErrorResponse("SPOTIFY_UNAVAILABLE");
    }
  }

  if (error instanceof SpotifyLibraryContainsError) {
    switch (error.kind) {
      case "invalid_input":
        return createErrorResponse("INVALID_INPUT");
      case "invalid_response":
        return createErrorResponse("SPOTIFY_UNAVAILABLE");
      case "auth":
        return authRequiredResponse(secure);
      case "scope":
        return createErrorResponse("SPOTIFY_SCOPE_REQUIRED");
      case "rate_limited":
        return createErrorResponse("SPOTIFY_RATE_LIMITED");
      case "unavailable":
      default:
        return createErrorResponse("SPOTIFY_UNAVAILABLE");
    }
  }

  if (error instanceof SpotifyAlbumTracksError) {
    switch (error.kind) {
      case "invalid_input":
      case "invalid_cursor":
        return createErrorResponse("INVALID_INPUT");
      case "auth":
        return authRequiredResponse(secure);
      case "rate_limited":
        return createErrorResponse("SPOTIFY_RATE_LIMITED");
      case "unavailable":
      default:
        return createErrorResponse("SPOTIFY_UNAVAILABLE");
    }
  }

  if (error instanceof SpotifyPlaylistItemsError) {
    switch (error.kind) {
      case "invalid_input":
      case "invalid_cursor":
        return createErrorResponse("INVALID_INPUT");
      case "auth":
        return authRequiredResponse(secure);
      case "inaccessible":
        return createErrorResponse("SOURCE_INACCESSIBLE");
      case "rate_limited":
        return createErrorResponse("SPOTIFY_RATE_LIMITED");
      case "unavailable":
      default:
        return createErrorResponse("SPOTIFY_UNAVAILABLE");
    }
  }

  if (error instanceof LrclibError) {
    switch (error.kind) {
      case "input":
        return createErrorResponse("INVALID_INPUT");
      case "rate_limited":
        return createErrorResponse("LYRICS_RATE_LIMITED");
      case "configuration":
      case "unavailable":
      case "invalid_response":
      default:
        return createErrorResponse("LYRICS_PROVIDER_UNAVAILABLE");
    }
  }

  if (error instanceof ChallengeCandidateError) {
    switch (error.kind) {
      case "invalid_input":
      case "invalid_source":
      case "invalid_token":
      case "invalid_seed":
      case "invalid_target":
      case "invalid_lyrics_options":
        return createErrorResponse("INVALID_INPUT");
      case "invalid_collection":
      case "invalid_lyrics_result":
      default:
        return createErrorResponse("LYRICS_PROVIDER_UNAVAILABLE");
    }
  }

  if (error instanceof ChallengeStateError) {
    switch (error.kind) {
      case "insufficient_lyrics":
        return createErrorResponse("INSUFFICIENT_LYRICS");
      case "invalid_input":
      case "invalid_source":
      case "invalid_seed":
      case "invalid_id":
      case "invalid_candidates":
      case "invalid_guess":
      case "question_finished":
      default:
        return createErrorResponse("INVALID_INPUT");
    }
  }

  if (error instanceof ChallengeStoreError) {
    return createErrorResponse("SPOTIFY_UNAVAILABLE");
  }

  return createErrorResponse("SPOTIFY_UNAVAILABLE");
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: ReturnType<typeof parseCreateBody>;

  try {
    body = parseCreateBody(await readJsonBody(request));
  } catch {
    return createErrorResponse("INVALID_INPUT");
  }

  const authentication = await readAuthentication();

  if (authentication instanceof NextResponse) {
    return authentication;
  }

  let response: NextResponse;

  try {
    const authorized = await authorizeChallengeSource({
      source: body.source,
      accessToken: authentication.accessToken,
    });
    const candidates = await buildChallengeCandidates({
      source: authorized,
      accessToken: authentication.accessToken,
      seed: body.seed,
      targetCount: body.targetCount,
      lyricsOptions: {
        clientIdentifier: LRCLIB_CLIENT_IDENTIFIER,
      },
    });

    if (candidates.status === "insufficient_lyrics") {
      response = createErrorResponse("INSUFFICIENT_LYRICS");
    } else {
      const challenge = challengeStore.create({
        source: sourceForResponse(authorized, body.source),
        seed: body.seed,
        candidates,
      });
      response = NextResponse.json(
        { challenge: renderChallenge(challenge) },
        { status: 201, headers: NO_STORE_HEADERS },
      );
    }
  } catch (error) {
    response = createProviderErrorResponse(error, authentication.secure);
  }

  if (response.status !== 401) {
    applySessionRefresh(response, authentication);
  }

  return response;
}
