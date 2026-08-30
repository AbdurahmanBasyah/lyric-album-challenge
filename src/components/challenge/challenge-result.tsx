"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import type {
  ChallengeGuessFinishedView,
  ChallengeView,
} from "../../types/challenge";
import {
  ChallengeClientError,
  clearRecoveryPointer,
  createChallengeIntroUrl,
  getChallenge,
  getChallengeErrorCopy,
} from "./challenge-api";
import {
  ChallengePlayback,
  type PlaybackRequest,
} from "./challenge-playback";

export function RoundResult({
  result,
  advancing,
  onAdvance,
  onPlaybackRequest,
}: {
  result: ChallengeGuessFinishedView;
  advancing: boolean;
  onAdvance: () => void;
  onPlaybackRequest?: PlaybackRequest;
}) {
  const prefersReducedMotion = useReducedMotion();
  const reducedMotion = prefersReducedMotion ?? false;
  const solved = result.result === "solved";
  const advanceButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    // Submitting a terminal attempt removes the answer form. Move focus to
    // the first available next action so keyboard users do not lose their
    // place while the optional playback surface initializes.
    advanceButtonRef.current?.focus();
  }, [result.attemptsUsed, result.questionId]);

  return (
    <motion.section
      className="glass-panel glass-panel-strong rounded-[1.5rem] p-5 sm:p-8"
      initial={{ opacity: 0, y: reducedMotion ? 0 : 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.34, ease: "easeOut" }}
      aria-labelledby="round-result-heading"
      role="region"
    >
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--accent)]">
        {solved ? "Solved" : "Round complete"}
      </p>
      <h2
        id="round-result-heading"
        className="mt-3 text-[clamp(2rem,5vw,3.5rem)] font-semibold leading-tight tracking-[-0.05em] text-[var(--foreground)]"
      >
        {solved ? "You got it." : "Here is the full fragment."}
      </h2>

      <div className="mt-7 space-y-3 border-l-2 border-[rgba(157,240,209,0.5)] pl-4 sm:pl-6">
        {result.reveal.lines.map((line, index) => (
          <p
            className="text-lg leading-8 text-[var(--foreground)] sm:text-xl"
            key={`${result.questionId}-reveal-${index}`}
          >
            {line}
          </p>
        ))}
      </div>

      <p className="mt-7 text-base font-semibold text-[var(--foreground)]">
        {result.reveal.trackName}
        <span className="font-normal text-[var(--muted-strong)]">
          {" — "}
          {result.reveal.artistNames.join(", ")}
        </span>
      </p>
      <p className="mt-2 text-sm text-[var(--muted)]">
        {result.progress.solved} solved by you · {result.progress.revealed} revealed as hints · {result.attemptsUsed} {result.attemptsUsed === 1 ? "attempt" : "attempts"}
      </p>

      <ChallengePlayback
        reveal={result.reveal}
        requestPlayback={onPlaybackRequest}
      />

      <button
        className="mt-8 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[var(--accent)] px-6 text-sm font-bold text-[var(--accent-ink)] transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-65 sm:w-auto"
        type="button"
        disabled={advancing}
        aria-busy={advancing}
        ref={advanceButtonRef}
        onClick={onAdvance}
      >
        {advancing
          ? "Loading…"
          : result.complete
            ? "See results"
            : "Next song"}
      </button>
    </motion.section>
  );
}

