"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BrandWordmark } from "../fillthelyrics/visual/brand-wordmark";
import { HandwrittenAnnotation } from "../fillthelyrics/visual/handwritten-annotation";
import { StageAtmosphere } from "../fillthelyrics/visual/stage-atmosphere";
import type {
  ChallengeGuessContinueView,
  ChallengeGuessFinishedView,
  ChallengeQuestionView,
  ChallengeView,
} from "../../types/challenge";
import {
  ChallengeClientError,
  clearRecoveryPointer,
  getChallenge,
  getChallengeErrorCopy,
  readRecoveryPointer,
  requestChallengePlayback,
  requestChallengePlaybackWarmup,
  saveRecoveryPointer,
  submitChallengeGuess,
} from "./challenge-api";
import {
  buildCelebrationQueue,
  ChallengeCelebration,
  phaseForCelebrationEvent,
  type ChallengeCelebrationEvent,
  type CelebrationPresentationPhase,
} from "./challenge-celebration";
import { DifficultyProgressRail } from "./difficulty-progress-rail";
import {
  buildSubmittedAnswers,
  getFirstUnresolvedGapId,
  getHiddenSlotDescriptors,
  LyricPuzzle,
} from "./lyric-puzzle";
import { RoundResult } from "./challenge-result";

const activeWarmupRequests = new Map<string, Promise<unknown>>();

/**
 * Deduplicate the Strict Mode effect probe and remounts for one opaque
 * challenge/question pair. The acknowledgement is intentionally fire-and-
 * forget: warmup failure never becomes gameplay state.
 */
export function startChallengePlaybackWarmup(
  challengeId: string,
  questionId: string,
): void {
  const key = `${challengeId}\u0000${questionId}`;
  const existing = activeWarmupRequests.get(key);

  if (existing !== undefined) {
    return;
  }

  const request = requestChallengePlaybackWarmup(challengeId, questionId);
  activeWarmupRequests.set(key, request);

  void request.then(
    () => {
      if (activeWarmupRequests.get(key) === request) {
        activeWarmupRequests.delete(key);
      }
    },
    () => {
      if (activeWarmupRequests.get(key) === request) {
        activeWarmupRequests.delete(key);
      }
    },
  );
}

export function findPlayableQuestionIndex(
  challenge: ChallengeView,
  preferredIndex = 0,
): number {
  if (
    Number.isSafeInteger(preferredIndex) &&
    preferredIndex >= 0 &&
    preferredIndex < challenge.questions.length &&
    challenge.questions[preferredIndex]?.status === "active"
  ) {
    return preferredIndex;
  }

  const activeIndex = challenge.questions.findIndex(
    (question) => question.status === "active",
  );
  return activeIndex >= 0
    ? activeIndex
    : Math.max(challenge.questions.length - 1, 0);
}

export function applyContinueResult(
  challenge: ChallengeView,
  result: ChallengeGuessContinueView,
): ChallengeView {
  const index = challenge.questions.findIndex(
    (question) => question.id === result.questionId,
  );

  if (index < 0) {
    throw new TypeError("Guess response does not belong to this challenge.");
  }

  const question: ChallengeQuestionView = Object.freeze({
    id: result.questionId,
    attempt: result.attempt,
    maxAttempts: result.maxAttempts,
    status: "active",
    lines: result.lines,
    hiddenTokenIds: result.hiddenTokenIds,
    progress: result.progress,
    ...(result.attempt === 4 && result.titleHint !== undefined
      ? { titleHint: result.titleHint }
      : {}),
  });
  const questions = [...challenge.questions];
  questions[index] = question;

  return Object.freeze({
    ...challenge,
    questions: Object.freeze(questions),
    questionCount: result.questionCount,
    completedQuestionCount: result.completedQuestionCount,
    complete: result.complete,
  });
}

export function getActiveTitleHint(
  question: ChallengeQuestionView | undefined,
): string | undefined {
  if (
    question?.status !== "active" ||
    question.attempt !== 4 ||
    typeof question.titleHint !== "string" ||
    question.titleHint.trim().length === 0
  ) {
    return undefined;
  }

  return question.titleHint;
}

