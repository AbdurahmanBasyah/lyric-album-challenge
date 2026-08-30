import { randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { AppEnvironment } from "@/lib/env";

export const SPOTIFY_AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
export const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
export const SPOTIFY_SCOPE =
  "user-library-read playlist-read-private playlist-read-collaborative";

export type SpotifyAuthorizationOptions = Readonly<{
  showDialog?: boolean;
}>;

export type SpotifySessionTokens = Readonly<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope?: string;
}>;

export type SpotifyFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type SpotifyRequestDependencies = Readonly<{
  fetch?: SpotifyFetch;
  now?: () => number;
}>;

export class SpotifyTokenError extends Error {
  readonly operation: "exchange" | "refresh";

  constructor(operation: "exchange" | "refresh") {
    super(`Spotify token ${operation} failed.`);
    this.name = "SpotifyTokenError";
    this.operation = operation;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const spotifyTokenResponseSchema = z
  .object({
    access_token: z.string().trim().min(1),
    token_type: z.string().trim().min(1),
    expires_in: z.number().int().positive(),
    refresh_token: z.string().trim().min(1).optional(),
    scope: z.string().optional(),
  })
  .strict();

type SpotifyTokenResponse = z.infer<typeof spotifyTokenResponseSchema>;

/**
 * Generates the OAuth state with independent cryptographic randomness. This
 * must not use the deterministic game PRNG because state is a CSRF secret.
 */
export function createOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Compares OAuth state values without early-exit comparison when their byte
 * lengths match. Missing values are always rejected.
 */
export function statesMatch(expected: string | undefined, provided: string | undefined): boolean {
  if (!expected || !provided) {
    return false;
  }

  const expectedBytes = Buffer.from(expected, "utf8");
  const providedBytes = Buffer.from(provided, "utf8");

  if (expectedBytes.length !== providedBytes.length) {
    return false;
  }

  return timingSafeEqual(expectedBytes, providedBytes);
}

export function buildSpotifyAuthorizationUrl(
  environment: Pick<
    AppEnvironment,
    "SPOTIFY_CLIENT_ID" | "SPOTIFY_REDIRECT_URI"
  >,
  state: string,
  options: SpotifyAuthorizationOptions = {},
): URL {
  if (!state) {
    throw new Error("OAuth state is required.");
  }

  const authorizationUrl = new URL(SPOTIFY_AUTHORIZE_URL);
  authorizationUrl.searchParams.set("client_id", environment.SPOTIFY_CLIENT_ID);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set(
    "redirect_uri",
    environment.SPOTIFY_REDIRECT_URI,
  );
  authorizationUrl.searchParams.set("scope", SPOTIFY_SCOPE);
  authorizationUrl.searchParams.set("state", state);

  if (options.showDialog === true) {
    authorizationUrl.searchParams.set("show_dialog", "true");
  }

  return authorizationUrl;
}

function toSessionTokens(
  response: SpotifyTokenResponse,
  refreshToken: string,
  now: () => number,
): SpotifySessionTokens {
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? refreshToken,
    expiresAt: now() + response.expires_in * 1000,
    ...(response.scope === undefined ? {} : { scope: response.scope }),
  };
}

function getBasicAuthorization(environment: Pick<AppEnvironment, "SPOTIFY_CLIENT_ID" | "SPOTIFY_CLIENT_SECRET">): string {
  const credentials = `${environment.SPOTIFY_CLIENT_ID}:${environment.SPOTIFY_CLIENT_SECRET}`;
  return `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`;
}

async function requestToken(
  operation: "exchange" | "refresh",
  environment: Pick<AppEnvironment, "SPOTIFY_CLIENT_ID" | "SPOTIFY_CLIENT_SECRET">,
  body: URLSearchParams,
  dependencies: SpotifyRequestDependencies,
): Promise<SpotifyTokenResponse> {
  const fetchFunction = dependencies.fetch ?? fetch;

  let response: Response;

  try {
    response = await fetchFunction(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: getBasicAuthorization(environment),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
  } catch {
    throw new SpotifyTokenError(operation);
  }

  if (!response.ok) {
    throw new SpotifyTokenError(operation);
  }

  let rawResponse: unknown;

  try {
    rawResponse = await response.json();
  } catch {
    throw new SpotifyTokenError(operation);
  }

  const parsed = spotifyTokenResponseSchema.safeParse(rawResponse);

  if (!parsed.success) {
    throw new SpotifyTokenError(operation);
  }

  return parsed.data;
}

export async function exchangeAuthorizationCode(
  code: string,
  environment: Pick<
    AppEnvironment,
    "SPOTIFY_CLIENT_ID" | "SPOTIFY_CLIENT_SECRET" | "SPOTIFY_REDIRECT_URI"
  >,
  dependencies: SpotifyRequestDependencies = {},
): Promise<SpotifySessionTokens> {
  if (!code) {
    throw new SpotifyTokenError("exchange");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: environment.SPOTIFY_REDIRECT_URI,
  });
  const response = await requestToken("exchange", environment, body, dependencies);
  const refreshToken = response.refresh_token;

  if (!refreshToken) {
    throw new SpotifyTokenError("exchange");
  }

  return toSessionTokens(response, refreshToken, dependencies.now ?? Date.now);
}

export async function refreshAccessToken(
  refreshToken: string,
  environment: Pick<AppEnvironment, "SPOTIFY_CLIENT_ID" | "SPOTIFY_CLIENT_SECRET">,
  dependencies: SpotifyRequestDependencies = {},
): Promise<SpotifySessionTokens> {
  if (!refreshToken) {
    throw new SpotifyTokenError("refresh");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const response = await requestToken("refresh", environment, body, dependencies);

  return toSessionTokens(response, refreshToken, dependencies.now ?? Date.now);
}
