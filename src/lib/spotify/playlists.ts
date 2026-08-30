import { z } from "zod";

import type { SpotifyFetch } from "../auth/spotify";
import {
  fetchWithRetry,
  type RetryClock,
  type RetrySleep,
} from "../http/retry";
import type { SavedPlaylistsPage, PlaylistSummary } from "../../types/playlists";

export const SPOTIFY_SAVED_PLAYLISTS_URL =
  "https://api.spotify.com/v1/me/playlists";

/**
 * Keep playlist pages small enough for the picker while staying below
 * Spotify's current maximum page size of 50.
 */
export const SAVED_PLAYLISTS_PAGE_SIZE = 24;
export const UNTITLED_PLAYLIST_NAME = "Untitled playlist";
const MAX_SAFE_OFFSET = Number.MAX_SAFE_INTEGER;
const SPOTIFY_PLAYLIST_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export type SpotifyPlaylistsErrorKind =
  | "auth"
  | "scope"
  | "rate_limited"
  | "unavailable"
  | "invalid_cursor";

/**
 * Non-sensitive branches that can collapse into the public unavailable error.
 * These values are safe to expose only through the development diagnostic
 * header; provider bodies and exception details remain opaque.
 */
export type SpotifyPlaylistsDiagnosticReason =
  | "provider_http_status"
  | "network_failure"
  | "invalid_json"
  | "invalid_response_schema"
  | "invalid_pagination"
  | "mapping";

const spotifyPlaylistsDiagnosticReasons = new Set<
  SpotifyPlaylistsDiagnosticReason
>([
  "provider_http_status",
  "network_failure",
  "invalid_json",
  "invalid_response_schema",
  "invalid_pagination",
  "mapping",
]);

/**
 * A deliberately closed set of schema-failure fingerprints. These values are
 * safe to include in a development-only diagnostic header because they carry
 * only a coarse field/category, never provider values or paths.
 */
export type SpotifyPlaylistsSchemaDiagnostic =
  | "page_items_missing"
  | "page_items_type"
  | "page_items_invalid"
  | "page_limit_missing"
  | "page_limit_type"
  | "page_limit_invalid"
  | "page_next_missing"
  | "page_next_type"
  | "page_next_invalid"
  | "page_offset_missing"
  | "page_offset_type"
  | "page_offset_invalid"
  | "page_total_missing"
  | "page_total_type"
  | "page_total_invalid"
  | "playlist_item_type"
  | "playlist_id_missing"
  | "playlist_id_type"
  | "playlist_id_invalid"
  | "playlist_name_missing"
  | "playlist_name_type"
  | "playlist_name_invalid"
  | "playlist_owner_missing"
  | "playlist_owner_type"
  | "playlist_owner_invalid"
  | "playlist_count_missing"
  | "playlist_count_type"
  | "playlist_count_invalid"
  | "playlist_public_type"
  | "playlist_public_invalid"
  | "playlist_images_type"
  | "playlist_images_invalid"
  | "image_url_missing"
  | "image_url_type"
  | "image_url_invalid"
  | "response_shape_other";

const RESPONSE_SHAPE_OTHER: SpotifyPlaylistsSchemaDiagnostic =
  "response_shape_other";

const spotifyPlaylistsSchemaDiagnostics = new Set<
  SpotifyPlaylistsSchemaDiagnostic
>([
  "page_items_missing",
  "page_items_type",
  "page_items_invalid",
  "page_limit_missing",
  "page_limit_type",
  "page_limit_invalid",
  "page_next_missing",
  "page_next_type",
  "page_next_invalid",
  "page_offset_missing",
  "page_offset_type",
  "page_offset_invalid",
  "page_total_missing",
  "page_total_type",
  "page_total_invalid",
  "playlist_item_type",
  "playlist_id_missing",
  "playlist_id_type",
  "playlist_id_invalid",
  "playlist_name_missing",
  "playlist_name_type",
  "playlist_name_invalid",
  "playlist_owner_missing",
  "playlist_owner_type",
  "playlist_owner_invalid",
  "playlist_count_missing",
  "playlist_count_type",
  "playlist_count_invalid",
  "playlist_public_type",
  "playlist_public_invalid",
  "playlist_images_type",
  "playlist_images_invalid",
  "image_url_missing",
  "image_url_type",
  "image_url_invalid",
  RESPONSE_SHAPE_OTHER,
]);

