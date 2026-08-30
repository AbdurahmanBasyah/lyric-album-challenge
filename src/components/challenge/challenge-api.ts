import type {
  ChallengeApiErrorCode,
  ChallengePlaybackResponse,
  ChallengePlaybackUnavailableReason,
  ChallengePlaybackView,
  ChallengeGuessContinueView,
  ChallengeGuessFinishedView,
  ChallengeGuessView,
  ChallengeProgressView,
  ChallengeQuestionView,
  ChallengeRenderedLine,
  ChallengeRenderedToken,
  ChallengeRevealView,
  ChallengeScoreView,
  ChallengeSongScoreView,
  ChallengeSourceView,
  ChallengeView,
} from "../../types/challenge";
import type { AttemptNumber, TokenState } from "../../types/game";
import { MAX_HIDDEN_PLACEHOLDER_LENGTH } from "../../lib/game/hidden-placeholder";
import {
  tryParsePublicPlaylistUrl,
} from "../../lib/public-playlist/url";

const SPOTIFY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/u;
const PRINTABLE_SEED_PATTERN = /^[\x20-\x7e]{1,128}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const HIDDEN_PLACEHOLDER_PATTERN = /^_+$/u;
const MAX_TITLE_HINT_LENGTH = 512;
const MAX_CHALLENGE_QUESTIONS = 5;
const MAX_SCORE = 100;

/** YouTube's canonical opaque video identifier shape. */
export const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/u;

const PLAYBACK_UNAVAILABLE_REASONS: readonly ChallengePlaybackUnavailableReason[] = [
  "configuration",
  "no-candidate",
  "low-confidence",
  "rate-limited",
  "timeout",
  "unavailable",
] as const;

/** Errors returned by the anonymous public playlist import route. */
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

export type ChallengeClientErrorCode =
  | ChallengeApiErrorCode
  | PublicPlaylistApiErrorCode
  | "INVALID_RESPONSE"
  | "NETWORK";

const CHALLENGE_ERROR_CODES: readonly ChallengeClientErrorCode[] = [
  "AUTH_UNAVAILABLE",
  "SPOTIFY_AUTH_REQUIRED",
  "SPOTIFY_SCOPE_REQUIRED",
  "SPOTIFY_RATE_LIMITED",
  "SPOTIFY_UNAVAILABLE",
  "SOURCE_NOT_IN_LIBRARY",
  "SOURCE_INACCESSIBLE",
  "PUBLIC_PLAYLIST_PRIVATE",
  "PUBLIC_PLAYLIST_NOT_FOUND",
  "PUBLIC_PLAYLIST_RATE_LIMITED",
  "PUBLIC_PLAYLIST_UNAVAILABLE",
  "PUBLIC_PLAYLIST_INVALID_RESPONSE",
  "LYRICS_RATE_LIMITED",
  "LYRICS_PROVIDER_UNAVAILABLE",
  "INSUFFICIENT_LYRICS",
  "INVALID_INPUT",
  "INVALID_GUESS",
  "CHALLENGE_NOT_FOUND",
  "QUESTION_NOT_ACTIVE",
] as const;

const TOKEN_STATES: readonly TokenState[] = [
  "hidden",
  "solved",
  "revealed",
  "static",
];

export const CHALLENGE_RECOVERY_STORAGE_KEY =
  "fillthelyrics.active-challenge.v1";

export type ChallengeSourceContext = Readonly<{
  kind: "album" | "playlist";
  spotifyId: string;
  displayName?: string;
}> | Readonly<{
  kind: "public-playlist";
  spotifyId: string;
  displayName?: string;
  canonicalUrl: string;
}>;

export type PublicPlaylistChallengeOptions = Readonly<{
  fetch?: ChallengeFetch;
  signal?: AbortSignal;
  seed?: string;
  targetCount?: number;
}>;

export type ChallengeRecoveryPointer = Readonly<{
  challengeId: string;
  currentQuestionIndex: number;
  updatedAt: number;
}>;

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type ChallengeFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type ChallengeClientOptions = Readonly<{
  fetch?: ChallengeFetch;
  signal?: AbortSignal;
}>;

export class ChallengeClientError extends Error {
  readonly code: ChallengeClientErrorCode;
  readonly status: number | null;

