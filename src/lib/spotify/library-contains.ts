import { z } from "zod";

import type { SpotifyFetch } from "../auth/spotify";

/** The current Spotify user-library membership endpoint. */
export const SPOTIFY_LIBRARY_CONTAINS_URL =
  "https://api.spotify.com/v1/me/library/contains";

/** The source kinds that can be authorized for a challenge. */
export type SpotifyLibraryItemKind = "album" | "playlist";

const SPOTIFY_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

export type SpotifyLibraryContainsErrorKind =
  | "invalid_input"
  | "auth"
  | "scope"
  | "rate_limited"
  | "unavailable"
  | "invalid_response";

/**
 * Provider details intentionally collapse to a fixed category. This error
 * never retains a URL, URI, response body, status, token, or schema detail.
 */
export class SpotifyLibraryContainsError extends Error {
  readonly kind: SpotifyLibraryContainsErrorKind;

  constructor(kind: SpotifyLibraryContainsErrorKind) {
    super(
      kind === "invalid_input"
        ? "Spotify library membership input is invalid."
        : kind === "auth"
          ? "Spotify library membership authentication failed."
          : kind === "scope"
            ? "Spotify library membership scope is unavailable."
            : kind === "rate_limited"
              ? "Spotify library membership is rate limited."
              : kind === "invalid_response"
                ? "Spotify library membership response is invalid."
                : "Spotify library membership request failed.",
    );
    this.name = "SpotifyLibraryContainsError";
    this.kind = kind;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type SpotifyLibraryContainsDependencies = Readonly<{
  fetch?: SpotifyFetch;
}>;

export type SpotifyLibraryContainsInput = Readonly<{
  accessToken: string;
  kind: SpotifyLibraryItemKind;
  spotifyId: string;
  fetch?: SpotifyFetch;
  dependencies?: SpotifyLibraryContainsDependencies;
}>;

const spotifyLibraryItemKindSchema = z.enum(["album", "playlist"]);
const spotifyIdSchema = z.string().trim().min(1).regex(SPOTIFY_ID_PATTERN);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidInput(): never {
  throw new SpotifyLibraryContainsError("invalid_input");
}

function normalizeAccessToken(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return invalidInput();
  }

  return value.trim();
}

function normalizeKind(value: unknown): SpotifyLibraryItemKind {
  const parsed = spotifyLibraryItemKindSchema.safeParse(value);

  if (!parsed.success) {
    return invalidInput();
  }

  return parsed.data;
}

function normalizeSpotifyId(value: unknown): string {
  const parsed = spotifyIdSchema.safeParse(value);

  if (!parsed.success) {
    return invalidInput();
  }

  return parsed.data;
}

function normalizeDependencies(
  value: unknown,
): SpotifyLibraryContainsDependencies {
  if (value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    return invalidInput();
  }

  if (value.fetch !== undefined && typeof value.fetch !== "function") {
    return invalidInput();
  }

  return value as SpotifyLibraryContainsDependencies;
}

type NormalizedRequest = Readonly<{
  accessToken: string;
  kind: SpotifyLibraryItemKind;
  spotifyId: string;
  dependencies: SpotifyLibraryContainsDependencies;
}>;

function normalizeRequest(
  inputOrAccessToken: SpotifyLibraryContainsInput | string,
  positionalKind?: SpotifyLibraryItemKind,
  positionalSpotifyId?: string,
  positionalDependencies?: SpotifyLibraryContainsDependencies,
): NormalizedRequest {
  let accessToken: unknown;
  let kind: unknown;
  let spotifyId: unknown;
  let dependencyValue: unknown;
  let fetchValue: unknown;

  if (isRecord(inputOrAccessToken)) {
    accessToken = inputOrAccessToken.accessToken;
    kind = inputOrAccessToken.kind;
    spotifyId = inputOrAccessToken.spotifyId;
    dependencyValue = inputOrAccessToken.dependencies;
    fetchValue = inputOrAccessToken.fetch;

    const allowedKeys = new Set([
      "accessToken",
      "kind",
      "spotifyId",
      "fetch",
      "dependencies",
    ]);

    if (
      Object.keys(inputOrAccessToken).some((key) => !allowedKeys.has(key)) ||
      (dependencyValue !== undefined && fetchValue !== undefined)
    ) {
      return invalidInput();
    }
  } else {
    accessToken = inputOrAccessToken;
    kind = positionalKind;
    spotifyId = positionalSpotifyId;
    dependencyValue = positionalDependencies;
  }

  if (fetchValue !== undefined) {
    dependencyValue = { fetch: fetchValue };
  }

  return Object.freeze({
    accessToken: normalizeAccessToken(accessToken),
    kind: normalizeKind(kind),
    spotifyId: normalizeSpotifyId(spotifyId),
    dependencies: normalizeDependencies(dependencyValue),
  });
}

/**
 * Builds the provider URL from a validated kind and ID. Callers never supply
 * a Spotify URL or URI, so the URI shape remains controlled by this adapter.
 */
export function buildLibraryContainsUrl(
  kind: SpotifyLibraryItemKind,
  spotifyId: string,
): URL {
  const normalizedKind = normalizeKind(kind);
  const normalizedSpotifyId = normalizeSpotifyId(spotifyId);
  const url = new URL(SPOTIFY_LIBRARY_CONTAINS_URL);

  url.searchParams.set(
    "uris",
    `spotify:${normalizedKind}:${normalizedSpotifyId}`,
  );

  return url;
}

function classifyProviderStatus(status: unknown): SpotifyLibraryContainsErrorKind {
  if (status === 401) {
    return "auth";
  }

  if (status === 403) {
    return "scope";
  }

  if (status === 429) {
    return "rate_limited";
  }

  if (status === 400) {
    return "invalid_response";
  }

  if (
    typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 500 &&
    status <= 599
  ) {
    return "unavailable";
  }

  return "unavailable";
}

const containsResponseSchema = z.array(z.boolean()).length(1);

/**
 * Checks one album or playlist URI in the current user's Spotify library.
 * Provider data is reduced to one boolean and never leaves this boundary.
 */
export function checkLibraryContains(
  input: SpotifyLibraryContainsInput,
): Promise<boolean>;
export function checkLibraryContains(
  accessToken: string,
  kind: SpotifyLibraryItemKind,
  spotifyId: string,
  dependencies?: SpotifyLibraryContainsDependencies,
): Promise<boolean>;
export async function checkLibraryContains(
  inputOrAccessToken: SpotifyLibraryContainsInput | string,
  positionalKind?: SpotifyLibraryItemKind,
  positionalSpotifyId?: string,
  positionalDependencies?: SpotifyLibraryContainsDependencies,
): Promise<boolean> {
  const request = normalizeRequest(
    inputOrAccessToken,
    positionalKind,
    positionalSpotifyId,
    positionalDependencies,
  );
  const url = buildLibraryContainsUrl(request.kind, request.spotifyId);
  const fetchFunction = request.dependencies.fetch ?? fetch;
  let response: Response;

  try {
    response = await fetchFunction(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${request.accessToken}`,
      },
    });
  } catch {
    throw new SpotifyLibraryContainsError("unavailable");
  }

  if (!response.ok) {
    throw new SpotifyLibraryContainsError(
      classifyProviderStatus(response.status),
    );
  }

  let rawResponse: unknown;

  try {
    rawResponse = await response.json();
  } catch {
    throw new SpotifyLibraryContainsError("invalid_response");
  }

  const parsed = containsResponseSchema.safeParse(rawResponse);

  if (!parsed.success) {
    throw new SpotifyLibraryContainsError("invalid_response");
  }

  return parsed.data[0];
}

/** Descriptive aliases for callers that use provider-oriented terminology. */
export const checkSpotifyLibraryContains = checkLibraryContains;
export const isSpotifyLibraryItemInLibrary = checkLibraryContains;
