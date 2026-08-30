"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  saveRecoveryPointer,
  submitChallengeGuess,
} from "./challenge-api";
import {
  buildCelebrationQueue,
  ChallengeCelebration,
  type ChallengeCelebrationEvent,
} from "./challenge-celebration";
import { DifficultyProgressRail } from "./difficulty-progress-rail";
import { buildSubmittedAnswers, LyricPuzzle } from "./lyric-puzzle";
import { RoundResult } from "./challenge-result";

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
  return activeIndex >= 0 ? activeIndex : Math.max(challenge.questions.length - 1, 0);
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
  const base = `${question.progress.solved} of ${question.progress.totalAnswerTokens} words solved.`;
  return clueUnlocked ? `${base} Another clue unlocked.` : base;
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
          Recovering your challenge…
        </p>
      </main>
    </div>
  );
}

export function ChallengeGame({ challengeId }: { challengeId: string }) {
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();
  const reducedMotion = prefersReducedMotion ?? false;
  const requestRef = useRef<AbortController | null>(null);
  const celebrationResultKeyRef = useRef<string | null>(null);
  const [challenge, setChallenge] = useState<ChallengeView | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
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
  const [reloadKey, setReloadKey] = useState(0);

  const dismissCelebration = useCallback(() => {
    setCelebrationQueue((current) => current.slice(1));
  }, []);

  const enqueueCelebrations = useCallback(
    (result: ChallengeGuessFinishedView) => {
      const resultKey = `${result.questionId}:${result.result}:${result.attemptsUsed}`;

      if (celebrationResultKeyRef.current === resultKey) {
        return;
      }

      celebrationResultKeyRef.current = resultKey;
      setCelebrationQueue(buildCelebrationQueue(result));
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

  if (challenge === null && loadingError === null) {
    return <LoadingGame />;
  }

  if (challenge === null) {
    const errorCopy = getChallengeErrorCopy(loadingError);

    return (
      <div className="site-shell">
        <main className="mx-auto flex w-full max-w-[760px] min-w-0 flex-1 items-center py-16">
          <section className="w-full rounded-[1.5rem] border border-[var(--border)] bg-[rgba(13,25,29,0.78)] p-7" role="alert">
            <h1 className="text-3xl font-semibold text-[var(--foreground)]">{errorCopy.heading}</h1>
            <p className="mt-3 leading-7 text-[var(--muted-strong)]">{errorCopy.detail}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-bold text-[var(--accent-ink)]" type="button" onClick={() => setReloadKey((key) => key + 1)}>Try again</button>
              {errorCopy.reconnect ? (
                <a className="rounded-full border border-[var(--border-strong)] px-5 py-3 text-sm font-semibold text-[var(--foreground)] no-underline" href="/api/auth/spotify">Reconnect Spotify</a>
              ) : (
                <Link className="rounded-full border border-[var(--border-strong)] px-5 py-3 text-sm font-semibold text-[var(--foreground)] no-underline" href="/albums">Back to library</Link>
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
    if (isSubmitting || roundResult !== null || currentQuestion.status !== "active") {
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
        setChallenge(nextChallenge);
        setFeedback(
          getProgressMessage(nextChallenge.questions[currentIndex], true),
        );
        savePointer(nextChallenge.id, currentIndex);
      } else {
        setRoundResult(result);
        enqueueCelebrations(result);
        setFeedback(
          result.result === "solved"
            ? "You got it."
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

  const actionErrorCopy = actionError === null
    ? null
    : getChallengeErrorCopy(actionError);
  const sourceName = challenge.source.displayName ??
    (challenge.source.kind === "album"
      ? "Selected album"
      : challenge.source.kind === "public-playlist"
        ? "Imported playlist"
        : "Selected playlist");
  const railAttempt = roundResult?.attemptsUsed ?? currentQuestion.attempt;
  const activeTitleHint = roundResult === null
    ? getActiveTitleHint(currentQuestion)
    : undefined;

  return (
    <div className="site-shell">
      <div className="ambient-shader" aria-hidden="true" />
      <ChallengeCelebration
        queue={celebrationQueue}
        onDismiss={dismissCelebration}
      />
      <header className="site-header" aria-label="Challenge navigation">
        <Link className="brand-lockup" href="/">
          <span className="brand-name">
            <span>FillTheLyrics</span>
            <span>{sourceName}</span>
          </span>
        </Link>
        <Link
          className="header-pill no-underline"
          href={challenge.source.kind === "public-playlist" ? "/" : "/albums"}
        >
          Leave game
        </Link>
      </header>

      <main
        className="challenge-main mx-auto w-full max-w-[1120px] min-w-0 flex-1 py-[clamp(3rem,7vw,6rem)]"
        aria-labelledby="challenge-game-heading"
      >
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-[var(--border)] pb-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--accent)]">
              Song {currentIndex + 1} / {challenge.questionCount}
            </p>
            <h1
              className="mt-2 text-[clamp(2rem,5vw,3.6rem)] font-semibold leading-tight tracking-[-0.055em] text-[var(--foreground)]"
              id="challenge-game-heading"
            >
              Rebuild the missing words
            </h1>
          </div>
          <p className="text-sm text-[var(--muted-strong)]" aria-label="Current puzzle progress">
            {currentQuestion.progress.solved} solved · {currentQuestion.progress.revealed} hints
          </p>
        </div>

        <div className="grid min-w-0 gap-6 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-8">
          <DifficultyProgressRail
            attempt={railAttempt}
            finished={roundResult !== null}
          />

          <div className="min-w-0">
            {activeTitleHint !== undefined && (
              <aside
                className="mb-5 rounded-[1.25rem] border border-[rgba(216,185,255,0.32)] bg-[linear-gradient(115deg,rgba(216,185,255,0.1),rgba(157,240,209,0.05))] px-4 py-3 shadow-[inset_0_1px_0_rgba(246,242,255,0.06)] sm:px-5"
                aria-live="polite"
                aria-labelledby={`title-hint-${currentQuestion.id}`}
                role="note"
              >
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--accent)]">
                  Final clue · song title
                </p>
                <p
                  className="mt-1 text-lg font-semibold text-[var(--foreground)]"
                  id={`title-hint-${currentQuestion.id}`}
                >
                  {activeTitleHint}
                </p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted-strong)]">
                  Use the title as a hint. Only lyric words can be submitted.
                </p>
              </aside>
            )}

            <AnimatePresence mode="wait" initial={false}>
              {roundResult ? (
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
                  initial={{ opacity: 0, y: reducedMotion ? 0 : 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: reducedMotion ? 0 : -8 }}
                  transition={{ duration: reducedMotion ? 0 : 0.28, ease: "easeOut" }}
                  aria-label="Lyric answer form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitGuess();
                  }}
                >
                  <LyricPuzzle
                    question={currentQuestion}
                    drafts={drafts}
                    disabled={isSubmitting}
                    onDraftChange={(tokenId, value) => {
                      if (!hiddenIds.has(tokenId)) {
                        return;
                      }

                      setDrafts((current) => ({ ...current, [tokenId]: value }));
                    }}
                  />

                  <div className="glass-panel mt-5 flex flex-col gap-4 rounded-[1.25rem] p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-[var(--foreground)]">
                        Attempt {currentQuestion.attempt} of 4
                      </p>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                        Submit what you know. Empty slots remain unresolved and unlock the next hint.
                      </p>
                    </div>
                    <button
                      className="inline-flex min-h-12 flex-none items-center justify-center rounded-full bg-[var(--accent)] px-6 text-sm font-bold text-[var(--accent-ink)] transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-65"
                      type="submit"
                      disabled={isSubmitting}
                      aria-busy={isSubmitting}
                    >
                      {isSubmitting
                        ? "Checking…"
                        : currentQuestion.attempt === 4
                          ? "Submit final attempt"
                          : "Check words"}
                    </button>
                  </div>
                </motion.form>
              )}
            </AnimatePresence>

            <div
              className="mt-4 min-h-12"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {feedback && <p className="text-sm font-semibold text-[var(--teal)]">{feedback}</p>}
              {actionErrorCopy && (
                <div className="rounded-xl border border-[rgba(255,181,140,0.32)] bg-[rgba(111,47,27,0.18)] p-3" role="alert">
                  <p className="font-semibold text-[var(--foreground)]">{actionErrorCopy.heading}</p>
                  <p className="mt-1 text-sm text-[var(--muted-strong)]">{actionErrorCopy.detail}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