  constructor(
    code: ChallengeClientError["code"],
    status: number | null = null,
  ) {
    super("Challenge request failed.");
    this.name = "ChallengeClientError";
    this.code = code;
    this.status = status;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isSafeCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function isBoundedScore(value: unknown): value is number {
  return isSafeCount(value) && value <= MAX_SCORE;
}

function isAttempt(value: unknown): value is AttemptNumber {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

function isOpaqueId(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_ID_PATTERN.test(value);
}

function parseSource(value: unknown): ChallengeSourceView | null {
  if (
    isRecord(value) &&
    value.kind === "public-playlist"
  ) {
    if (
      !hasOnlyKeys(value, ["kind", "spotifyId", "displayName", "canonicalUrl"]) ||
      typeof value.spotifyId !== "string" ||
      !SPOTIFY_ID_PATTERN.test(value.spotifyId) ||
      typeof value.canonicalUrl !== "string"
    ) {
      return null;
    }

    const identity = tryParsePublicPlaylistUrl(value.canonicalUrl);

    if (identity === null || identity.playlistId !== value.spotifyId) {
      return null;
    }

    if (
      value.displayName !== undefined &&
      (typeof value.displayName !== "string" ||
        value.displayName.trim().length === 0 ||
        value.displayName.trim().length > 200 ||
        CONTROL_CHARACTER_PATTERN.test(value.displayName))
    ) {
      return null;
    }

    return Object.freeze({
      kind: "public-playlist" as const,
      spotifyId: value.spotifyId,
      ...(value.displayName === undefined
        ? {}
        : { displayName: value.displayName.trim() }),
      canonicalUrl: identity.canonicalUrl,
    });
  }

  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["kind", "spotifyId", "displayName"]) ||
    (value.kind !== "album" && value.kind !== "playlist") ||
    typeof value.spotifyId !== "string" ||
    !SPOTIFY_ID_PATTERN.test(value.spotifyId)
  ) {
    return null;
  }

  if (
    value.displayName !== undefined &&
    (typeof value.displayName !== "string" ||
      value.displayName.trim().length === 0 ||
      value.displayName.trim().length > 200 ||
      CONTROL_CHARACTER_PATTERN.test(value.displayName))
  ) {
    return null;
  }

  if (value.kind === "album" && value.displayName === undefined) {
    return null;
  }

  return Object.freeze({
    kind: value.kind,
    spotifyId: value.spotifyId,
    ...(value.displayName === undefined
      ? {}
      : { displayName: value.displayName.trim() }),
  });
}

function parseToken(value: unknown): ChallengeRenderedToken | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["id", "text", "state"]) ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    value.id.length > 128 ||
    CONTROL_CHARACTER_PATTERN.test(value.id) ||
    typeof value.text !== "string" ||
    value.text.length > 4_096 ||
    CONTROL_CHARACTER_PATTERN.test(value.text) ||
    typeof value.state !== "string" ||
    !TOKEN_STATES.includes(value.state as TokenState) ||
    (value.state === "hidden" &&
      (value.text.length === 0 ||
        value.text.length > MAX_HIDDEN_PLACEHOLDER_LENGTH ||
        !HIDDEN_PLACEHOLDER_PATTERN.test(value.text)))
  ) {
    return null;
  }

  return Object.freeze({
    id: value.id,
    text: value.text,
    state: value.state as TokenState,
  });
}

function parseLine(value: unknown): ChallengeRenderedLine | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["timestampMs", "tokens"]) ||
    !isSafeCount(value.timestampMs) ||
    !Array.isArray(value.tokens) ||
    value.tokens.length > 512
  ) {
    return null;
  }

  const tokens = value.tokens.map(parseToken);

  if (tokens.some((token) => token === null)) {
    return null;
  }

  const resolvedTokens = tokens as ChallengeRenderedToken[];

  if (new Set(resolvedTokens.map((token) => token.id)).size !== resolvedTokens.length) {
    return null;
  }

  return Object.freeze({
    timestampMs: value.timestampMs,
    tokens: Object.freeze(resolvedTokens),
  });
}

function parseLines(value: unknown): readonly ChallengeRenderedLine[] | null {
  if (!Array.isArray(value) || value.length !== 4) {
    return null;
  }

  const lines = value.map(parseLine);
  return lines.some((line) => line === null)
    ? null
    : Object.freeze(lines as ChallengeRenderedLine[]);
}

function parseProgress(value: unknown): ChallengeProgressView | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["solved", "revealed", "totalAnswerTokens"]) ||
    !isSafeCount(value.solved) ||
    !isSafeCount(value.revealed) ||
    !isSafeCount(value.totalAnswerTokens) ||
    value.solved > value.totalAnswerTokens ||
    value.revealed > value.totalAnswerTokens ||
    value.solved + value.revealed > value.totalAnswerTokens
  ) {
    return null;
  }

  return Object.freeze({
    solved: value.solved,
    revealed: value.revealed,
    totalAnswerTokens: value.totalAnswerTokens,
  });
}

