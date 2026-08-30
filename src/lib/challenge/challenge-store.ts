import { randomBytes } from "node:crypto";

import {
  createChallengeState,
  MAX_CHALLENGE_QUESTIONS,
  isOpaqueChallengeId,
  transitionQuestionGuess,
  updateChallengeQuestion,
  type ChallengeQuestionTransition,
  type ChallengeState,
  type ChallengeQuestionState,
  type CreateChallengeStateInput,
} from "./challenge-state";
import type { ChallengeCandidateResult } from "./challenge-candidates";
import type { ChallengeSourceView } from "../../types/challenge";

export const CHALLENGE_TTL_MS = 30 * 60 * 1000;
export const MAX_ACTIVE_CHALLENGES = 100;
const MAX_ID_GENERATION_ATTEMPTS = 32;

export type ChallengeStoreErrorKind =
  | "invalid_input"
  | "invalid_id"
  | "not_found"
  | "question_not_found"
  | "id_generation";

export class ChallengeStoreError extends Error {
  readonly kind: ChallengeStoreErrorKind;

  constructor(kind: ChallengeStoreErrorKind) {
    const messages: Readonly<Record<ChallengeStoreErrorKind, string>> = {
      invalid_input: "Challenge store input is invalid.",
      invalid_id: "Challenge identifier is invalid.",
      not_found: "Challenge was not found.",
      question_not_found: "Challenge question was not found.",
      id_generation: "Challenge identifier could not be generated.",
    };

    super(messages[kind]);
    this.name = "ChallengeStoreError";
    this.kind = kind;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type ChallengeStoreClock = () => number;
export type ChallengeIdFactory = () => string;

export type ChallengeStoreOptions = Readonly<{
  now?: ChallengeStoreClock;
  challengeId?: ChallengeIdFactory;
  questionId?: ChallengeIdFactory;
  ttlMs?: number;
  maxEntries?: number;
}>;

export type CreateStoredChallengeInput = Readonly<{
  source: ChallengeSourceView;
  seed: string;
  candidates: ChallengeCandidateResult;
}>;

export type StoredGuessResult = Readonly<{
  challenge: ChallengeState;
  transition: ChallengeQuestionTransition;
}>;

function createOpaqueId(): string {
  return randomBytes(32).toString("base64url");
}

function validatePositiveInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function normalizeStoreOptions(options: ChallengeStoreOptions): Required<
  Pick<ChallengeStoreOptions, "now" | "challengeId" | "questionId" | "ttlMs" | "maxEntries">
> {
  if (
    typeof options !== "object" ||
    options === null ||
    Array.isArray(options)
  ) {
    throw new ChallengeStoreError("invalid_input");
  }

  const now = options.now ?? Date.now;
  const challengeId = options.challengeId ?? createOpaqueId;
  const questionId = options.questionId ?? createOpaqueId;
  const ttlMs = options.ttlMs ?? CHALLENGE_TTL_MS;
  const maxEntries = options.maxEntries ?? MAX_ACTIVE_CHALLENGES;

  if (
    typeof now !== "function" ||
    typeof challengeId !== "function" ||
    typeof questionId !== "function" ||
    !validatePositiveInteger(ttlMs) ||
    !validatePositiveInteger(maxEntries) ||
    maxEntries > MAX_ACTIVE_CHALLENGES
  ) {
    throw new ChallengeStoreError("invalid_input");
  }

  return { now, challengeId, questionId, ttlMs, maxEntries };
}

function createUniqueId(
  factory: ChallengeIdFactory,
  used: ReadonlySet<string>,
): string {
  for (let attempt = 0; attempt < MAX_ID_GENERATION_ATTEMPTS; attempt += 1) {
    let candidate: string;

    try {
      candidate = factory();
    } catch {
      throw new ChallengeStoreError("id_generation");
    }

    if (isOpaqueChallengeId(candidate) && !used.has(candidate)) {
      return candidate;
    }
  }

  throw new ChallengeStoreError("id_generation");
}

function normalizeChallengeId(value: unknown): string {
  if (!isOpaqueChallengeId(value)) {
    throw new ChallengeStoreError("invalid_id");
  }

  return value;
}

/**
 * A process-local, short-lived challenge store for the MVP. It deliberately
 * has no timer: expiry is pruned on reads and writes so an idle Node process
 * can shut down naturally.
 */
export class ChallengeStore {
  private readonly entries = new Map<string, ChallengeState>();
  private readonly now: ChallengeStoreClock;
  private readonly challengeIdFactory: ChallengeIdFactory;
  private readonly questionIdFactory: ChallengeIdFactory;
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(options: ChallengeStoreOptions = {}) {
    const normalized = normalizeStoreOptions(options);
    this.now = normalized.now;
    this.challengeIdFactory = normalized.challengeId;
    this.questionIdFactory = normalized.questionId;
    this.ttlMs = normalized.ttlMs;
    this.maxEntries = normalized.maxEntries;
  }

  private prune(now: number): void {
    for (const [challengeId, challenge] of this.entries) {
      if (challenge.expiresAt <= now) {
        this.entries.delete(challengeId);
      }
    }
  }

  private evictOldest(): void {
    let oldestId: string | undefined;
    let oldestCreatedAt = Number.POSITIVE_INFINITY;

    for (const [challengeId, challenge] of this.entries) {
      if (challenge.createdAt < oldestCreatedAt) {
        oldestId = challengeId;
        oldestCreatedAt = challenge.createdAt;
      }
    }

    if (oldestId !== undefined) {
      this.entries.delete(oldestId);
    }
  }

  private nextChallengeId(): string {
    const used = new Set<string>(this.entries.keys());

    for (const challenge of this.entries.values()) {
      for (const question of challenge.questions) {
        used.add(question.id);
      }
    }

    return createUniqueId(this.challengeIdFactory, used);
  }

  private nextQuestionIds(count: number, challengeId: string): readonly string[] {
    const used = new Set<string>([challengeId, ...this.entries.keys()]);

    for (const challenge of this.entries.values()) {
      for (const question of challenge.questions) {
        used.add(question.id);
      }
    }
    const questionIds: string[] = [];

    while (questionIds.length < count) {
      const questionId = createUniqueId(this.questionIdFactory, used);
      used.add(questionId);
      questionIds.push(questionId);
    }

    return Object.freeze(questionIds);
  }

  create(input: CreateStoredChallengeInput): ChallengeState {
    if (
      typeof input !== "object" ||
      input === null ||
      Array.isArray(input)
    ) {
      throw new ChallengeStoreError("invalid_input");
    }

    const now = this.now();

    if (!Number.isSafeInteger(now) || now < 0) {
      throw new ChallengeStoreError("invalid_input");
    }

    this.prune(now);

    const challengeId = this.nextChallengeId();
    const candidateValue = input.candidates;
    const questionCount =
      typeof candidateValue === "object" &&
      candidateValue !== null &&
      !Array.isArray(candidateValue) &&
      "status" in candidateValue &&
      candidateValue.status === "ready" &&
      "candidates" in candidateValue &&
      Array.isArray(candidateValue.candidates)
        ? Math.min(
            candidateValue.candidates.length,
            MAX_CHALLENGE_QUESTIONS,
          )
        : 0;
    const questionIds = this.nextQuestionIds(questionCount, challengeId);
    const stateInput: CreateChallengeStateInput = {
      challengeId,
      questionIds,
      source: input.source,
      seed: input.seed,
      candidates: input.candidates,
      createdAt: now,
      expiresAt: now + this.ttlMs,
    };
    const state = createChallengeState(stateInput);

    while (this.entries.size >= this.maxEntries) {
      this.evictOldest();
    }

    this.entries.set(state.id, state);
    return state;
  }

  get(challengeId: string): ChallengeState {
    const normalizedId = normalizeChallengeId(challengeId);
    const now = this.now();

    if (!Number.isSafeInteger(now) || now < 0) {
      throw new ChallengeStoreError("invalid_input");
    }

    this.prune(now);
    const state = this.entries.get(normalizedId);

    if (state === undefined) {
      throw new ChallengeStoreError("not_found");
    }

    return state;
  }

  getQuestion(
    challengeId: string,
    questionId: string,
  ): Readonly<{ challenge: ChallengeState; question: ChallengeQuestionState; index: number }> {
    const state = this.get(challengeId);

    if (!isOpaqueChallengeId(questionId)) {
      throw new ChallengeStoreError("question_not_found");
    }

    const index = state.questions.findIndex((question) => question.id === questionId);

    if (index < 0) {
      throw new ChallengeStoreError("question_not_found");
    }

    return Object.freeze({
      challenge: state,
      question: state.questions[index],
      index,
    });
  }

  guess(
    challengeId: string,
    questionId: string,
    answers: unknown,
  ): StoredGuessResult {
    const { challenge, question, index } = this.getQuestion(
      challengeId,
      questionId,
    );
    const transition = transitionQuestionGuess(
      question,
      answers,
      challenge.seed,
      index,
    );
    const nextChallenge = updateChallengeQuestion(challenge, transition);

    this.entries.set(nextChallenge.id, nextChallenge);

    return Object.freeze({
      challenge: nextChallenge,
      transition,
    });
  }

  has(challengeId: string): boolean {
    try {
      this.get(challengeId);
      return true;
    } catch (error) {
      if (
        error instanceof ChallengeStoreError &&
        (error.kind === "not_found" || error.kind === "invalid_id")
      ) {
        return false;
      }

      throw error;
    }
  }

  get size(): number {
    this.prune(this.now());
    return this.entries.size;
  }

  reset(): void {
    this.entries.clear();
  }
}

export const challengeStore = new ChallengeStore();
export const defaultChallengeStore = challengeStore;

export function resetChallengeStore(): void {
  challengeStore.reset();
}
