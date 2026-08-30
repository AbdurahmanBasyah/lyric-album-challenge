import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import {
  buildChallengeCandidates,
  ChallengeCandidateError,
  type PublicPlaylistChallengeSource,
} from "../../../../lib/challenge/challenge-candidates";
import {
  ChallengeStateError,
  MAX_CHALLENGE_QUESTIONS,
  MAX_SEED_LENGTH,
  normalizeChallengeSeed,
  renderChallenge,
} from "../../../../lib/challenge/challenge-state";
import {
  ChallengeStoreError,
  challengeStore,
} from "../../../../lib/challenge/challenge-store";
import { LrclibError } from "../../../../lib/lrclib/client";
import {
  createSpotifyEmbedPlaylistResolver,
  PublicPlaylistResolverError,
  type PublicPlaylistResolver,
} from "../../../../lib/public-playlist/public-playlist-resolver";
import {
  parsePublicPlaylistUrl,
  PublicPlaylistUrlError,
  type PublicPlaylistIdentity,
} from "../../../../lib/public-playlist/url";
import type { ChallengeView } from "../../../../types/challenge";

export const runtime = "nodejs";

export const MAX_PUBLIC_PLAYLIST_REQUEST_BYTES = 16 * 1024;
export const LRCLIB_CLIENT_IDENTIFIER = "fillthelyrics/0.1.0";
export const DEFAULT_PUBLIC_PLAYLIST_TARGET_COUNT = 5;
export const MAX_IN_FLIGHT_PUBLIC_PLAYLIST_REQUESTS = 32;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const PRINTABLE_SEED_PATTERN = /^[\x20-\x7e]+$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

/** Public-flow error codes remain separate from the legacy OAuth contract. */
export type PublicPlaylistApiErrorCode =
  | "INVALID_INPUT"
  | "PUBLIC_PLAYLIST_PRIVATE"
  | "PUBLIC_PLAYLIST_NOT_FOUND"
  | "PUBLIC_PLAYLIST_RATE_LIMITED"
  | "PUBLIC_PLAYLIST_UNAVAILABLE"
  | "PUBLIC_PLAYLIST_INVALID_RESPONSE"
  | "LYRICS_RATE_LIMITED"
  | "LYRICS_PROVIDER_UNAVAILABLE"
  | "INSUFFICIENT_LYRICS";

const errorStatuses: Readonly<Record<PublicPlaylistApiErrorCode, number>> = {
  INVALID_INPUT: 400,
  PUBLIC_PLAYLIST_PRIVATE: 403,
  PUBLIC_PLAYLIST_NOT_FOUND: 404,
  PUBLIC_PLAYLIST_RATE_LIMITED: 429,
  PUBLIC_PLAYLIST_UNAVAILABLE: 502,
  PUBLIC_PLAYLIST_INVALID_RESPONSE: 502,
  LYRICS_RATE_LIMITED: 429,
  LYRICS_PROVIDER_UNAVAILABLE: 502,
  INSUFFICIENT_LYRICS: 422,
};

class PublicPlaylistRequestError extends Error {
  readonly kind: "invalid_input" | "insufficient_lyrics";

  constructor(kind: PublicPlaylistRequestError["kind"]) {
    super(
      kind === "insufficient_lyrics"
        ? "The playlist has no playable lyric questions."
        : "Invalid public playlist request.",
    );
    this.name = "PublicPlaylistRequestError";
    this.kind = kind;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

type PublicPlaylistRequest = Readonly<{
  identity: PublicPlaylistIdentity;
  seed: string;
  targetCount: number;
}>;

// This map is intentionally in-flight only and bounded. It prevents two
// concurrent browser clicks from doing duplicate upstream work without
// promising durable or cross-instance idempotency.
const inFlight = new Map<string, Promise<ChallengeView>>();

let resolver: PublicPlaylistResolver | undefined;

function getResolver(): PublicPlaylistResolver {
  resolver ??= createSpotifyEmbedPlaylistResolver();
  return resolver;
}

/** Test/server seam that does not expose provider configuration to clients. */
export function setPublicPlaylistResolverForTests(
  next: PublicPlaylistResolver | undefined,
): void {
  resolver = next;
}

function createErrorResponse(error: PublicPlaylistApiErrorCode): NextResponse {
  return NextResponse.json(
    { error },
    {
      status: errorStatuses[error],
      headers: NO_STORE_HEADERS,
    },
  );
}

function validateContentLength(request: Request): void {
  const contentLength = request.headers.get("content-length");

  if (
    contentLength !== null &&
    (!/^(?:0|[1-9]\d*)$/u.test(contentLength) ||
      Number(contentLength) > MAX_PUBLIC_PLAYLIST_REQUEST_BYTES)
  ) {
    throw new PublicPlaylistRequestError("invalid_input");
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  validateContentLength(request);

  let text: string;

  try {
    text = await request.text();
  } catch {
    throw new PublicPlaylistRequestError("invalid_input");
  }

  if (
    text.length > MAX_PUBLIC_PLAYLIST_REQUEST_BYTES ||
    new TextEncoder().encode(text).byteLength > MAX_PUBLIC_PLAYLIST_REQUEST_BYTES
  ) {
    throw new PublicPlaylistRequestError("invalid_input");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new PublicPlaylistRequestError("invalid_input");
  }
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
    throw new PublicPlaylistRequestError("invalid_input");
  }

  try {
    return normalizeChallengeSeed(value);
  } catch {
    throw new PublicPlaylistRequestError("invalid_input");
  }
}

function parseTargetCount(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_PUBLIC_PLAYLIST_TARGET_COUNT;
  }

  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_CHALLENGE_QUESTIONS
  ) {
    throw new PublicPlaylistRequestError("invalid_input");
  }

  return value;
}