type SpotifyPlaylistsSchemaIssueCategory = "missing" | "type" | "invalid";
type SpotifyPlaylistsSchemaIssueCategoryResult =
  | SpotifyPlaylistsSchemaIssueCategory
  | undefined;

type SpotifyPlaylistsSchemaIssue = Readonly<{
  code?: unknown;
  expected?: unknown;
  input?: unknown;
  path?: unknown;
}>;

type SpotifyPlaylistsSchemaDiagnosticField =
  | "page_items"
  | "page_limit"
  | "page_next"
  | "page_offset"
  | "page_total"
  | "playlist_item"
  | "playlist_id"
  | "playlist_name"
  | "playlist_owner"
  | "playlist_count"
  | "playlist_public"
  | "playlist_images"
  | "image_url";

const spotifyPlaylistsSchemaDiagnosticByField: Readonly<
  Record<
    SpotifyPlaylistsSchemaDiagnosticField,
    Readonly<
      Partial<
        Record<
          SpotifyPlaylistsSchemaIssueCategory,
          SpotifyPlaylistsSchemaDiagnostic
        >
      >
    >
  >
> = {
  page_items: {
    missing: "page_items_missing",
    type: "page_items_type",
    invalid: "page_items_invalid",
  },
  page_limit: {
    missing: "page_limit_missing",
    type: "page_limit_type",
    invalid: "page_limit_invalid",
  },
  page_next: {
    missing: "page_next_missing",
    type: "page_next_type",
    invalid: "page_next_invalid",
  },
  page_offset: {
    missing: "page_offset_missing",
    type: "page_offset_type",
    invalid: "page_offset_invalid",
  },
  page_total: {
    missing: "page_total_missing",
    type: "page_total_type",
    invalid: "page_total_invalid",
  },
  playlist_item: {
    type: "playlist_item_type",
  },
  playlist_id: {
    missing: "playlist_id_missing",
    type: "playlist_id_type",
    invalid: "playlist_id_invalid",
  },
  playlist_name: {
    missing: "playlist_name_missing",
    type: "playlist_name_type",
    invalid: "playlist_name_invalid",
  },
  playlist_owner: {
    missing: "playlist_owner_missing",
    type: "playlist_owner_type",
    invalid: "playlist_owner_invalid",
  },
  playlist_count: {
    missing: "playlist_count_missing",
    type: "playlist_count_type",
    invalid: "playlist_count_invalid",
  },
  playlist_public: {
    type: "playlist_public_type",
    invalid: "playlist_public_invalid",
  },
  playlist_images: {
    type: "playlist_images_type",
    invalid: "playlist_images_invalid",
  },
  image_url: {
    missing: "image_url_missing",
    type: "image_url_type",
    invalid: "image_url_invalid",
  },
};

function schemaDiagnosticForField(
  field: SpotifyPlaylistsSchemaDiagnosticField,
  category: SpotifyPlaylistsSchemaIssueCategory,
): SpotifyPlaylistsSchemaDiagnostic {
  return (
    spotifyPlaylistsSchemaDiagnosticByField[field][category] ??
    RESPONSE_SHAPE_OTHER
  );
}

function isStringPathSegment(value: unknown, expected: string): boolean {
  return typeof value === "string" && value === expected;
}

function isPlaylistPath(
  path: readonly unknown[],
  field: string,
): boolean {
  return (
    path.length === 3 &&
    isStringPathSegment(path[0], "items") &&
    typeof path[1] === "number" &&
    Number.isInteger(path[1]) &&
    isStringPathSegment(path[2], field)
  );
}

function isPlaylistNestedPath(
  path: readonly unknown[],
  parent: string,
  field: string,
): boolean {
  return (
    path.length === 4 &&
    isStringPathSegment(path[0], "items") &&
    typeof path[1] === "number" &&
    Number.isInteger(path[1]) &&
    isStringPathSegment(path[2], parent) &&
    isStringPathSegment(path[3], field)
  );
}