function parseReveal(value: unknown): ChallengeRevealView | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "lines",
      "trackName",
      "artistNames",
      "startTimestampMs",
    ]) ||
    !Array.isArray(value.lines) ||
    value.lines.length !== 4 ||
    value.lines.some(
      (line) =>
        typeof line !== "string" ||
        line.length > 4_096 ||
        CONTROL_CHARACTER_PATTERN.test(line),
    ) ||
    typeof value.trackName !== "string" ||
    value.trackName.trim().length === 0 ||
    value.trackName.length > 512 ||
    CONTROL_CHARACTER_PATTERN.test(value.trackName) ||
    !Array.isArray(value.artistNames) ||
    value.artistNames.length === 0 ||
    value.artistNames.some(
      (artist) =>
        typeof artist !== "string" ||
        artist.trim().length === 0 ||
        artist.length > 512 ||
        CONTROL_CHARACTER_PATTERN.test(artist),
    ) ||
    !isSafeCount(value.startTimestampMs)
  ) {
    return null;
  }

  return Object.freeze({
    lines: Object.freeze([...(value.lines as string[])]),
    trackName: value.trackName.trim(),
    artistNames: Object.freeze(
      (value.artistNames as string[]).map((artist) => artist.trim()),
    ),
    startTimestampMs: value.startTimestampMs,
  });
}

function parseTitleHint(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > MAX_TITLE_HINT_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return null;
  }

  return value.trim();
}

function parseHiddenIds(value: unknown): readonly string[] | null {
  if (
    !Array.isArray(value) ||
    value.length > 128 ||
    value.some(
      (id) =>
        typeof id !== "string" ||
        id.length === 0 ||
        id.length > 128 ||
        CONTROL_CHARACTER_PATTERN.test(id),
    )
  ) {
    return null;
  }

  const ids = value as string[];
  return new Set(ids).size === ids.length ? Object.freeze([...ids]) : null;
}

function validateRenderedProgress(
  lines: readonly ChallengeRenderedLine[],
  hiddenTokenIds: readonly string[],
  progress: ChallengeProgressView,
): boolean {
  const renderedTokens = lines.flatMap((line) => line.tokens);
  const renderedTokenIds = new Set(renderedTokens.map((token) => token.id));
  const actualHiddenIds = renderedTokens
    .filter((token) => token.state === "hidden")
    .map((token) => token.id);
  const solvedCount = renderedTokens.filter(
    (token) => token.state === "solved",
  ).length;
  const revealedCount = renderedTokens.filter(
    (token) => token.state === "revealed",
  ).length;
  const answerTokenCount = renderedTokens.filter(
    (token) => token.state !== "static",
  ).length;

  return (
    renderedTokenIds.size === renderedTokens.length &&
    actualHiddenIds.length === hiddenTokenIds.length &&
    actualHiddenIds.every((id) => hiddenTokenIds.includes(id)) &&
    solvedCount === progress.solved &&
    revealedCount === progress.revealed &&
    answerTokenCount === progress.totalAnswerTokens
  );
}

function parseQuestion(value: unknown): ChallengeQuestionView | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "id",
      "attempt",
      "maxAttempts",
      "status",
      "titleHint",
      "lines",
      "hiddenTokenIds",
      "progress",
      "reveal",
    ]) ||
    !isOpaqueId(value.id) ||
    !isAttempt(value.attempt) ||
    value.maxAttempts !== 4 ||
    (value.status !== "active" &&
      value.status !== "solved" &&
      value.status !== "failed")
  ) {
    return null;
  }

  const lines = parseLines(value.lines);
  const hiddenTokenIds = parseHiddenIds(value.hiddenTokenIds);
  const progress = parseProgress(value.progress);
  const reveal = value.reveal === undefined ? undefined : parseReveal(value.reveal);
  const hasTitleHint = Object.prototype.hasOwnProperty.call(value, "titleHint");
  const titleHint = hasTitleHint ? parseTitleHint(value.titleHint) : undefined;

  if (
    lines === null ||
    hiddenTokenIds === null ||
    progress === null ||
    (value.status === "active" && value.reveal !== undefined) ||
    (value.status !== "active" && reveal == null) ||
    (hasTitleHint && titleHint === null) ||
    (value.status === "active" && value.attempt === 4 && titleHint === undefined) ||
    ((value.status !== "active" || value.attempt !== 4) && titleHint !== undefined)
  ) {
    return null;
  }

  if (!validateRenderedProgress(lines, hiddenTokenIds, progress)) {
    return null;
  }

  return Object.freeze({
    id: value.id,
    attempt: value.attempt,
    maxAttempts: 4,
    status: value.status,
    lines,
    hiddenTokenIds,
    progress,
    ...(typeof titleHint === "string" ? { titleHint } : {}),
    ...(reveal == null ? {} : { reveal }),
  });
}