export function getProgressMessage(
  question: ChallengeQuestionView,
  clueUnlocked = false,
): string {
  void question;
  return clueUnlocked ? "Another clue unlocked." : "Keep going.";
}

export function getGameplayAtmosphereIntensity(
  question: ChallengeQuestionView,
  roundResult: ChallengeGuessFinishedView | null = null,
): "expert" | "hard" | "medium" | "easy" | "solved" {
  if (roundResult?.result === "solved") {
    return "solved";
  }

  switch (question.attempt) {
    case 1:
      return "expert";
    case 2:
      return "hard";
    case 3:
      return "medium";
    case 4:
      return "easy";
  }
}

/**
 * Keep target movement deterministic when a server response removes the
 * selected gap. The next still-unresolved slot after the previous target is
 * preferred; wrapping to the first available slot keeps inline editing usable.
 */
export function getNextGapAfterAttempt(
  previousQuestion: ChallengeQuestionView,
  nextQuestion: ChallengeQuestionView,
  previousGapId: string | null,
): string | null {
  const nextSlots = getHiddenSlotDescriptors(nextQuestion);
  if (nextSlots.length === 0) {
    return null;
  }

  const previousSlots = getHiddenSlotDescriptors(previousQuestion);
  const previousIndex = previousSlots.findIndex(
    (slot) => slot.id === previousGapId,
  );

  if (previousIndex >= 0) {
    const laterId = previousSlots
      .slice(previousIndex + 1)
      .map((slot) => slot.id)
      .find((id) => nextSlots.some((slot) => slot.id === id));

    if (laterId !== undefined) {
      return laterId;
    }
  }

  return (
    nextSlots.find((slot) => slot.id !== previousGapId)?.id ??
    nextSlots[0]?.id ??
    null
  );
}

/**
 * The first unresolved gap is the only automatic target at a new
 * question/attempt boundary. Once the player is editing, native focus and
 * pointer interaction own target movement; an attempt transition must not
 * carry a previous cursor position into a different layout.
 */
export function getAttemptStartGapId(
  question: ChallengeQuestionView,
): string | null {
  return getFirstUnresolvedGapId(question);
}

function savePointer(challengeId: string, currentQuestionIndex: number): void {
  try {
    saveRecoveryPointer(window.localStorage, {
      challengeId,
      currentQuestionIndex,
      updatedAt: Date.now(),
    });
  } catch {
    // Storage is optional; route state and the server remain authoritative.
  }
}

function LoadingGame() {
  return (
    <div className="site-shell">
      <main className="mx-auto flex w-full max-w-[1080px] min-w-0 flex-1 items-center py-16">
        <p role="status" aria-live="polite" className="text-[var(--muted-strong)]">
          Recovering your challenge...
        </p>
      </main>
    </div>
  );
}