function schemaIssueCategory(
  issue: SpotifyPlaylistsSchemaIssue,
): SpotifyPlaylistsSchemaIssueCategoryResult {
  if (issue.code === "invalid_type") {
    // Zod only includes `input` when reportInput is enabled. The adapter uses
    // that option solely to distinguish an omitted field from a wrong type;
    // this function reads only undefined/type information and never retains
    // the provider value.
    if (
      Object.prototype.hasOwnProperty.call(issue, "input") &&
      issue.input === undefined
    ) {
      return "missing";
    }

    // Integer and finite-number checks use invalid_type even though the value
    // is already a number. Keep those failures separate from a type mismatch.
    if (issue.expected === "int") {
      return "invalid";
    }

    if (issue.expected === "number" && typeof issue.input === "number") {
      return "invalid";
    }

    return "type";
  }

  // These are the only non-type issue codes emitted by the schemas in this
  // adapter. Unknown/custom provider-shaped issues must not accidentally turn
  // into an apparently actionable field token.
  if (
    issue.code === "custom" ||
    issue.code === "invalid_format" ||
    issue.code === "invalid_value" ||
    issue.code === "not_multiple_of" ||
    issue.code === "too_big" ||
    issue.code === "too_small"
  ) {
    return "invalid";
  }

  return undefined;
}

/**
 * Reduces one Zod issue to a fixed, field-level token. Path indices are only
 * checked as numeric shape markers and are never returned. Unknown issue
 * codes/paths intentionally collapse to response_shape_other.
 */
export function fingerprintSpotifyPlaylistsSchemaIssue(
  issue: unknown,
): SpotifyPlaylistsSchemaDiagnostic {
  if (!isRecord(issue)) {
    return RESPONSE_SHAPE_OTHER;
  }

  const schemaIssue = issue as SpotifyPlaylistsSchemaIssue;
  const path = Array.isArray(schemaIssue.path) ? schemaIssue.path : [];
  const category = schemaIssueCategory(schemaIssue);

  if (category === undefined) {
    return RESPONSE_SHAPE_OTHER;
  }

  if (path.length === 1) {
    if (isStringPathSegment(path[0], "items")) {
      return schemaDiagnosticForField("page_items", category);
    }

    if (isStringPathSegment(path[0], "limit")) {
      return schemaDiagnosticForField("page_limit", category);
    }

    if (isStringPathSegment(path[0], "next")) {
      return schemaDiagnosticForField("page_next", category);
    }

    if (isStringPathSegment(path[0], "offset")) {
      return schemaDiagnosticForField("page_offset", category);
    }

    if (isStringPathSegment(path[0], "total")) {
      return schemaDiagnosticForField("page_total", category);
    }

    // Image URL validation runs against one image object at a time, so its
    // local URL path is simply ["url"].
    if (isStringPathSegment(path[0], "url")) {
      return schemaDiagnosticForField("image_url", category);
    }
  }

  if (
    path.length === 2 &&
    isStringPathSegment(path[0], "items") &&
    typeof path[1] === "number" &&
    Number.isInteger(path[1])
  ) {
    return schemaDiagnosticForField("playlist_item", category);
  }

  for (const field of ["id", "name", "owner", "public", "images"] as const) {
    if (isPlaylistPath(path, field)) {
      const diagnosticField =
        field === "id"
          ? "playlist_id"
          : field === "name"
            ? "playlist_name"
            : field === "owner"
              ? "playlist_owner"
              : field === "public"
                ? "playlist_public"
                : "playlist_images";

      return schemaDiagnosticForField(diagnosticField, category);
    }
  }

  if (
    (isPlaylistPath(path, "items") || isPlaylistPath(path, "tracks")) ||
    isPlaylistNestedPath(path, "items", "total") ||
    isPlaylistNestedPath(path, "tracks", "total")
  ) {
    return schemaDiagnosticForField("playlist_count", category);
  }

  if (isPlaylistNestedPath(path, "owner", "display_name")) {
    return schemaDiagnosticForField("playlist_owner", category);
  }

  return RESPONSE_SHAPE_OTHER;
}

function normalizeSpotifyPlaylistsSchemaDiagnostic(
  diagnostic: SpotifyPlaylistsSchemaDiagnostic | undefined,
): SpotifyPlaylistsSchemaDiagnostic | undefined {
  if (diagnostic === undefined) {
    return undefined;
  }

  return spotifyPlaylistsSchemaDiagnostics.has(diagnostic)
    ? diagnostic
    : RESPONSE_SHAPE_OTHER;
}