function parseSongScore(
  value: unknown,
  terminalQuestionIds: ReadonlySet<string>,
): ChallengeSongScoreView | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["questionId", "score"]) ||
    !isOpaqueId(value.questionId) ||
    !terminalQuestionIds.has(value.questionId) ||
    !isBoundedScore(value.score)
  ) {
    return null;
  }

  return Object.freeze({
    questionId: value.questionId,
    score: value.score,
  });
}

function parseChallengeScore(
  value: unknown,
  questions: readonly ChallengeQuestionView[],
): ChallengeScoreView | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["total", "songs"]) ||
    !isBoundedScore(value.total) ||
    !Array.isArray(value.songs) ||
    value.songs.length !== questions.length
  ) {
    return null;
  }

  const terminalQuestionIds = new Set(
    questions
      .filter((question) => question.status !== "active")
      .map((question) => question.id),
  );
  const songs = value.songs.map((song) =>
    parseSongScore(song, terminalQuestionIds),
  );

  if (
    songs.some((song) => song === null) ||
    new Set(
      songs
        .filter((song): song is ChallengeSongScoreView => song !== null)
        .map((song) => song.questionId),
    ).size !== songs.length
  ) {
    return null;
  }

  const resolvedSongs = songs as ChallengeSongScoreView[];

  if (new Set(resolvedSongs.map((song) => song.questionId)).size !== terminalQuestionIds.size) {
    return null;
  }

  return Object.freeze({
    total: value.total,
    songs: Object.freeze(resolvedSongs),
  });
}

export function parseChallenge(value: unknown): ChallengeView | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "id",
      "seed",
      "source",
      "questions",
      "questionCount",
      "completedQuestionCount",
      "complete",
      "score",
    ]) ||
    !isOpaqueId(value.id) ||
    typeof value.seed !== "string" ||
    !PRINTABLE_SEED_PATTERN.test(value.seed) ||
    !Array.isArray(value.questions) ||
    value.questions.length < 1 ||
    value.questions.length > MAX_CHALLENGE_QUESTIONS ||
    !isSafeCount(value.questionCount) ||
    !isSafeCount(value.completedQuestionCount) ||
    typeof value.complete !== "boolean"
  ) {
    return null;
  }

  const source = parseSource(value.source);
  const questions = value.questions.map(parseQuestion);

  if (source === null || questions.some((question) => question === null)) {
    return null;
  }

  const resolvedQuestions = questions as ChallengeQuestionView[];
  const completed = resolvedQuestions.filter(
    (question) => question.status !== "active",
  ).length;
  const hasScore = Object.prototype.hasOwnProperty.call(value, "score");
  const score = hasScore
    ? parseChallengeScore(value.score, resolvedQuestions)
    : undefined;

  if (
    value.questionCount !== resolvedQuestions.length ||
    value.completedQuestionCount !== completed ||
    value.complete !== (completed === resolvedQuestions.length) ||
    new Set(resolvedQuestions.map((question) => question.id)).size !==
      resolvedQuestions.length ||
    (!value.complete && hasScore) ||
    (value.complete && !hasScore) ||
    (hasScore && score === null)
  ) {
    return null;
  }

  return Object.freeze({
    id: value.id,
    seed: value.seed,
    source,
    questions: Object.freeze(resolvedQuestions),
    questionCount: value.questionCount,
    completedQuestionCount: value.completedQuestionCount,
    complete: value.complete,
    ...(score == null ? {} : { score }),
  });
}

export function parseChallengeEnvelope(value: unknown): ChallengeView | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["challenge"])) {
    return null;
  }

  return parseChallenge(value.challenge);
}