function ResultsContent({ challenge }: { challenge: ChallengeView }) {
  const sourceName = challenge.source.displayName ??
    (challenge.source.kind === "album"
      ? "Selected album"
      : challenge.source.kind === "public-playlist"
        ? "Imported playlist"
        : "Selected playlist");
  const isPublicPlaylist = challenge.source.kind === "public-playlist";
  const solvedCount = challenge.questions.filter(
    (question) => question.status === "solved",
  ).length;
  const retryUrl = createChallengeIntroUrl(challenge.source);
  const score = challenge.complete ? challenge.score : undefined;

  return (
    <>
      <p className="eyebrow">
        <span className="eyebrow-line" aria-hidden="true" />
        Challenge results
      </p>
      <h1
        className="mt-5 max-w-[13ch] text-[clamp(2.8rem,7vw,5.7rem)] font-[560] leading-[0.96] tracking-[-0.075em] text-[var(--foreground)]"
        id="challenge-results-heading"
      >
        {sourceName}
      </h1>
      {score ? (
        <section
          className="mt-6 grid gap-5 rounded-[1.5rem] border border-[rgba(216,185,255,0.32)] bg-[linear-gradient(115deg,rgba(216,185,255,0.1),rgba(157,240,209,0.05))] p-5 shadow-[inset_0_1px_0_rgba(246,242,255,0.06)] sm:grid-cols-[minmax(10rem,0.7fr)_minmax(0,1fr)] sm:p-6"
          aria-labelledby="challenge-score-heading"
        >
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--accent)]">
              Final score
            </p>
            <p
              className="mt-2 text-[clamp(2.8rem,8vw,4.8rem)] font-semibold leading-none tracking-[-0.07em] text-[var(--foreground)]"
              id="challenge-score-heading"
            >
              {score.total}
              <span className="ml-1 text-lg font-medium tracking-normal text-[var(--muted-strong)]">
                / 100
              </span>
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">
              {solvedCount} of {challenge.questionCount} songs solved.
            </p>
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
              Song scores
            </p>
            <ol className="mt-3 grid gap-2">
              {score.songs.map((song, index) => {
                const question = challenge.questions.find(
                  (candidate) => candidate.id === song.questionId,
                );
                const label = question?.reveal?.trackName ?? `Song ${index + 1}`;

                return (
                  <li
                    className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[rgba(17,22,51,0.54)] px-3 py-2.5 text-sm"
                    key={song.questionId}
                  >
                    <span className="min-w-0 truncate text-[var(--foreground)]">
                      {label}
                    </span>
                    <span className="flex-none whitespace-nowrap font-semibold text-[var(--accent)]">
                      {song.score} / 100
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>
      ) : (
        <p className="mt-5 text-base leading-7 text-[var(--muted-strong)]">
          {solvedCount} of {challenge.questionCount} songs solved. No score yet
          — finish the challenge to see your score.
        </p>
      )}

      <ol className="mt-10 grid gap-4">
        {challenge.questions.map((question, index) => (
          <li
            className="glass-panel rounded-[1.25rem] p-5 sm:p-6"
            key={question.id}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                  Song {index + 1}
                </p>
                <h2 className="mt-2 text-xl font-semibold text-[var(--foreground)]">
                  {question.reveal?.trackName ?? "Unfinished song"}
                </h2>
                {question.reveal && (
                  <>
                    <p className="mt-1 text-sm text-[var(--muted-strong)]">
                      {question.reveal.artistNames.join(", ")}
                    </p>
                    <div className="mt-4 space-y-1 border-l border-[var(--border-strong)] pl-3">
                      {question.reveal.lines.map((line, lineIndex) => (
                        <p
                          className="text-sm leading-6 text-[var(--muted-strong)]"
                          key={`${question.id}-result-line-${lineIndex}`}
                        >
                          {line}
                        </p>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.1em] ${
                question.status === "solved"
                  ? "border-[rgba(157,240,209,0.42)] text-[var(--teal)]"
                  : question.status === "failed"
                    ? "border-[rgba(255,181,140,0.35)] text-[#ffc0a0]"
                    : "border-[var(--border)] text-[var(--muted)]"
              }`}>
                {question.status}
              </span>
            </div>

            <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-[var(--border)] pt-4 text-sm">
              <div>
                <dt className="text-[var(--muted)]">Attempts</dt>
                <dd className="mt-1 font-semibold text-[var(--foreground)]">{question.attempt}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Solved</dt>
                <dd className="mt-1 font-semibold text-[var(--foreground)]">{question.progress.solved}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Hints</dt>
                <dd className="mt-1 font-semibold text-[var(--foreground)]">{question.progress.revealed}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>

      <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Link
          className="result-action inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[var(--accent)] px-6 text-sm font-bold text-[var(--accent-ink)] no-underline sm:w-auto"
          href={retryUrl}
        >
          Retry this source
        </Link>
        <Link
          className="result-action inline-flex min-h-12 w-full items-center justify-center rounded-full border border-[var(--border-strong)] px-6 text-sm font-semibold text-[var(--foreground)] no-underline sm:w-auto"
          href={isPublicPlaylist ? "/" : "/albums"}
        >
          {isPublicPlaylist ? "Import another playlist" : "Choose another source"}
        </Link>
        {!challenge.complete && (
          <Link
            className="result-action inline-flex min-h-12 w-full items-center justify-center rounded-full border border-[var(--border-strong)] px-6 text-sm font-semibold text-[var(--foreground)] no-underline sm:w-auto"
            href={`/play/${encodeURIComponent(challenge.id)}`}
          >
            Continue challenge
          </Link>
        )}
      </div>
    </>
  );
}

export function ChallengeResults({ challengeId }: { challengeId: string }) {
  const [challenge, setChallenge] = useState<ChallengeView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    void getChallenge(challengeId, { signal: controller.signal })
      .then((value) => {
        setChallenge(value);
        setError(null);

        if (value.complete) {
          try {
            clearRecoveryPointer(window.localStorage);
          } catch {
            // Optional storage cleanup must not block the result screen.
          }
        }
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof Error && requestError.name === "AbortError") {
          return;
        }

        if (
          requestError instanceof ChallengeClientError &&
          requestError.code === "CHALLENGE_NOT_FOUND"
        ) {
          try {
            clearRecoveryPointer(window.localStorage);
          } catch {
            // Optional cleanup cannot block the expired-state message.
          }
        }

        setError(requestError);
      });

    return () => controller.abort();
  }, [challengeId, reloadKey]);

  const errorCopy = error === null ? null : getChallengeErrorCopy(error);

  return (
    <div className="site-shell">
      <div className="ambient-shader" aria-hidden="true" />
      <header className="site-header">
        <Link className="brand-lockup" href="/">
          <span className="brand-name">
            <span>FillTheLyrics</span>
            <span>Results</span>
          </span>
        </Link>
        <Link className="header-pill no-underline" href={challenge?.source.kind === "public-playlist" ? "/" : "/albums"}>
          {challenge?.source.kind === "public-playlist" ? "Import" : "Library"}
        </Link>
      </header>
      <main
        className="challenge-results-main mx-auto w-full max-w-[920px] min-w-0 flex-1 py-[clamp(4rem,9vw,7rem)]"
      >
        {challenge ? (
          <ResultsContent challenge={challenge} />
        ) : errorCopy ? (
          <section role="alert" className="glass-panel rounded-[1.5rem] p-7">
            <h1 className="text-3xl font-semibold text-[var(--foreground)]">{errorCopy.heading}</h1>
            <p className="mt-3 text-[var(--muted-strong)]">{errorCopy.detail}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-bold text-[var(--accent-ink)]" type="button" onClick={() => setReloadKey((key) => key + 1)}>Try again</button>
              {errorCopy.reconnect && (
                <a className="rounded-full border border-[rgba(124,245,188,0.42)] px-5 py-3 text-sm font-semibold text-[var(--accent)] no-underline" href="/api/auth/spotify">Reconnect Spotify</a>
              )}
              <Link className="rounded-full border border-[var(--border-strong)] px-5 py-3 text-sm font-semibold text-[var(--foreground)] no-underline" href="/albums">Back to library</Link>
            </div>
          </section>
        ) : (
          <p role="status" aria-live="polite" className="text-[var(--muted-strong)]">Loading results…</p>
        )}
      </main>
    </div>
  );
}