type SpotifyPlaylistsErrorOptions = Readonly<{
  reason?: SpotifyPlaylistsDiagnosticReason;
  providerStatus?: number;
  schemaDiagnostic?: SpotifyPlaylistsSchemaDiagnostic;
}>;

function defaultDiagnosticReason(
  kind: SpotifyPlaylistsErrorKind,
): SpotifyPlaylistsDiagnosticReason {
  if (kind === "invalid_cursor") {
    return "invalid_pagination";
  }

  if (kind === "auth" || kind === "scope" || kind === "rate_limited") {
    return "provider_http_status";
  }

  return "mapping";
}

function normalizeSpotifyPlaylistsDiagnosticReason(
  reason: SpotifyPlaylistsDiagnosticReason | undefined,
  kind: SpotifyPlaylistsErrorKind,
): SpotifyPlaylistsDiagnosticReason {
  return reason !== undefined && spotifyPlaylistsDiagnosticReasons.has(reason)
    ? reason
    : defaultDiagnosticReason(kind);
}

function safeProviderStatus(status: number | undefined): number | undefined {
  return typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 100 &&
    status <= 599
    ? status
    : undefined;
}

/**
 * Provider details are intentionally reduced to categories. No response body
 * is retained on this error, which keeps provider payloads out of logs and
 * route responses.
 */
export class SpotifyPlaylistsError extends Error {
  readonly kind: SpotifyPlaylistsErrorKind;
  readonly reason: SpotifyPlaylistsDiagnosticReason;
  readonly providerStatus: number | undefined;
  readonly schemaDiagnostic: SpotifyPlaylistsSchemaDiagnostic | undefined;

  constructor(
    kind: SpotifyPlaylistsErrorKind,
    options: SpotifyPlaylistsErrorOptions = {},
  ) {
    super(
      kind === "invalid_cursor"
        ? "Spotify playlists cursor is invalid."
        : "Spotify playlists request failed.",
    );
    this.name = "SpotifyPlaylistsError";
    this.kind = kind;
    this.reason = normalizeSpotifyPlaylistsDiagnosticReason(
      options.reason,
      kind,
    );
    this.providerStatus = safeProviderStatus(options.providerStatus);
    this.schemaDiagnostic = normalizeSpotifyPlaylistsSchemaDiagnostic(
      options.schemaDiagnostic,
    );
    // Keep diagnostic metadata out of accidental error serialization. The
    // route opts into the fixed development header explicitly.
    Object.defineProperty(this, "reason", { enumerable: false });
    Object.defineProperty(this, "providerStatus", { enumerable: false });
    Object.defineProperty(this, "schemaDiagnostic", { enumerable: false });
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type SpotifyPlaylistsRequestDependencies = Readonly<{
  fetch?: SpotifyFetch;
  sleep?: RetrySleep;
  now?: RetryClock;
}>;

const safeNonNegativeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .refine(Number.isSafeInteger);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const spotifyImageUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);

      return (
        (url.protocol === "http:" || url.protocol === "https:") &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  });

const spotifyImageSchema = z
  .object({
    url: spotifyImageUrlSchema,
  })
  .passthrough();

const spotifyPlaylistOwnerSchema = z
  .object({
    // Spotify may omit a display name or return an empty one. The owner
    // object remains required, but this non-critical label maps to null.
    display_name: z.string().nullable().optional(),
  })
  .passthrough();

const spotifyPlaylistItemCountSchema = z
  .object({
    total: safeNonNegativeIntegerSchema,
  })
  .passthrough();

function isSpotifyPaginationUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return (
      url.protocol === "https:" &&
      url.hostname === "api.spotify.com" &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}

const spotifyPaginationUrlSchema = z
  .string()
  .trim()
  .url()
  .refine(isSpotifyPaginationUrl);

