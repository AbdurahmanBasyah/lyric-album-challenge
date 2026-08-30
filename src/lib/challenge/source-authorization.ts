import {
  checkLibraryContains,
  SpotifyLibraryContainsError,
  type SpotifyLibraryItemKind,
} from "../spotify/library-contains";

const SPOTIFY_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

export type ChallengeSourceInput = Readonly<{
  kind: "album" | "playlist";
  spotifyId: string;
  displayName?: string;
}>;

/** The only source shape accepted by the bounded track collector. */
export type AuthorizedChallengeSource =
  | Readonly<{ kind: "album"; spotifyId: string; name: string }>
  | Readonly<{ kind: "playlist"; spotifyId: string }>;

export type SourceAuthorizationErrorKind =
  | "invalid_input"
  | "invalid_source"
  | "invalid_token"
  | "not_in_library"
  | "auth"
  | "scope"
  | "rate_limited"
  | "unavailable"
  | "invalid_response";

/**
 * A stable provider-neutral authorization error. No source display value,
 * Spotify URI, access token, provider body, or exception detail is retained.
 */
export class SourceAuthorizationError extends Error {
  readonly kind: SourceAuthorizationErrorKind;

  constructor(kind: SourceAuthorizationErrorKind) {
    super(
      kind === "invalid_source"
        ? "Challenge source is invalid."
        : kind === "invalid_token"
          ? "Challenge source access token is invalid."
          : kind === "not_in_library"
            ? "Challenge source is not in the current library."
            : kind === "auth"
              ? "Challenge source authorization failed."
              : kind === "scope"
                ? "Challenge source scope is unavailable."
                : kind === "rate_limited"
                  ? "Challenge source authorization is rate limited."
                  : kind === "invalid_response"
                    ? "Challenge source authorization response is invalid."
                    : kind === "unavailable"
                      ? "Challenge source authorization is unavailable."
                      : "Challenge source authorization input is invalid.",
    );
    this.name = "SourceAuthorizationError";
    this.kind = kind;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type SourceMembershipChecker = (
  accessToken: string,
  kind: SpotifyLibraryItemKind,
  spotifyId: string,
) => Promise<boolean>;

export type SourceAuthorizationDependencies = Readonly<{
  checkLibraryContains?: SourceMembershipChecker;
}>;

export type AuthorizeChallengeSourceRequest = Readonly<{
  source: ChallengeSourceInput;
  accessToken: string;
  dependencies?: SourceAuthorizationDependencies;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidInput(): never {
  throw new SourceAuthorizationError("invalid_input");
}

function normalizeAccessToken(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new SourceAuthorizationError("invalid_token");
  }

  return value.trim();
}

function normalizeSpotifyId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    !SPOTIFY_ID_PATTERN.test(value.trim())
  ) {
    throw new SourceAuthorizationError("invalid_source");
  }

  return value.trim();
}

function normalizeDisplayName(value: unknown, required: boolean): string | undefined {
  if (value === undefined) {
    if (required) {
      throw new SourceAuthorizationError("invalid_source");
    }

    return undefined;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SourceAuthorizationError("invalid_source");
  }

  return value.trim();
}

function normalizeSource(value: unknown): ChallengeSourceInput {
  if (!isRecord(value)) {
    throw new SourceAuthorizationError("invalid_source");
  }

  const allowedKeys = new Set(["kind", "spotifyId", "displayName"]);

  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new SourceAuthorizationError("invalid_source");
  }

  if (value.kind !== "album" && value.kind !== "playlist") {
    throw new SourceAuthorizationError("invalid_source");
  }

  const spotifyId = normalizeSpotifyId(value.spotifyId);
  const displayName = normalizeDisplayName(value.displayName, value.kind === "album");

  return Object.freeze({
    kind: value.kind,
    spotifyId,
    ...(displayName === undefined ? {} : { displayName }),
  });
}