export function parseChallengeSourceContext(
  value: Record<string, string | string[] | undefined>,
): ChallengeSourceContext | null {
  const allowed = new Set([
    "kind",
    "spotifyId",
    "displayName",
    "canonicalUrl",
  ]);

  if (Object.keys(value).some((key) => !allowed.has(key))) {
    return null;
  }

  const kind = value.kind;
  const spotifyId = value.spotifyId;
  const displayName = value.displayName;
  const canonicalUrl = value.canonicalUrl;

  if (
    kind === "public-playlist"
  ) {
    if (
      typeof spotifyId !== "string" ||
      !SPOTIFY_ID_PATTERN.test(spotifyId) ||
      typeof canonicalUrl !== "string" ||
      Array.isArray(displayName)
    ) {
      return null;
    }

    const identity = tryParsePublicPlaylistUrl(canonicalUrl);

    if (identity === null || identity.playlistId !== spotifyId) {
      return null;
    }

    if (
      displayName !== undefined &&
      (typeof displayName !== "string" ||
        displayName.trim().length === 0 ||
        displayName.trim().length > 200 ||
        CONTROL_CHARACTER_PATTERN.test(displayName))
    ) {
      return null;
    }

    return Object.freeze({
      kind: "public-playlist" as const,
      spotifyId,
      ...(displayName === undefined ? {} : { displayName: displayName.trim() }),
      canonicalUrl: identity.canonicalUrl,
    });
  }

  if (
    (kind !== "album" && kind !== "playlist") ||
    typeof spotifyId !== "string" ||
    !SPOTIFY_ID_PATTERN.test(spotifyId) ||
    Array.isArray(displayName) ||
    canonicalUrl !== undefined ||
    (displayName !== undefined &&
      (displayName.trim().length === 0 ||
        displayName.trim().length > 200 ||
        CONTROL_CHARACTER_PATTERN.test(displayName))) ||
    (kind === "album" && displayName === undefined)
  ) {
    return null;
  }

  return Object.freeze({
    kind,
    spotifyId,
    ...(displayName === undefined ? {} : { displayName: displayName.trim() }),
  });
}

export function createChallengeIntroUrl(source: ChallengeSourceContext): string {
  const normalized = parseChallengeSourceContext(source);

  if (normalized === null) {
    throw new TypeError("Invalid challenge source context.");
  }

  const params = new URLSearchParams({
    kind: normalized.kind,
    spotifyId: normalized.spotifyId,
  });

  if (normalized.displayName !== undefined) {
    params.set("displayName", normalized.displayName);
  }

  if (normalized.kind === "public-playlist") {
    params.set("canonicalUrl", normalized.canonicalUrl);
  }

  return `/play?${params.toString()}`;
}

function parseErrorCode(value: unknown): ChallengeClientErrorCode | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["error"]) ||
    typeof value.error !== "string" ||
    !CHALLENGE_ERROR_CODES.includes(value.error as ChallengeClientErrorCode)
  ) {
    return null;
  }

  return value.error as ChallengeClientErrorCode;
}

function isPlaybackUnavailableReason(
  value: unknown,
): value is ChallengePlaybackUnavailableReason {
  return (
    typeof value === "string" &&
    PLAYBACK_UNAVAILABLE_REASONS.includes(
      value as ChallengePlaybackUnavailableReason,
    )
  );
}

function parsePlaybackView(value: unknown): ChallengePlaybackView | null {
  if (!isRecord(value) || value.provider !== "youtube") {
    return null;
  }

  if (
    value.status === "available" &&
    hasOnlyKeys(value, ["provider", "status", "videoId", "startAtMs"]) &&
    typeof value.videoId === "string" &&
    YOUTUBE_VIDEO_ID_PATTERN.test(value.videoId) &&
    isSafeCount(value.startAtMs)
  ) {
    return Object.freeze({
      provider: "youtube" as const,
      status: "available" as const,
      videoId: value.videoId,
      startAtMs: value.startAtMs,
    });
  }

  if (
    value.status === "unavailable" &&
    hasOnlyKeys(value, ["provider", "status", "reason"]) &&
    isPlaybackUnavailableReason(value.reason)
  ) {
    return Object.freeze({
      provider: "youtube" as const,
      status: "unavailable" as const,
      reason: value.reason,
    });
  }

  return null;
}

/**
 * Parse the reduced playback envelope returned by the same-origin route.
 * Provider payloads, URLs, and resolver diagnostics are intentionally not
 * accepted at this browser boundary.
 */
export function parseChallengePlaybackResponse(
  value: unknown,
): ChallengePlaybackResponse | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["playback"])) {
    return null;
  }

  const playback = parsePlaybackView(value.playback);

  return playback === null
    ? null
    : Object.freeze({ playback });
}

/** Alias kept for callers that name the parsed value rather than its envelope. */
export const parseChallengePlayback = parseChallengePlaybackResponse;