const spotifyPlaylistSchema = z
  .object({
    // Spotify IDs are opaque to the application, but must remain one path
    // segment when we build the attribution URL below. Keep the check broad
    // enough for provider IDs and test doubles while rejecting URL syntax.
    id: z
      .string()
      .trim()
      .min(1)
      .regex(SPOTIFY_PLAYLIST_ID_PATTERN),
    // Spotify requires a string but does not require a non-empty name. Keep
    // unnamed playlists visible and apply the app-owned fallback while
    // mapping them below.
    name: z.string().trim(),
    // The API normally returns an array (possibly empty), but some valid
    // playlist responses return null or omit images. Cover art is optional
    // metadata, so preserve the playlist with a null image URL.
    // Individual image objects can be empty in otherwise valid provider
    // responses. They are validated while mapping so missing cover URLs can
    // degrade to null without weakening identity/count validation.
    images: z.array(z.unknown()).nullable().optional(),
    owner: spotifyPlaylistOwnerSchema,
    // Newer Spotify responses expose the playlist item count as `items`.
    items: spotifyPlaylistItemCountSchema.nullable().optional(),
    // `tracks.total` is retained only as a compatibility fallback for older
    // Spotify responses that have not adopted the `items` field.
    tracks: spotifyPlaylistItemCountSchema.nullable().optional(),
    public: z.boolean().nullable().optional(),
  })
  .passthrough();

const spotifySavedPlaylistsResponseSchema = z
  .object({
    // Spotify can include null placeholders for playlists that are no longer
    // available to the user. They have no identity to map, so they are
    // omitted from the application page while still counting for pagination.
    items: z.array(spotifyPlaylistSchema.nullable()),
    limit: z.number().int().min(1).max(50),
    next: spotifyPaginationUrlSchema.nullable(),
    offset: safeNonNegativeIntegerSchema,
    total: safeNonNegativeIntegerSchema,
  })
  .passthrough();

type SpotifySavedPlaylistsResponse = z.infer<
  typeof spotifySavedPlaylistsResponseSchema
>;

/**
 * Parses the application's opaque offset cursor. Only canonical decimal
 * offsets cross the browser/API boundary; Spotify pagination URLs stay inside
 * this adapter.
 */
export function parseOffsetCursor(cursor?: string): number {
  if (typeof cursor !== "string" && cursor !== undefined) {
    throw new SpotifyPlaylistsError("invalid_cursor");
  }

  if (cursor === undefined || !/^(?:0|[1-9]\d*)$/.test(cursor)) {
    if (cursor === undefined) {
      return 0;
    }

    throw new SpotifyPlaylistsError("invalid_cursor");
  }

  const offset = Number(cursor);

  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > MAX_SAFE_OFFSET
  ) {
    throw new SpotifyPlaylistsError("invalid_cursor");
  }

  return offset;
}

