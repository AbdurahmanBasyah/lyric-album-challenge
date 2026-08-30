import {
  MAX_LYRIC_TRACKS_TO_SCAN,
  type ChallengeCandidate,
  type ChallengeCandidateResult,
} from "./challenge-candidates";
import { applyGuess } from "../game/progress";
import { getHiddenTokenPlaceholder } from "../game/hidden-placeholder";
import { applyRevealForAttempt } from "../game/mask";
import {
  calculateChallengeScoreView,
  MAX_STREAK,
  type ChallengeSongScoreInput,
} from "../game/scoring";
import { tokenizeLyricWindow } from "../game/tokenize";
import type {
  AttemptNumber,
  FourLineLyricWindow,
  GuessAnswers,
  LyricToken,
  TokenizedLyricWindow,
} from "../../types/game";
import type {
  ChallengeGuessContinueView,
  ChallengeGuessFinishedView,
  ChallengeGuessView,
  ChallengeProgressView,
  ChallengeQuestionView,
  ChallengeRenderedLine,
  ChallengeRenderedToken,
  ChallengeRevealView,
  ChallengeScoreView,
  ChallengeSourceView,
  ChallengeView,
} from "../../types/challenge";
import type { TrackSummary } from "../../types/tracks";
import { parsePublicPlaylistUrl } from "../public-playlist/url";

export const MAX_ATTEMPTS = 4 as const;
export const MAX_CHALLENGE_QUESTIONS = 5;
export const MAX_SEED_LENGTH = 128;
export const MAX_SOURCE_DISPLAY_NAME_LENGTH = 200;
export const MAX_GUESS_ANSWERS = 128;
export const MAX_GUESS_ANSWER_LENGTH = 256;
export const MAX_TITLE_HINT_LENGTH = 512;

/**
 * Challenge and question IDs are generated from cryptographic randomness by
 * the store. This validator keeps path lookups bounded and rejects URLs,
 * separators, and control characters before they reach the state map.
 */
export const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/u;

const SPOTIFY_ID_PATTERN = /^[A-Za-z0-9_-]+$/u;
const PRINTABLE_SEED_PATTERN = /^[\x20-\x7e]+$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

export type ChallengeQuestionStatus = "active" | "solved" | "failed";

export class ChallengeStateError extends Error {
  readonly kind:
    | "invalid_input"
    | "invalid_source"
    | "invalid_seed"
    | "invalid_id"
    | "invalid_candidates"
    | "insufficient_lyrics"
    | "invalid_guess"
    | "question_finished";