async function readPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function requestPayload(
  path: string,
  init: RequestInit,
  options: ChallengeClientOptions,
): Promise<unknown> {
  const fetchFunction = options.fetch ?? globalThis.fetch;

  if (typeof fetchFunction !== "function") {
    throw new ChallengeClientError("NETWORK");
  }

  let response: Response;

  try {
    response = await fetchFunction(path, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      signal: options.signal,
      headers: {
        Accept: "application/json",
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...init.headers,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }

    throw new ChallengeClientError("NETWORK");
  }

  const payload = await readPayload(response);

  if (!response.ok) {
    throw new ChallengeClientError(
      parseErrorCode(payload) ?? "INVALID_RESPONSE",
      response.status,
    );
  }

  return payload;
}

export async function createChallenge(
  source: ChallengeSourceContext,
  options: ChallengeClientOptions = {},
): Promise<ChallengeView> {
  const normalized = parseChallengeSourceContext(source);

  if (normalized === null || normalized.kind === "public-playlist") {
    throw new ChallengeClientError("INVALID_INPUT", 400);
  }

  const payload = await requestPayload(
    "/api/challenges",
    {
      method: "POST",
      body: JSON.stringify({ source: normalized, targetCount: 5 }),
    },
    options,
  );
  const challenge = parseChallengeEnvelope(payload);

  if (challenge === null) {
    throw new ChallengeClientError("INVALID_RESPONSE");
  }

  return challenge;
}

const MAX_PUBLIC_PLAYLIST_URL_LENGTH = 2_048;

function normalizePublicPlaylistSeed(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.trim().length > 128 ||
    !PRINTABLE_SEED_PATTERN.test(value.trim()) ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new ChallengeClientError("INVALID_INPUT", 400);
  }

  return value.trim();
}

function normalizePublicPlaylistTarget(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 5
  ) {
    throw new ChallengeClientError("INVALID_INPUT", 400);
  }

  return value;
}

/**
 * Canonicalize the one public playlist URL shape accepted by the import form.
 * This is a convenience check; the server validates the URL again.
 */
export function canonicalizePublicPlaylistInput(
  value: unknown,
): string | null {
  if (typeof value !== "string" || value.length > MAX_PUBLIC_PLAYLIST_URL_LENGTH) {
    return null;
  }

  return tryParsePublicPlaylistUrl(value)?.canonicalUrl ?? null;
}

/** Aliases for callers that want an explicit URL-parser name. */
export const parsePublicPlaylistInput = canonicalizePublicPlaylistInput;
export const canonicalizePublicPlaylistUrl = canonicalizePublicPlaylistInput;
export const parsePublicPlaylistUrl = canonicalizePublicPlaylistInput;

export async function createPublicPlaylistChallenge(
  value: unknown,
  options: PublicPlaylistChallengeOptions = {},
): Promise<ChallengeView> {
  const canonicalUrl = canonicalizePublicPlaylistInput(value);

  if (canonicalUrl === null) {
    throw new ChallengeClientError("INVALID_INPUT", 400);
  }

  const seed = normalizePublicPlaylistSeed(options.seed);
  const targetCount = normalizePublicPlaylistTarget(options.targetCount);
  const body: Record<string, string | number> = { url: canonicalUrl };

  if (seed !== undefined) {
    body.seed = seed;
  }

  if (targetCount !== undefined) {
    body.targetCount = targetCount;
  }

  const payload = await requestPayload(
    "/api/public-playlists/challenge",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    options,
  );
  const challenge = parseChallengeEnvelope(payload);

  if (challenge === null || challenge.source.kind !== "public-playlist") {
    throw new ChallengeClientError("INVALID_RESPONSE");
  }

  return challenge;
}

export async function getChallenge(
  challengeId: string,
  options: ChallengeClientOptions = {},
): Promise<ChallengeView> {
  if (!isOpaqueId(challengeId)) {
    throw new ChallengeClientError("CHALLENGE_NOT_FOUND", 404);
  }

  const payload = await requestPayload(
    `/api/challenges/${encodeURIComponent(challengeId)}`,
    { method: "GET" },
    options,
  );
  const challenge = parseChallengeEnvelope(payload);

  if (challenge === null) {
    throw new ChallengeClientError("INVALID_RESPONSE");
  }

  return challenge;
}