function parseRequest(value: unknown): PublicPlaylistRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PublicPlaylistRequestError("invalid_input");
  }

  const body = value as Record<string, unknown>;
  const allowedKeys = new Set(["url", "seed", "targetCount"]);

  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    throw new PublicPlaylistRequestError("invalid_input");
  }

  let identity: PublicPlaylistIdentity;

  try {
    identity = parsePublicPlaylistUrl(body.url);
  } catch (error) {
    if (error instanceof PublicPlaylistUrlError) {
      throw new PublicPlaylistRequestError("invalid_input");
    }

    throw error;
  }

  return Object.freeze({
    identity,
    seed: parseSeed(body.seed),
    targetCount: parseTargetCount(body.targetCount),
  });
}

function publicSource(
  identity: PublicPlaylistIdentity,
  displayName: string | undefined,
): PublicPlaylistChallengeSource {
  return Object.freeze({
    kind: "public-playlist" as const,
    spotifyId: identity.playlistId,
    ...(displayName === undefined ? {} : { displayName }),
    canonicalUrl: identity.canonicalUrl,
  });
}

function mapResolverError(
  error: PublicPlaylistResolverError,
): PublicPlaylistApiErrorCode {
  switch (error.kind) {
    case "invalid_input":
      return "INVALID_INPUT";
    case "private":
      return "PUBLIC_PLAYLIST_PRIVATE";
    case "not_found":
      return "PUBLIC_PLAYLIST_NOT_FOUND";
    case "rate_limited":
      return "PUBLIC_PLAYLIST_RATE_LIMITED";
    case "configuration":
    case "unavailable":
      return "PUBLIC_PLAYLIST_UNAVAILABLE";
    case "invalid_response":
      return "PUBLIC_PLAYLIST_INVALID_RESPONSE";
  }
}

function mapBuildError(error: unknown): PublicPlaylistApiErrorCode {
  if (error instanceof PublicPlaylistRequestError) {
    return error.kind === "insufficient_lyrics"
      ? "INSUFFICIENT_LYRICS"
      : "INVALID_INPUT";
  }

  if (error instanceof LrclibError) {
    return error.kind === "rate_limited"
      ? "LYRICS_RATE_LIMITED"
      : error.kind === "input"
        ? "INVALID_INPUT"
        : "LYRICS_PROVIDER_UNAVAILABLE";
  }

  if (error instanceof ChallengeCandidateError) {
    switch (error.kind) {
      case "invalid_input":
      case "invalid_source":
      case "invalid_seed":
      case "invalid_target":
      case "invalid_lyrics_options":
        return "INVALID_INPUT";
      case "invalid_token":
      case "invalid_collection":
      case "invalid_lyrics_result":
      default:
        return "LYRICS_PROVIDER_UNAVAILABLE";
    }
  }

  if (error instanceof ChallengeStateError) {
    return error.kind === "insufficient_lyrics"
      ? "INSUFFICIENT_LYRICS"
      : "INVALID_INPUT";
  }

  if (error instanceof ChallengeStoreError) {
    return "PUBLIC_PLAYLIST_UNAVAILABLE";
  }

  return "PUBLIC_PLAYLIST_UNAVAILABLE";
}

async function createChallenge(
  request: PublicPlaylistRequest,
): Promise<ChallengeView> {
  const resolved = await getResolver().resolvePlaylist(request.identity);
  const source = publicSource(request.identity, resolved.name);
  const candidates = await buildChallengeCandidates({
    source,
    seed: request.seed,
    targetCount: request.targetCount,
    lyricsOptions: {
      clientIdentifier: LRCLIB_CLIENT_IDENTIFIER,
    },
    dependencies: {
      collectPublicPlaylistTracks: async () => ({
        tracks: resolved.tracks,
        pagesFetched: 1,
        sourceTruncated: resolved.sourceTruncated,
      }),
    },
  });

  if (candidates.status === "insufficient_lyrics") {
    throw new PublicPlaylistRequestError("insufficient_lyrics");
  }

  const state = challengeStore.create({
    source,
    seed: request.seed,
    candidates,
  });

  return renderChallenge(state);
}

function requestKey(request: PublicPlaylistRequest): string {
  return `${request.identity.canonicalUrl}\u0000${request.seed}\u0000${request.targetCount}`;
}

function rememberInFlight(
  key: string,
  promise: Promise<ChallengeView>,
): void {
  while (inFlight.size >= MAX_IN_FLIGHT_PUBLIC_PLAYLIST_REQUESTS) {
    const oldest = inFlight.keys().next().value;

    if (typeof oldest !== "string") {
      break;
    }

    inFlight.delete(oldest);
  }

  inFlight.set(key, promise);
  void promise
    .finally(() => {
      if (inFlight.get(key) === promise) {
        inFlight.delete(key);
      }
    })
    .catch(() => undefined);
}

export async function POST(request: Request): Promise<NextResponse> {
  let parsed: PublicPlaylistRequest;

  try {
    parsed = parseRequest(await readJsonBody(request));
  } catch (error) {
    if (error instanceof PublicPlaylistRequestError) {
      return createErrorResponse(
        error.kind === "insufficient_lyrics"
          ? "INSUFFICIENT_LYRICS"
          : "INVALID_INPUT",
      );
    }

    return createErrorResponse("INVALID_INPUT");
  }

  const key = requestKey(parsed);
  let work = inFlight.get(key);

  if (work === undefined) {
    work = createChallenge(parsed);
    rememberInFlight(key, work);
  }

  try {
    const challenge = await work;
    return NextResponse.json(
      { challenge },
      { status: 201, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof PublicPlaylistResolverError) {
      return createErrorResponse(mapResolverError(error));
    }

    return createErrorResponse(mapBuildError(error));
  }
}