  constructor(
    kind: ChallengeStateError["kind"],
  ) {
    const messages: Readonly<
      Record<ChallengeStateError["kind"], string>
    > = {
      invalid_input: "Challenge state input is invalid.",
      invalid_source: "Challenge source is invalid.",
      invalid_seed: "Challenge seed is invalid.",
      invalid_id: "Challenge identifier is invalid.",
      invalid_candidates: "Challenge candidates are invalid.",
      insufficient_lyrics: "Challenge has no eligible lyrics.",
      invalid_guess: "Challenge guess is invalid.",
      question_finished: "Challenge question is no longer active.",
    };

    super(messages[kind]);
    this.name = "ChallengeStateError";
    this.kind = kind;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type ChallengeQuestionState = Readonly<{
  id: string;
  track: TrackSummary;
  window: TokenizedLyricWindow;
  /** Internal denominator captured after the baseline attempt-1 reveal. */
  initiallyHiddenAnswerTokens: number;
  attempt: AttemptNumber;
  status: ChallengeQuestionStatus;
}>;

export type ChallengeState = Readonly<{
  id: string;
  seed: string;
  source: ChallengeSourceView;
  createdAt: number;
  expiresAt: number;
  questions: readonly ChallengeQuestionState[];
}>;

export type CreateChallengeStateInput = Readonly<{
  challengeId: string;
  questionIds: readonly string[];
  source: ChallengeSourceView;
  seed: string;
  candidates: ChallengeCandidateResult;
  createdAt: number;
  expiresAt: number;
}>;

export type ChallengeQuestionTransition = Readonly<{
  result: "continue" | "solved" | "failed";
  question: ChallengeQuestionState;
  attemptsUsed: AttemptNumber;
  progress: ChallengeProgressView;
}>;

export type ChallengeGuessResponseInput = Readonly<{
  challenge: ChallengeState;
  transition: ChallengeQuestionTransition;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(kind: ChallengeStateError["kind"]): never {
  throw new ChallengeStateError(kind);
}

function normalizeSpotifyId(value: unknown): string {
  if (typeof value !== "string") {
    return fail("invalid_source");
  }

  const normalized = value.trim();

  if (
    normalized.length === 0 ||
    normalized.length > 128 ||
    !SPOTIFY_ID_PATTERN.test(normalized)
  ) {
    return fail("invalid_source");
  }

  return normalized;
}

function normalizeDisplayName(
  value: unknown,
  required: boolean,
): string | undefined {
  if (value === undefined) {
    if (required) {
      return fail("invalid_source");
    }

    return undefined;
  }

  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.trim().length > MAX_SOURCE_DISPLAY_NAME_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return fail("invalid_source");
  }

  return value.trim();
}

export function normalizeChallengeSource(value: unknown): ChallengeSourceView {
  if (!isRecord(value)) {
    return fail("invalid_source");
  }

  const allowedKeys = new Set([
    "kind",
    "spotifyId",
    "displayName",
    "canonicalUrl",
  ]);

  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    return fail("invalid_source");
  }

  if (
    value.kind !== "album" &&
    value.kind !== "playlist" &&
    value.kind !== "public-playlist"
  ) {
    return fail("invalid_source");
  }

  const displayName = normalizeDisplayName(
    value.displayName,
    value.kind === "album",
  );
  const spotifyId = normalizeSpotifyId(value.spotifyId);

  if (value.kind === "public-playlist") {
    let canonicalUrl: string;

    try {
      const parsed = parsePublicPlaylistUrl(value.canonicalUrl);

      if (parsed.playlistId !== spotifyId) {
        return fail("invalid_source");
      }

      canonicalUrl = parsed.canonicalUrl;
    } catch {
      return fail("invalid_source");
    }

    const source: ChallengeSourceView = {
      kind: "public-playlist",
      spotifyId,
      ...(displayName === undefined ? {} : { displayName }),
      canonicalUrl,
    };

    return Object.freeze(source);
  }

  if (value.canonicalUrl !== undefined) {
    return fail("invalid_source");
  }

  const source: ChallengeSourceView = {
    kind: value.kind,
    spotifyId,
    ...(displayName === undefined ? {} : { displayName }),
  };

  return Object.freeze(source);
}

export function normalizeChallengeSeed(value: unknown): string {
  if (typeof value !== "string") {
    return fail("invalid_seed");
  }

  const normalized = value.trim();

  if (
    normalized.length === 0 ||
    normalized.length > MAX_SEED_LENGTH ||
    !PRINTABLE_SEED_PATTERN.test(normalized)
  ) {
    return fail("invalid_seed");
  }

  return normalized;
}

export function isOpaqueChallengeId(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_ID_PATTERN.test(value);
}

function normalizeOpaqueId(value: unknown): string {
  if (!isOpaqueChallengeId(value)) {
    return fail("invalid_id");
  }

  return value;
}

function freezeTrack(track: TrackSummary): TrackSummary {
  return Object.freeze({
    spotifyId: track.spotifyId,
    name: track.name,
    artistNames: Object.freeze([...track.artistNames]),
    durationMs: track.durationMs,
  });
}

function normalizeTrack(value: unknown): TrackSummary {
  if (!isRecord(value)) {
    return fail("invalid_candidates");
  }

  const spotifyId = value.spotifyId;
  const name = value.name;
  const artistNames = value.artistNames;
  const durationMs = value.durationMs;

  if (
    typeof spotifyId !== "string" ||
    spotifyId.length === 0 ||
    spotifyId.length > 128 ||
    !SPOTIFY_ID_PATTERN.test(spotifyId) ||
    typeof name !== "string" ||
    name.trim().length === 0 ||
    name.trim().length > MAX_TITLE_HINT_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(name) ||
    !Array.isArray(artistNames) ||
    artistNames.length === 0 ||
    artistNames.some(
      (artistName) =>
        typeof artistName !== "string" || artistName.trim().length === 0,
    ) ||
    typeof durationMs !== "number" ||
    !Number.isSafeInteger(durationMs) ||
    durationMs < 0
  ) {
    return fail("invalid_candidates");
  }

  return freezeTrack({
    spotifyId,
    name: name.trim(),
    artistNames: artistNames.map((artistName) =>
      (artistName as string).trim(),
    ),
    durationMs,
  });
}

function normalizeWindow(value: unknown): FourLineLyricWindow {
  if (!Array.isArray(value) || value.length !== 4) {
    return fail("invalid_candidates");
  }

  const lines = value.map((line) => {
    if (!isRecord(line)) {
      return fail("invalid_candidates");
    }

    if (
      typeof line.timestampMs !== "number" ||
      !Number.isSafeInteger(line.timestampMs) ||
      line.timestampMs < 0 ||
      typeof line.text !== "string"
    ) {
      return fail("invalid_candidates");
    }

    return Object.freeze({
      timestampMs: line.timestampMs,
      text: line.text,
    });
  });

  return Object.freeze(lines) as unknown as FourLineLyricWindow;
}

function normalizeCandidates(
  value: ChallengeCandidateResult,
): readonly ChallengeCandidate[] {
  if (!isRecord(value)) {
    return fail("invalid_candidates");
  }

  if (value.status === "insufficient_lyrics") {
    return fail("insufficient_lyrics");
  }

  if (value.status !== "ready" || !Array.isArray(value.candidates)) {
    return fail("invalid_candidates");
  }

  if (
    typeof value.tracksScanned !== "number" ||
    !Number.isSafeInteger(value.tracksScanned) ||
    value.tracksScanned < 0 ||
    value.tracksScanned > MAX_LYRIC_TRACKS_TO_SCAN ||
    typeof value.sourceTruncated !== "boolean" ||
    typeof value.lyricScanLimitReached !== "boolean"
  ) {
    return fail("invalid_candidates");
  }

  if (
    value.candidates.length < 1 ||
    value.candidates.length > MAX_CHALLENGE_QUESTIONS
  ) {
    return fail("invalid_candidates");
  }

  const seenTrackIds = new Set<string>();
  const candidates = value.candidates.map((candidate) => {
    if (!isRecord(candidate)) {
      return fail("invalid_candidates");
    }

    const track = normalizeTrack(candidate.track);
    const window = normalizeWindow(candidate.window);

    if (seenTrackIds.has(track.spotifyId)) {
      return fail("invalid_candidates");
    }

    seenTrackIds.add(track.spotifyId);
    return Object.freeze({ track, window });
  });

  return Object.freeze(candidates);
}

function freezeToken(token: LyricToken): LyricToken {
  return Object.freeze({
    id: token.id,
    lineIndex: token.lineIndex,
    tokenIndex: token.tokenIndex,
    raw: token.raw,
    normalized: token.normalized,
    isWord: token.isWord,
    state: token.state,
  });
}

function freezeTokenizedWindow(
  window: TokenizedLyricWindow,
): TokenizedLyricWindow {
  const lines = window.map((line) =>
    Object.freeze({
      timestampMs: line.timestampMs,
      lineIndex: line.lineIndex,
      tokens: Object.freeze(line.tokens.map(freezeToken)),
    }),
  );

  return Object.freeze(lines) as unknown as TokenizedLyricWindow;
}

function collectTokens(window: TokenizedLyricWindow): readonly LyricToken[] {
  return window.flatMap((line) => line.tokens);
}

function countAnswerTokens(window: TokenizedLyricWindow): number {
  return collectTokens(window).filter((token) => token.isWord).length;
}

function countInitiallyHiddenAnswerTokens(
  window: TokenizedLyricWindow,
): number {
  return collectTokens(window).filter(
    (token) => token.isWord && token.state === "hidden",
  ).length;
}

function countTokensByState(
  window: TokenizedLyricWindow,
  state: "solved" | "revealed",
): number {
  return collectTokens(window).filter((token) => token.state === state).length;
}

function hiddenTokenIds(window: TokenizedLyricWindow): readonly string[] {
  return Object.freeze(
    collectTokens(window)
      .filter((token) => token.isWord && token.state === "hidden")
      .map((token) => token.id),
  );
}

function getProgress(window: TokenizedLyricWindow): ChallengeProgressView {
  return Object.freeze({
    solved: countTokensByState(window, "solved"),
    revealed: countTokensByState(window, "revealed"),
    totalAnswerTokens: countAnswerTokens(window),
  });
}

function renderToken(token: LyricToken): ChallengeRenderedToken {
  return Object.freeze({
    id: token.id,
    text: token.state === "hidden"
      ? getHiddenTokenPlaceholder(token.raw)
      : token.raw,
    state: token.state,
  });
}

function renderLines(window: TokenizedLyricWindow): readonly ChallengeRenderedLine[] {
  return Object.freeze(
    window.map((line) =>
      Object.freeze({
        timestampMs: line.timestampMs,
        tokens: Object.freeze(line.tokens.map(renderToken)),
      }),
    ),
  );
}

function getRawLineText(
  line: TokenizedLyricWindow[number],
): string {
  return line.tokens.map((token) => token.raw).join("");
}

function createReveal(question: ChallengeQuestionState): ChallengeRevealView {
  return Object.freeze({
    lines: Object.freeze(question.window.map(getRawLineText)),
    trackName: question.track.name,
    artistNames: Object.freeze([...question.track.artistNames]),
    startTimestampMs: question.window[0].timestampMs,
  });
}

function freezeQuestion(question: ChallengeQuestionState): ChallengeQuestionState {
  return Object.freeze({
    id: question.id,
    track: freezeTrack(question.track),
    window: freezeTokenizedWindow(question.window),
    initiallyHiddenAnswerTokens: question.initiallyHiddenAnswerTokens,
    attempt: question.attempt,
    status: question.status,
  });
}

function freezeState(state: ChallengeState): ChallengeState {
  return Object.freeze({
    id: state.id,
    seed: state.seed,
    source: normalizeChallengeSource(state.source),
    createdAt: state.createdAt,
    expiresAt: state.expiresAt,
    questions: Object.freeze(state.questions.map(freezeQuestion)),
  });
}

function revealSeed(seed: string, questionIndex: number, trackId: string): string {
  return `${seed}:question:${questionIndex}:track:${trackId}:reveal`;
}

function createQuestion(
  candidate: ChallengeCandidate,
  questionId: string,
  seed: string,
  questionIndex: number,
): ChallengeQuestionState {
  const track = normalizeTrack(candidate.track);
  const window = normalizeWindow(candidate.window);
  const tokenized = tokenizeLyricWindow(window);
  const revealed = applyRevealForAttempt(
    tokenized,
    1,
    revealSeed(seed, questionIndex, track.spotifyId),
  );
  // The baseline attempt-1 reveal is free information. Capture the count of
  // words still hidden at that starting point before later attempts add hints;
  // retain it as server-only metadata for the stable scoring denominator.
  const initiallyHiddenAnswerTokens = countInitiallyHiddenAnswerTokens(revealed);

  return freezeQuestion({
    id: questionId,
    track,
    window: freezeTokenizedWindow(revealed),
    initiallyHiddenAnswerTokens,
    attempt: 1,
    status: "active",
  });
}

export function createChallengeState(
  input: CreateChallengeStateInput,
): ChallengeState {
  if (!isRecord(input)) {
    return fail("invalid_input");
  }

  const challengeId = normalizeOpaqueId(input.challengeId);
  const seed = normalizeChallengeSeed(input.seed);
  const source = normalizeChallengeSource(input.source);
  const candidates = normalizeCandidates(input.candidates);

  if (
    !Number.isSafeInteger(input.createdAt) ||
    input.createdAt < 0 ||
    !Number.isSafeInteger(input.expiresAt) ||
    input.expiresAt <= input.createdAt
  ) {
    return fail("invalid_input");
  }

  if (
    !Array.isArray(input.questionIds) ||
    input.questionIds.length !== candidates.length
  ) {
    return fail("invalid_input");
  }

  const questionIds = input.questionIds.map(normalizeOpaqueId);

  if (new Set(questionIds).size !== questionIds.length) {
    return fail("invalid_input");
  }

  const questions = candidates.map((candidate, index) =>
    createQuestion(candidate, questionIds[index], seed, index),
  );

  return freezeState({
    id: challengeId,
    seed,
    source,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    questions: Object.freeze(questions),
  });
}

export function renderQuestion(
  question: ChallengeQuestionState,
): ChallengeQuestionView {
  const progress = getProgress(question.window);
  const base = {
    id: question.id,
    attempt: question.attempt,
    maxAttempts: MAX_ATTEMPTS,
    status: question.status,
    lines: renderLines(question.window),
    hiddenTokenIds: hiddenTokenIds(question.window),
    progress,
  } as const;

  if (question.status === "active") {
    if (question.attempt === MAX_ATTEMPTS) {
      return Object.freeze({
        ...base,
        titleHint: question.track.name,
      });
    }

    return Object.freeze(base);
  }

  return Object.freeze({
    ...base,
    reveal: createReveal(question),
  });
}

/**
 * Derive the current solved-song streak from server-owned question status.
 * Active questions do not contribute; a failed question silently resets the
 * streak. The result is capped by the five-question challenge limit.
 */
export function getCurrentSolvedSongStreak(
  questions: readonly ChallengeQuestionState[],
): number {
  let streak = 0;

  for (const question of questions) {
    if (question.status === "active") {
      continue;
    }

    if (question.status === "failed") {
      streak = 0;
      continue;
    }

    if (question.status === "solved") {
      streak = Math.min(MAX_STREAK, streak + 1);
    }
  }

  return streak;
}

/** Alias for callers that use a domain-neutral derivation name. */
export const deriveChallengeStreak = getCurrentSolvedSongStreak;

/** Perfect is a terminal achievement, independent of its numeric score. */
export function isPerfectQuestion(
  question: Pick<ChallengeQuestionState, "status" | "attempt">,
  attemptsUsed: AttemptNumber = question.attempt,
): boolean {
  return question.status === "solved" && attemptsUsed === 1;
}

function createChallengeScoreView(
  questions: readonly ChallengeQuestionState[],
): ChallengeScoreView {
  let streak = 0;
  const inputs: ChallengeSongScoreInput[] = [];

  for (const question of questions) {
    if (question.status === "active") {
      continue;
    }

    if (question.status === "failed") {
      streak = 0;
    } else if (question.status === "solved") {
      streak = Math.min(MAX_STREAK, streak + 1);
    }

    const progress = getProgress(question.window);
    inputs.push({
      questionId: question.id,
      status: question.status,
      solved: progress.solved,
      revealed: progress.revealed,
      totalAnswerTokens: progress.totalAnswerTokens,
      initiallyHiddenAnswerTokens: question.initiallyHiddenAnswerTokens,
      streak,
    });
  }

  return calculateChallengeScoreView(inputs);
}

function questionsWithTransition(
  challenge: ChallengeState,
  transition: ChallengeQuestionTransition,
): readonly ChallengeQuestionState[] {
  const questionIndex = challenge.questions.findIndex(
    (question) => question.id === transition.question.id,
  );

  if (questionIndex < 0) {
    return challenge.questions;
  }

  const questions = challenge.questions.slice();
  questions[questionIndex] = transition.question;
  return questions;
}

export function renderChallenge(state: ChallengeState): ChallengeView {
  const questions = Object.freeze(state.questions.map(renderQuestion));
  const completedQuestionCount = state.questions.filter(
    (question) => question.status !== "active",
  ).length;

  const base = {
    id: state.id,
    seed: state.seed,
    source: state.source,
    questions,
    questionCount: state.questions.length,
    completedQuestionCount,
    complete: completedQuestionCount === state.questions.length,
  } as const;

  if (!base.complete) {
    return Object.freeze(base);
  }

  return Object.freeze({
    ...base,
    score: createChallengeScoreView(state.questions),
  });
}

function normalizeAnswers(value: unknown): GuessAnswers {
  if (!isRecord(value)) {
    return fail("invalid_guess");
  }

  const keys = Object.keys(value);

  if (keys.length > MAX_GUESS_ANSWERS) {
    return fail("invalid_guess");
  }

  for (const key of keys) {
    const answer = value[key];

    if (
      typeof answer !== "string" ||
      answer.length > MAX_GUESS_ANSWER_LENGTH ||
      CONTROL_CHARACTER_PATTERN.test(answer)
    ) {
      return fail("invalid_guess");
    }
  }

  return value as GuessAnswers;
}

function replaceQuestion(
  question: ChallengeQuestionState,
  window: TokenizedLyricWindow,
  attempt: AttemptNumber,
  status: ChallengeQuestionStatus,
): ChallengeQuestionState {
  return freezeQuestion({
    id: question.id,
    track: question.track,
    window,
    initiallyHiddenAnswerTokens: question.initiallyHiddenAnswerTokens,
    attempt,
    status,
  });
}

export function transitionQuestionGuess(
  question: ChallengeQuestionState,
  answers: unknown,
  seed: string,
  questionIndex: number,
): ChallengeQuestionTransition {
  if (question.status !== "active") {
    return fail("question_finished");
  }

  const normalizedAnswers = normalizeAnswers(answers);
  let guessProgress;

  try {
    guessProgress = applyGuess(question.window, normalizedAnswers);
  } catch {
    // The pure matcher intentionally has descriptive developer-facing errors;
    // this server boundary reduces them to one safe category.
    return fail("invalid_guess");
  }

  const nextWindow = freezeTokenizedWindow(guessProgress.window);
  const progressAfterGuess = getProgress(nextWindow);
  const unresolvedHiddenCount = hiddenTokenIds(nextWindow).length;

  if (unresolvedHiddenCount === 0) {
    const solvedQuestion = replaceQuestion(
      question,
      nextWindow,
      question.attempt,
      "solved",
    );

    return Object.freeze({
      result: "solved" as const,
      question: solvedQuestion,
      attemptsUsed: question.attempt,
      progress: getProgress(solvedQuestion.window),
    });
  }

  if (question.attempt === MAX_ATTEMPTS) {
    const failedQuestion = replaceQuestion(
      question,
      nextWindow,
      MAX_ATTEMPTS,
      "failed",
    );

    return Object.freeze({
      result: "failed" as const,
      question: failedQuestion,
      attemptsUsed: MAX_ATTEMPTS,
      progress: getProgress(failedQuestion.window),
    });
  }

  const nextAttempt = (question.attempt + 1) as AttemptNumber;
  const progressivelyRevealedWindow = freezeTokenizedWindow(
    applyRevealForAttempt(
      nextWindow,
      nextAttempt,
      revealSeed(seed, questionIndex, question.track.spotifyId),
    ),
  );
  const activeQuestion = replaceQuestion(
    question,
    progressivelyRevealedWindow,
    nextAttempt,
    "active",
  );

  // Keep this local assertion explicit: it documents that an incomplete
  // guess always advances through the deterministic curve and never mutates
  // the previous question snapshot.
  void progressAfterGuess;

  return Object.freeze({
    result: "continue" as const,
    question: activeQuestion,
    attemptsUsed: question.attempt,
    progress: getProgress(activeQuestion.window),
  });
}

export function updateChallengeQuestion(
  state: ChallengeState,
  transition: ChallengeQuestionTransition,
): ChallengeState {
  const questionIndex = state.questions.findIndex(
    (question) => question.id === transition.question.id,
  );

  if (questionIndex < 0) {
    return fail("invalid_input");
  }

  const questions = state.questions.slice();
  questions[questionIndex] = transition.question;

  return freezeState({
    ...state,
    questions: Object.freeze(questions),
  });
}

export function createGuessResponse(
  input: ChallengeGuessResponseInput,
): ChallengeGuessView {
  const { challenge, transition } = input;
  const renderedQuestion = renderQuestion(transition.question);
  const responseQuestions = questionsWithTransition(challenge, transition);
  const completedQuestionCount = responseQuestions.filter(
    (question) => question.status !== "active",
  ).length;
  const complete = completedQuestionCount === responseQuestions.length;

  if (transition.result === "continue") {
    const response: ChallengeGuessContinueView = {
      result: "continue",
      questionId: transition.question.id,
      attempt: transition.question.attempt,
      maxAttempts: MAX_ATTEMPTS,
      status: "active",
      progress: renderedQuestion.progress,
      lines: renderedQuestion.lines,
      hiddenTokenIds: renderedQuestion.hiddenTokenIds,
      ...(renderedQuestion.titleHint === undefined
        ? {}
        : { titleHint: renderedQuestion.titleHint }),
      questionCount: responseQuestions.length,
      completedQuestionCount,
      complete,
    };

    return Object.freeze(response);
  }

  if (renderedQuestion.reveal === undefined) {
    return fail("invalid_input");
  }

  const response: ChallengeGuessFinishedView = {
    result: transition.result,
    questionId: transition.question.id,
    attemptsUsed: transition.attemptsUsed,
    progress: renderedQuestion.progress,
    reveal: renderedQuestion.reveal,
    perfect:
      transition.result === "solved" &&
      isPerfectQuestion(transition.question, transition.attemptsUsed),
    streak:
      transition.result === "failed"
        ? 0
        : getCurrentSolvedSongStreak(responseQuestions),
    questionCount: responseQuestions.length,
    completedQuestionCount,
    complete,
  };

  return Object.freeze(response);
}