function parseGuessContinue(value: Record<string, unknown>): ChallengeGuessContinueView | null {
  if (
    !hasOnlyKeys(value, [
      "result",
      "questionId",
      "attempt",
      "maxAttempts",
      "status",
      "titleHint",
      "progress",
      "lines",
      "hiddenTokenIds",
      "questionCount",
      "completedQuestionCount",
      "complete",
    ]) ||
    value.result !== "continue" ||
    !isOpaqueId(value.questionId) ||
    !isAttempt(value.attempt) ||
    value.maxAttempts !== 4 ||
    value.status !== "active" ||
    !isSafeCount(value.questionCount) ||
    value.questionCount < 1 ||
    value.questionCount > MAX_CHALLENGE_QUESTIONS ||
    !isSafeCount(value.completedQuestionCount) ||
    value.completedQuestionCount >= value.questionCount ||
    value.complete !== false
  ) {
    return null;
  }

  const progress = parseProgress(value.progress);
  const lines = parseLines(value.lines);
  const hiddenTokenIds = parseHiddenIds(value.hiddenTokenIds);
  const hasTitleHint = Object.prototype.hasOwnProperty.call(value, "titleHint");
  const titleHint = hasTitleHint ? parseTitleHint(value.titleHint) : undefined;

  if (
    progress === null ||
    lines === null ||
    hiddenTokenIds === null ||
    (hasTitleHint && titleHint === null) ||
    (value.attempt === 4 && titleHint === undefined) ||
    (value.attempt !== 4 && titleHint !== undefined)
  ) {
    return null;
  }

  if (!validateRenderedProgress(lines, hiddenTokenIds, progress)) {
    return null;
  }

  return Object.freeze({
    result: "continue",
    questionId: value.questionId,
    attempt: value.attempt,
    maxAttempts: 4,
    status: "active",
    progress,
    lines,
    hiddenTokenIds,
    ...(typeof titleHint === "string" ? { titleHint } : {}),
    questionCount: value.questionCount,
    completedQuestionCount: value.completedQuestionCount,
    complete: false,
  });
}

function parseGuessFinished(value: Record<string, unknown>): ChallengeGuessFinishedView | null {
  if (
    !hasOnlyKeys(value, [
      "result",
      "questionId",
      "attemptsUsed",
      "progress",
      "reveal",
      "perfect",
      "streak",
      "questionCount",
      "completedQuestionCount",
      "complete",
    ]) ||
    (value.result !== "solved" && value.result !== "failed") ||
    !isOpaqueId(value.questionId) ||
    !isAttempt(value.attemptsUsed) ||
    typeof value.perfect !== "boolean" ||
    !isSafeCount(value.streak) ||
    value.streak > MAX_CHALLENGE_QUESTIONS ||
    !isSafeCount(value.questionCount) ||
    value.questionCount < 1 ||
    value.questionCount > MAX_CHALLENGE_QUESTIONS ||
    !isSafeCount(value.completedQuestionCount) ||
    value.completedQuestionCount < 1 ||
    value.completedQuestionCount > value.questionCount ||
    typeof value.complete !== "boolean" ||
    value.complete !== (value.completedQuestionCount === value.questionCount)
  ) {
    return null;
  }

  const progress = parseProgress(value.progress);
  const reveal = parseReveal(value.reveal);

  if (
    progress === null ||
    reveal === null ||
    value.perfect !== (value.result === "solved" && value.attemptsUsed === 1) ||
    (value.result === "failed" &&
      (value.attemptsUsed !== 4 || value.perfect || value.streak !== 0)) ||
    (value.result === "solved" && value.streak < 1)
  ) {
    return null;
  }

  return Object.freeze({
    result: value.result,
    questionId: value.questionId,
    attemptsUsed: value.attemptsUsed,
    progress,
    reveal,
    perfect: value.perfect,
    streak: value.streak,
    questionCount: value.questionCount,
    completedQuestionCount: value.completedQuestionCount,
    complete: value.complete,
  });
}

export function parseGuessResponse(value: unknown): ChallengeGuessView | null {
  if (!isRecord(value)) {
    return null;
  }

  return value.result === "continue"
    ? parseGuessContinue(value)
    : parseGuessFinished(value);
}

export async function submitChallengeGuess(
  challengeId: string,
  questionId: string,
  answers: Readonly<Record<string, string>>,
  options: ChallengeClientOptions = {},
): Promise<ChallengeGuessView> {
  if (!isOpaqueId(challengeId) || !isOpaqueId(questionId)) {
    throw new ChallengeClientError("CHALLENGE_NOT_FOUND", 404);
  }

  const payload = await requestPayload(
    `/api/challenges/${encodeURIComponent(challengeId)}/questions/${encodeURIComponent(questionId)}/guess`,
    { method: "POST", body: JSON.stringify({ answers }) },
    options,
  );
  const result = parseGuessResponse(payload);

  if (result === null) {
    throw new ChallengeClientError("INVALID_RESPONSE");
  }

  return result;
}

/**
 * Ask the server to resolve the already-revealed question. The request body
 * carries no track or provider data; the route uses its opaque IDs to look up
 * the server-owned question and keeps this optional action out of gameplay.
 */