export function ChallengeGame({ challengeId }: { challengeId: string }) {
  // One presentation sequence: gameplay -> celebrating-perfect ->
  // celebrating-streak -> round-complete. Empty queue skips both overlays.
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();
  const reducedMotion = prefersReducedMotion ?? false;
  const requestRef = useRef<AbortController | null>(null);
  const celebrationResultKeyRef = useRef<string | null>(null);
  const [challenge, setChallenge] = useState<ChallengeView | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeGapId, setActiveGapId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loadingError, setLoadingError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [roundResult, setRoundResult] =
    useState<ChallengeGuessFinishedView | null>(null);
  const [celebrationQueue, setCelebrationQueue] = useState<
    readonly ChallengeCelebrationEvent[]
  >([]);
  const [presentationPhase, setPresentationPhase] =
    useState<CelebrationPresentationPhase>("gameplay");
  const [reloadKey, setReloadKey] = useState(0);

  const dismissCelebration = useCallback(() => {
    setCelebrationQueue((current) => {
      const remaining = current.slice(1);
      setPresentationPhase(phaseForCelebrationEvent(remaining[0]));
      return remaining;
    });
  }, []);

  const enqueueCelebrations = useCallback(
    (result: ChallengeGuessFinishedView) => {
      const resultKey = `${result.questionId}:${result.result}:${result.attemptsUsed}`;

      if (celebrationResultKeyRef.current === resultKey) {
        return;
      }

      celebrationResultKeyRef.current = resultKey;
      const queue = buildCelebrationQueue(result);
      setCelebrationQueue(queue);
      setPresentationPhase(phaseForCelebrationEvent(queue[0]));
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    requestRef.current = controller;

    void getChallenge(challengeId, { signal: controller.signal })
      .then((value) => {
        celebrationResultKeyRef.current = null;
        setCelebrationQueue([]);
        setPresentationPhase("gameplay");

        if (value.complete) {
          router.replace(`/results/${encodeURIComponent(value.id)}`);
          return;
        }

        let preferredIndex = 0;

        try {
          const pointer = readRecoveryPointer(window.localStorage);
          if (pointer?.challengeId === value.id) {
            preferredIndex = pointer.currentQuestionIndex;
          }
        } catch {
          // Optional recovery storage cannot block authoritative hydration.
        }

        const nextIndex = findPlayableQuestionIndex(value, preferredIndex);
        setChallenge(value);
        setCurrentIndex(nextIndex);
        setActiveGapId(getAttemptStartGapId(value.questions[nextIndex]));
        setLoadingError(null);
        savePointer(value.id, nextIndex);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        if (
          error instanceof ChallengeClientError &&
          error.code === "CHALLENGE_NOT_FOUND"
        ) {
          try {
            clearRecoveryPointer(window.localStorage);
          } catch {
            // Optional cleanup cannot block the expired-state message.
          }
        }

        setLoadingError(error);
      });

    return () => {
      controller.abort();
      if (requestRef.current === controller) {
        requestRef.current = null;
      }
    };
  }, [challengeId, reloadKey, router]);

  const currentQuestion = challenge?.questions[currentIndex];
  const hiddenIds = useMemo(
    () => new Set(currentQuestion?.hiddenTokenIds ?? []),
    [currentQuestion],
  );
  const warmupChallengeId = challenge?.id;
  const warmupQuestionId =
    roundResult === null && currentQuestion?.status === "active"
      ? currentQuestion.id
      : undefined;

  useEffect(() => {
    if (warmupChallengeId === undefined || warmupQuestionId === undefined) {
      return;
    }

    startChallengePlaybackWarmup(warmupChallengeId, warmupQuestionId);
  }, [warmupChallengeId, warmupQuestionId]);

  if (challenge === null && loadingError === null) {
    return <LoadingGame />;
  }

  if (challenge === null) {
    const errorCopy = getChallengeErrorCopy(loadingError);

    return (
      <div className="site-shell">
        <main className="mx-auto flex w-full max-w-[760px] min-w-0 flex-1 items-center py-16">
          <section
            className="w-full rounded-[1.5rem] border border-[var(--border)] bg-[rgba(13,25,29,0.78)] p-7"
            role="alert"
          >
            <h1 className="text-3xl font-semibold text-[var(--foreground)]">
              {errorCopy.heading}
            </h1>
            <p className="mt-3 leading-7 text-[var(--muted-strong)]">
              {errorCopy.detail}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-bold text-[var(--accent-ink)]"
                type="button"
                onClick={() => setReloadKey((key) => key + 1)}
              >
                Try again
              </button>
              {errorCopy.reconnect ? (
                <a
                  className="rounded-full border border-[var(--border-strong)] px-5 py-3 text-sm font-semibold text-[var(--foreground)] no-underline"
                  href="/api/auth/spotify"
                >
                  Reconnect Spotify
                </a>
              ) : (
                <Link
                  className="rounded-full border border-[var(--border-strong)] px-5 py-3 text-sm font-semibold text-[var(--foreground)] no-underline"
                  href="/albums"
                >
                  Back to library
                </Link>
              )}
            </div>
          </section>
        </main>
      </div>
    );
  }

  if (currentQuestion === undefined) {
    return <LoadingGame />;
  }

  const submitGuess = async () => {
    if (
      isSubmitting ||
      roundResult !== null ||
      currentQuestion.status !== "active"
    ) {
      return;
    }

    setIsSubmitting(true);
    setActionError(null);
    const answers = buildSubmittedAnswers(currentQuestion, drafts);

    try {
      const result = await submitChallengeGuess(
        challenge.id,
        currentQuestion.id,
        answers,
      );

      setDrafts({});

      if (result.result === "continue") {
        const nextChallenge = applyContinueResult(challenge, result);
        const nextQuestion = nextChallenge.questions[currentIndex];
        setChallenge(nextChallenge);
        setActiveGapId(
          nextQuestion === undefined ? null : getAttemptStartGapId(nextQuestion),
        );
        setFeedback(
          nextQuestion === undefined
            ? "Another clue unlocked."
            : getProgressMessage(nextQuestion, true),
        );
        savePointer(nextChallenge.id, currentIndex);
      } else {
        setRoundResult(result);
        setActiveGapId(null);
        enqueueCelebrations(result);
        setFeedback(
          result.result === "solved"
            ? ""
            : "Final attempt complete. The selected fragment is now revealed.",
        );
        savePointer(challenge.id, currentIndex);
      }
    } catch (error) {
      if (
        error instanceof ChallengeClientError &&
        error.code === "CHALLENGE_NOT_FOUND"
      ) {
        try {
          clearRecoveryPointer(window.localStorage);
        } catch {
          // Optional cleanup cannot block the action error.
        }
      }
      setActionError(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const advance = async () => {
    if (roundResult === null || isAdvancing) {
      return;
    }

    celebrationResultKeyRef.current = null;
    setCelebrationQueue([]);
    setPresentationPhase("gameplay");

    if (roundResult.complete) {
      try {
        clearRecoveryPointer(window.localStorage);
      } catch {
        // Optional storage cleanup must not block navigation.
      }
      router.push(`/results/${encodeURIComponent(challenge.id)}`);
      return;
    }

    setIsAdvancing(true);
    setActionError(null);

    try {
      const refreshed = await getChallenge(challenge.id);

      if (refreshed.complete) {
        router.push(`/results/${encodeURIComponent(refreshed.id)}`);
        return;
      }

      const nextIndex = findPlayableQuestionIndex(refreshed, currentIndex + 1);
      setChallenge(refreshed);
      setCurrentIndex(nextIndex);
      setRoundResult(null);
      setDrafts({});
      setActiveGapId(getAttemptStartGapId(refreshed.questions[nextIndex]));
      setFeedback("");
      savePointer(refreshed.id, nextIndex);
    } catch (error) {
      if (
        error instanceof ChallengeClientError &&
        error.code === "CHALLENGE_NOT_FOUND"
      ) {
        try {
          clearRecoveryPointer(window.localStorage);
        } catch {
          // Optional cleanup cannot block the action error.
        }
      }
      setActionError(error);
    } finally {
      setIsAdvancing(false);
    }
  };

  const actionErrorCopy =
    actionError === null ? null : getChallengeErrorCopy(actionError);
  const railAttempt = roundResult?.attemptsUsed ?? currentQuestion.attempt;
  const activeTitleHint =
    roundResult === null ? getActiveTitleHint(currentQuestion) : undefined;
  const atmosphereIntensity = getGameplayAtmosphereIntensity(
    currentQuestion,
    roundResult,
  );
  const graffitiCopy =
    currentQuestion.attempt === 1
      ? "One word at a time"
      : currentQuestion.attempt === 4
        ? "Almost there"
        : "Keep going";

  return (
    <StageAtmosphere
      intensity={atmosphereIntensity}
      className={`ftl-gameplay-page-shell ftl-gameplay-page-shell--${atmosphereIntensity}`}
    >
      <div
        className={`ftl-gameplay-page ftl-gameplay-page--${presentationPhase}`}
        data-presentation-phase={presentationPhase}
      >
        <ChallengeCelebration
          queue={celebrationQueue}
          onDismiss={dismissCelebration}
        />
        <header className="ftl-gameplay-header" aria-label="Challenge navigation">
          <BrandWordmark ariaLabel="FillTheLyrics" />
          <div
            className="ftl-gameplay-header__stats"
            aria-label="Challenge progress"
          >
            <span>
              Song {currentIndex + 1} / {challenge.questionCount}
            </span>
            <span aria-hidden="true">|</span>
            <span>Attempt {railAttempt} / 4</span>
          </div>
          <Link
            className="ftl-gameplay-header__leave"
            href={challenge.source.kind === "public-playlist" ? "/" : "/albums"}
          >
            Leave Game
          </Link>
        </header>

        <main className="ftl-gameplay-main" aria-labelledby="challenge-game-heading">
          <h1 className="sr-only" id="challenge-game-heading">
            FillTheLyrics lyric challenge
          </h1>
          <div className="ftl-gameplay-layout">
            <DifficultyProgressRail
              attempt={railAttempt}
              finished={roundResult !== null}
            />

            <section
              className="ftl-gameplay-content"
              aria-label="Active lyric challenge"
            >
              <HandwrittenAnnotation
                text={graffitiCopy}
                tone={currentQuestion.attempt === 1 ? "purple" : "mint"}
                rotateDeg={currentQuestion.attempt === 1 ? -5 : 4}
                underline="single"
                className="ftl-gameplay-note hidden md:block"
              />
              {activeTitleHint !== undefined && (
                <aside
                  className="ftl-gameplay-title-hint"
                  aria-live="polite"
                  aria-labelledby={`title-hint-${currentQuestion.id}`}
                  role="note"
                >
                  <span
                    className="ftl-gameplay-title-hint__signal"
                    aria-hidden="true"
                  >
                    ♫
                  </span>
                  <div>
                    <p className="ftl-gameplay-title-hint__eyebrow">One last clue</p>
                    <p className="ftl-gameplay-title-hint__label">
                      Song title: <strong id={`title-hint-${currentQuestion.id}`}>{activeTitleHint}</strong>
                    </p>
                  </div>
                </aside>
              )}

              <AnimatePresence mode="wait" initial={false}>
                {/* presentationPhase === "round-complete" is the final queue phase;
                    Round Complete stays mounted underneath a temporary overlay
                    so the accepted terminal surface remains immediately readable. */}
                {roundResult !== null ? (
                  <RoundResult
                    key={`result-${currentQuestion.id}`}
                    result={roundResult}
                    advancing={isAdvancing}
                    onAdvance={() => void advance()}
                    onPlaybackRequest={(signal) =>
                      requestChallengePlayback(
                        challenge.id,
                        currentQuestion.id,
                        { signal },
                      )
                    }
                  />
                ) : (
                  <motion.form
                    key={`question-${currentQuestion.id}-${currentQuestion.attempt}`}
                    className="ftl-gameplay-form"
                    data-attempt={currentQuestion.attempt}
                    initial={{ opacity: 0, y: reducedMotion ? 0 : 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: reducedMotion ? 0 : -8 }}
                    transition={{ duration: reducedMotion ? 0 : 0.28, ease: "easeOut" }}
                    aria-label="Lyric answer form"
                    onSubmit={(event) => {
                      // The explicit Check Words button owns validation. This
                      // guard also protects against an implicit submit from
                      // browser/assistive-tech form behavior.
                      event.preventDefault();
                    }}
                  >
                    <LyricPuzzle
                      question={currentQuestion}
                      drafts={drafts}
                      activeGapId={activeGapId}
                      disabled={isSubmitting}
                      onSelectGap={(tokenId) => {
                        if (hiddenIds.has(tokenId)) {
                          setActiveGapId(tokenId);
                        }
                      }}
                      onDraftChange={(tokenId, value) => {
                        if (!hiddenIds.has(tokenId)) {
                          return;
                        }

                        setDrafts((current) => ({
                          ...current,
                          [tokenId]: value,
                        }));
                      }}
                    >
                      <div className="ftl-gameplay-action-row">
                        <button
                          className="ftl-gameplay-submit"
                          type="button"
                          disabled={isSubmitting || roundResult !== null}
                          aria-busy={isSubmitting}
                          onClick={() => void submitGuess()}
                        >
                          {isSubmitting ? "Checking..." : "Check Words"}
                        </button>
                      </div>
                    </LyricPuzzle>
                  </motion.form>
                )}
              </AnimatePresence>

              <div
                className="ftl-gameplay-feedback"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {feedback && <p>{feedback}</p>}
                {actionErrorCopy && (
                  <div role="alert">
                    <p>{actionErrorCopy.heading}</p>
                    <p>{actionErrorCopy.detail}</p>
                  </div>
                )}
              </div>
            </section>
          </div>
        </main>
      </div>
    </StageAtmosphere>
  );
}