function normalizeDependencies(value: unknown): SourceAuthorizationDependencies {
  if (value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    return invalidInput();
  }

  const allowedKeys = new Set(["checkLibraryContains"]);

  if (
    Object.keys(value).some((key) => !allowedKeys.has(key)) ||
    (value.checkLibraryContains !== undefined &&
      typeof value.checkLibraryContains !== "function")
  ) {
    return invalidInput();
  }

  return value as SourceAuthorizationDependencies;
}

type NormalizedRequest = Readonly<{
  source: ChallengeSourceInput;
  accessToken: string;
  dependencies: SourceAuthorizationDependencies;
}>;

function normalizeRequest(
  sourceOrRequest: ChallengeSourceInput | AuthorizeChallengeSourceRequest,
  positionalAccessToken?: string,
  positionalDependencies?: SourceAuthorizationDependencies,
): NormalizedRequest {
  let source: unknown;
  let accessToken: unknown;
  let dependencyValue: unknown;

  if (
    isRecord(sourceOrRequest) &&
    Object.prototype.hasOwnProperty.call(sourceOrRequest, "source")
  ) {
    const requestInput = sourceOrRequest as AuthorizeChallengeSourceRequest;
    const allowedKeys = new Set(["source", "accessToken", "dependencies"]);

    if (Object.keys(sourceOrRequest).some((key) => !allowedKeys.has(key))) {
      return invalidInput();
    }

    source = requestInput.source;
    accessToken = requestInput.accessToken;
    dependencyValue = requestInput.dependencies;
  } else {
    source = sourceOrRequest;
    accessToken = positionalAccessToken;
    dependencyValue = positionalDependencies;
  }

  return Object.freeze({
    source: normalizeSource(source),
    accessToken: normalizeAccessToken(accessToken),
    dependencies: normalizeDependencies(dependencyValue),
  });
}

function mapProviderError(error: unknown): never {
  if (error instanceof SpotifyLibraryContainsError) {
    // Preserve both identity and category for the route-level mapper.
    throw error;
  }

  if (error instanceof SourceAuthorizationError) {
    throw error;
  }

  // Injected dependencies are untrusted implementation boundaries. Do not
  // let their exception text cross the provider-neutral authorization seam.
  throw new SourceAuthorizationError("unavailable");
}

/**
 * Authorizes one browser-selected source against the current user's Spotify
 * library before any track or lyrics work is allowed to begin.
 */
export function authorizeChallengeSource(
  request: AuthorizeChallengeSourceRequest,
): Promise<AuthorizedChallengeSource>;
export function authorizeChallengeSource(
  source: ChallengeSourceInput,
  accessToken: string,
  dependencies?: SourceAuthorizationDependencies,
): Promise<AuthorizedChallengeSource>;
export async function authorizeChallengeSource(
  sourceOrRequest: ChallengeSourceInput | AuthorizeChallengeSourceRequest,
  positionalAccessToken?: string,
  positionalDependencies?: SourceAuthorizationDependencies,
): Promise<AuthorizedChallengeSource> {
  const request = normalizeRequest(
    sourceOrRequest,
    positionalAccessToken,
    positionalDependencies,
  );
  const membershipChecker =
    request.dependencies.checkLibraryContains ?? checkLibraryContains;
  let isInLibrary: boolean;

  try {
    isInLibrary = await membershipChecker(
      request.accessToken,
      request.source.kind,
      request.source.spotifyId,
    );
  } catch (error) {
    return mapProviderError(error);
  }

  if (typeof isInLibrary !== "boolean") {
    throw new SourceAuthorizationError("invalid_response");
  }

  if (!isInLibrary) {
    throw new SourceAuthorizationError("not_in_library");
  }

  if (request.source.kind === "album") {
    return Object.freeze({
      kind: "album" as const,
      spotifyId: request.source.spotifyId,
      name: request.source.displayName as string,
    });
  }

  return Object.freeze({
    kind: "playlist" as const,
    spotifyId: request.source.spotifyId,
  });
}

/** Alias for callers that use the shorter authorization verb. */
export const authorizeSource = authorizeChallengeSource;