export async function requestChallengePlayback(
  challengeId: string,
  questionId: string,
  options: ChallengeClientOptions = {},
): Promise<ChallengePlaybackView> {
  if (!isOpaqueId(challengeId) || !isOpaqueId(questionId)) {
    throw new ChallengeClientError("CHALLENGE_NOT_FOUND", 404);
  }

  const payload = await requestPayload(
    `/api/challenges/${encodeURIComponent(challengeId)}/questions/${encodeURIComponent(questionId)}/playback`,
    { method: "POST", body: "{}" },
    options,
  );
  const response = parseChallengePlaybackResponse(payload);

  if (response === null) {
    throw new ChallengeClientError("INVALID_RESPONSE");
  }

  return response.playback;
}

/** Explicit alias for components that call this action a playback fetch. */
export const fetchChallengePlayback = requestChallengePlayback;

export function saveRecoveryPointer(
  storage: StorageLike,
  pointer: ChallengeRecoveryPointer,
): void {
  if (
    !isOpaqueId(pointer.challengeId) ||
    !isSafeCount(pointer.currentQuestionIndex) ||
    pointer.currentQuestionIndex > 4 ||
    !isSafeCount(pointer.updatedAt)
  ) {
    throw new TypeError("Invalid challenge recovery pointer.");
  }

  storage.setItem(CHALLENGE_RECOVERY_STORAGE_KEY, JSON.stringify(pointer));
}

export function readRecoveryPointer(
  storage: StorageLike,
): ChallengeRecoveryPointer | null {
  const value = storage.getItem(CHALLENGE_RECOVERY_STORAGE_KEY);

  if (value === null || value.length > 1_024) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return null;
  }

  if (
    !isRecord(parsed) ||
    !hasOnlyKeys(parsed, ["challengeId", "currentQuestionIndex", "updatedAt"]) ||
    !isOpaqueId(parsed.challengeId) ||
    !isSafeCount(parsed.currentQuestionIndex) ||
    parsed.currentQuestionIndex > 4 ||
    !isSafeCount(parsed.updatedAt)
  ) {
    return null;
  }

  return Object.freeze({
    challengeId: parsed.challengeId,
    currentQuestionIndex: parsed.currentQuestionIndex,
    updatedAt: parsed.updatedAt,
  });
}

export function clearRecoveryPointer(storage: StorageLike): void {
  storage.removeItem(CHALLENGE_RECOVERY_STORAGE_KEY);
}

export function getChallengeErrorCopy(error: unknown): Readonly<{
  heading: string;
  detail: string;
  reconnect: boolean;
}> {
  const code =
    error instanceof ChallengeClientError ? error.code : "NETWORK";

  if (code === "SPOTIFY_AUTH_REQUIRED") {
    return {
      heading: "Reconnect Spotify to continue.",
      detail: "Your private session has ended. Connect again, then retry.",
      reconnect: true,
    };
  }

  if (code === "INSUFFICIENT_LYRICS") {
    return {
      heading: "Not enough synced lyrics here.",
      detail: "Choose another album or playlist and try again.",
      reconnect: false,
    };
  }

  if (code === "PUBLIC_PLAYLIST_PRIVATE") {
    return {
      heading: "That playlist is private.",
      detail: "Use a public Spotify playlist link and try again.",
      reconnect: false,
    };
  }

  if (code === "PUBLIC_PLAYLIST_NOT_FOUND") {
    return {
      heading: "We couldn't find that playlist.",
      detail: "Check the link and try importing it again.",
      reconnect: false,
    };
  }

  if (code === "PUBLIC_PLAYLIST_RATE_LIMITED") {
    return {
      heading: "Playlist import needs a moment.",
      detail: "Wait briefly, then try the same link again.",
      reconnect: false,
    };
  }

  if (
    code === "PUBLIC_PLAYLIST_UNAVAILABLE" ||
    code === "PUBLIC_PLAYLIST_INVALID_RESPONSE"
  ) {
    return {
      heading: "We couldn't import that playlist right now.",
      detail: "Try again in a moment, or use another public playlist.",
      reconnect: false,
    };
  }

  if (code === "SOURCE_NOT_IN_LIBRARY" || code === "SOURCE_INACCESSIBLE") {
    return {
      heading: "This source is no longer available.",
      detail: "Return to your library and choose another saved source.",
      reconnect: false,
    };
  }

  if (code === "CHALLENGE_NOT_FOUND") {
    return {
      heading: "This challenge has expired.",
      detail: "Challenges are temporary. Start a new one from your library.",
      reconnect: false,
    };
  }

  if (code === "SPOTIFY_RATE_LIMITED" || code === "LYRICS_RATE_LIMITED") {
    return {
      heading: "The music services need a moment.",
      detail: "Wait briefly, then try the same action again.",
      reconnect: false,
    };
  }

  return {
    heading: "We couldn't continue the challenge.",
    detail: "Try again. Your Spotify credentials and hidden answers stay server-side.",
    reconnect: false,
  };
}