export function buildSavedPlaylistsUrl(cursor?: string): URL {
  const offset = parseOffsetCursor(cursor);
  const url = new URL(SPOTIFY_SAVED_PLAYLISTS_URL);
  url.searchParams.set("limit", String(SAVED_PLAYLISTS_PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  return url;
}

/**
 * Builds the app-owned attribution link from the validated Spotify playlist
 * ID. Provider `external_urls` and pagination URLs are never returned.
 */
export function buildSpotifyPlaylistUrl(spotifyId: string): string {
  const normalizedId =
    typeof spotifyId === "string" ? spotifyId.trim() : "";

  if (
    normalizedId.length === 0 ||
    !SPOTIFY_PLAYLIST_ID_PATTERN.test(normalizedId)
  ) {
    throw new SpotifyPlaylistsError("unavailable", { reason: "mapping" });
  }

  const url = new URL(
    `/playlist/${encodeURIComponent(normalizedId)}`,
    "https://open.spotify.com/",
  );

  if (url.protocol !== "https:" || url.hostname !== "open.spotify.com") {
    throw new SpotifyPlaylistsError("unavailable", { reason: "mapping" });
  }

  return url.toString();
}

function mapPlaylistItem(
  playlist: Exclude<SpotifySavedPlaylistsResponse["items"][number], null>,
): PlaylistSummary {
  // Prefer Spotify's current `items.total`, then retain the legacy
  // `tracks.total` fallback. Both fields are optional because Spotify can
  // return metadata without exposing a playlist's item collection.
  const totalItems = playlist.items?.total ?? playlist.tracks?.total ?? null;
  const ownerName = playlist.owner.display_name?.trim() || null;

  return {
    spotifyId: playlist.id,
    name: playlist.name || UNTITLED_PLAYLIST_NAME,
    ownerName,
    imageUrl: getImageUrl(playlist.images),
    totalItems,
    itemsAvailable: totalItems !== null,
    isPublic: playlist.public ?? null,
    spotifyUrl: buildSpotifyPlaylistUrl(playlist.id),
  };
}

function getImageUrl(
  images: unknown[] | null | undefined,
): string | null {
  for (const image of images ?? []) {
    if (!isRecord(image) || !("url" in image)) {
      continue;
    }

    const rawUrl = image.url;

    if (
      rawUrl === null ||
      rawUrl === undefined ||
      (typeof rawUrl === "string" && rawUrl.trim().length === 0)
    ) {
      continue;
    }

    const parsed = spotifyImageSchema.safeParse(image, { reportInput: true });

    if (!parsed.success) {
      throw new SpotifyPlaylistsError("unavailable", {
        reason: "invalid_response_schema",
        schemaDiagnostic: fingerprintSpotifyPlaylistsSchemaIssue(
          parsed.error.issues[0],
        ),
      });
    }

    return parsed.data.url;
  }

  return null;
}

function classifyProviderResponse(response: Response): SpotifyPlaylistsError {
  const options = {
    reason: "provider_http_status" as const,
    providerStatus: response.status,
  };

  if (response.status === 401) {
    return new SpotifyPlaylistsError("auth", options);
  }

  if (response.status === 403) {
    return new SpotifyPlaylistsError("scope", options);
  }

  if (response.status === 429) {
    return new SpotifyPlaylistsError("rate_limited", options);
  }

  return new SpotifyPlaylistsError("unavailable", options);
}

function getNextCursor(page: SpotifySavedPlaylistsResponse): string | null {
  if (page.next === null) {
    return null;
  }

  // The provider's next URL is consumed only on the server. If Spotify ever
  // omits its offset, use the current page's safe local offset as a fallback.
  let nextOffset = page.offset + page.items.length;
  const providerNextUrl = new URL(page.next);
  const providerOffset = providerNextUrl.searchParams.get("offset");

  if (providerOffset !== null) {
    try {
      nextOffset = parseOffsetCursor(providerOffset);
    } catch {
      throw new SpotifyPlaylistsError("unavailable", {
        reason: "invalid_pagination",
      });
    }
  }

  if (!Number.isSafeInteger(nextOffset) || nextOffset < 0) {
    throw new SpotifyPlaylistsError("unavailable", {
      reason: "invalid_pagination",
    });
  }

  return String(nextOffset);
}

/**
 * Fetches one page of playlists exposed to the current Spotify user. The
 * access token is used only for the outbound bearer header; the returned
 * value contains application-owned playlist fields only.
 */
export async function getSavedPlaylists(
  accessToken: string,
  cursor?: string,
  dependencies: SpotifyPlaylistsRequestDependencies = {},
): Promise<SavedPlaylistsPage> {
  if (typeof accessToken !== "string" || accessToken.trim().length === 0) {
    throw new SpotifyPlaylistsError("auth");
  }

  const url = buildSavedPlaylistsUrl(cursor);
  let response: Response;

  try {
    response = await fetchWithRetry(
      url.toString(),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        fetch: dependencies.fetch,
        sleep: dependencies.sleep,
        now: dependencies.now,
      },
    );
  } catch {
    throw new SpotifyPlaylistsError("unavailable", {
      reason: "network_failure",
    });
  }

  if (!response.ok) {
    throw classifyProviderResponse(response);
  }

  let rawResponse: unknown;

  try {
    rawResponse = await response.json();
  } catch {
    throw new SpotifyPlaylistsError("unavailable", {
      reason: "invalid_json",
    });
  }

  const parsed = spotifySavedPlaylistsResponseSchema.safeParse(rawResponse, {
    reportInput: true,
  });

  if (!parsed.success) {
    throw new SpotifyPlaylistsError("unavailable", {
      reason: "invalid_response_schema",
      schemaDiagnostic: fingerprintSpotifyPlaylistsSchemaIssue(
        parsed.error.issues[0],
      ),
    });
  }

  try {
    return {
      items: parsed.data.items.flatMap((playlist) =>
        playlist === null ? [] : [mapPlaylistItem(playlist)],
      ),
      nextCursor: getNextCursor(parsed.data),
    };
  } catch (error) {
    if (error instanceof SpotifyPlaylistsError) {
      throw error;
    }

    throw new SpotifyPlaylistsError("unavailable", { reason: "mapping" });
  }
}
