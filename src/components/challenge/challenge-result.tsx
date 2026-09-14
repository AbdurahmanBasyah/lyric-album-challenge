"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { BrandWordmark } from "../fillthelyrics/visual/brand-wordmark";
import { HandwrittenAnnotation } from "../fillthelyrics/visual/handwritten-annotation";
import { StageAtmosphere } from "../fillthelyrics/visual/stage-atmosphere";
import {
  getBestSolvedSongStreak,
  getPerfectQuestionCount,
  isPerfectQuestion,
} from "../../lib/challenge/challenge-result-metrics";
import type {
  ChallengeGuessFinishedView,
  ChallengeQuestionView,
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
      className={`ftl-round-complete ftl-round-complete--${solved ? "solved" : "failed"}`}
      initial={{ opacity: 0, y: reducedMotion ? 0 : 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.34, ease: "easeOut" }}
      aria-labelledby="round-result-heading"
      role="region"
    >
      <div className="ftl-round-complete__content">
        <p className="ftl-round-complete__eyebrow">
          <span aria-hidden="true" className="ftl-round-complete__eyebrow-mark" />
          {solved ? "Round solved" : "Round complete"}
        </p>
        <h2 id="round-result-heading" className="ftl-round-complete__heading">
          {solved ? "You got it." : "Here is the full fragment."}
        </h2>

      <div className="ftl-round-complete__lyrics" aria-label="Full four-line lyric fragment">
        {result.reveal.lines.map((line, index) => (
          <p
            className="ftl-round-complete__lyric-line"
            key={`${result.questionId}-reveal-${index}`}
          >
            {line}
          </p>
        ))}
      </div>

        <div className="ftl-round-complete__identity">
          <p className="ftl-round-complete__track">
            {result.reveal.trackName}
          </p>
          <p className="ftl-round-complete__artist">
            {result.reveal.artistNames.join(", ")}
          </p>
        </div>

      <dl className="ftl-round-complete__stats" aria-label="Round performance">
        <div>
          <dt>Attempts</dt>
          <dd>{result.attemptsUsed} / 4</dd>
        </div>
        <div>
          <dt>Solved</dt>
          <dd>{result.progress.solved}</dd>
        </div>
        <div>
          <dt>Hints</dt>
          <dd>{result.progress.revealed}</dd>
        </div>
      </dl>
      </div>

      <div className="ftl-round-complete__media">
        <ChallengePlayback
          reveal={result.reveal}
          requestPlayback={onPlaybackRequest}
        />
      </div>

      <div className="ftl-round-complete__actions">
      <button
        className="result-action ftl-round-complete__advance"
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
      </div>
    </motion.section>
  );
}

export type ChallengeResultTrack = Readonly<{
  questionId: string;
  index: number;
  title: string | null;
  artist: string | null;
  score: number | null;
  solved: boolean;
  perfect: boolean;
  status: ChallengeQuestionView["status"];
}>;

export type ChallengeResultMetrics = Readonly<{
  finalScore: number | null;
  solvedCount: number;
  perfectCount: number;
  bestStreak: number;
}>;

/**
 * Derive display metrics from the authoritative challenge view. The total
 * score is never recalculated in the browser: incomplete views intentionally
 * return null, while complete views use the server-owned score total.
 */
export function deriveChallengeResultMetrics(
  challenge: Pick<ChallengeView, "questions" | "questionCount" | "complete" | "score">,
): ChallengeResultMetrics {
  // Per-question progress remains server-rendered source data: question.progress.solved
  // and question.progress.revealed are never used to recalculate the score.
  return Object.freeze({
    finalScore:
      challenge.complete && challenge.score !== undefined
        ? challenge.score.total
        : null,
    solvedCount: challenge.questions.filter(
      (question) => question.status === "solved",
    ).length,
    perfectCount: getPerfectQuestionCount(challenge.questions),
    bestStreak: getBestSolvedSongStreak(challenge.questions),
  });
}

/** Build one compact row for every challenge question, preserving order. */
export function buildChallengeResultTracks(
  challenge: ChallengeView,
): readonly ChallengeResultTrack[] {
  const score = challenge.complete ? challenge.score : undefined;
  const scoreByQuestionId = new Map(
    score === undefined
      ? []
      : score.songs.map((song) => [song.questionId, song.score] as const),
  );

  return Object.freeze(
    challenge.questions.map((question, index) => {
      const reveal = question.reveal;
      return Object.freeze({
        questionId: question.id,
        index,
        title: reveal?.trackName ?? null,
        artist: reveal?.artistNames.join(", ") ?? null,
        score: scoreByQuestionId.get(question.id) ?? null,
        solved: question.status === "solved",
        perfect: isPerfectQuestion(question),
        status: question.status,
      });
    }),
  );
}

function resultSourceName(challenge: ChallengeView): string {
  return challenge.source.displayName ??
    (challenge.source.kind === "album"
      ? "Selected album"
      : challenge.source.kind === "public-playlist"
        ? "Imported playlist"
        : "Selected playlist");
}

function resultHeadline(metrics: ChallengeResultMetrics): string {
  if (metrics.solvedCount === 0) {
    return "KEEP THE SONGS CLOSE.";
  }

  if (metrics.perfectCount > 0) {
    return "YOU KNEW MORE THAN YOU THOUGHT.";
  }

  return "YOU FOUND THE MOMENT.";
}

function ResultsContent({ challenge }: { challenge: ChallengeView }) {
  const sourceName = resultSourceName(challenge);
  const isPublicPlaylist = challenge.source.kind === "public-playlist";
  const retryUrl = createChallengeIntroUrl(challenge.source);
  const score = challenge.complete ? challenge.score : undefined;
  const metrics = deriveChallengeResultMetrics({
    ...challenge,
    score,
  });
  const tracks = buildChallengeResultTracks(challenge);

  return (
    <>
      <div className="ftl-results-graffiti" aria-hidden="true">
        <HandwrittenAnnotation
          text="Same song, closer"
          tone="purple"
          rotateDeg={-5}
          underline="single"
          className="ftl-results-graffiti__left"
        />
        <HandwrittenAnnotation
          text="On a roll"
          tone="mint"
          rotateDeg={4}
          underline="none"
          className="ftl-results-graffiti__right"
        />
      </div>

      <p className="ftl-results-kicker">
        <span className="ftl-results-kicker__line" aria-hidden="true" />
        Challenge complete
      </p>

      <div className="ftl-results-composition">
        <section
          className="ftl-results-performance"
          aria-labelledby="challenge-results-heading"
        >
          <p className="ftl-results-label">FINAL RESULTS</p>
          <h1 id="challenge-results-heading" className="ftl-results-headline">
            {resultHeadline(metrics)}
          </h1>
          <h2 className="ftl-results-source">{sourceName}</h2>

          <div className="ftl-results-score-block" aria-labelledby="challenge-score-heading">
            <p className="ftl-results-score-label">Final score</p>
            {metrics.finalScore !== null ? (
              <p className="ftl-results-score" id="challenge-score-heading">
                <span>{metrics.finalScore}</span>
                <span className="ftl-results-score__scale">/ 100</span>
              </p>
            ) : (
              <p className="ftl-results-score ftl-results-score--pending" id="challenge-score-heading">
                —
              </p>
            )}
            <p className="ftl-results-score-detail">
              {metrics.finalScore === null
                ? "No score yet — finish the challenge to see your score."
                : "Across the songs you played."}
            </p>
          </div>

          <dl className="ftl-results-metrics" aria-label="Challenge summary">
            <div>
              <dt>Solved</dt>
              <dd>{metrics.solvedCount} / {challenge.questionCount}</dd>
            </div>
            <div>
              <dt>Perfect</dt>
              <dd>{metrics.perfectCount}</dd>
            </div>
            <div>
              <dt>Best streak</dt>
              <dd>{metrics.bestStreak}</dd>
            </div>
          </dl>
        </section>

        <section
          className="ftl-results-track-list"
          aria-labelledby="challenge-track-list-heading"
        >
          <div className="ftl-results-track-list__header">
            <p className="ftl-results-label" id="challenge-track-list-heading">
              TRACK LIST
            </p>
            <span>
              <span className="ftl-results-track-list__scores-label">Song scores</span>
              <span aria-hidden="true"> · </span>
              {challenge.questionCount} songs
            </span>
          </div>
          <ol>
            {tracks.map((track) => (
              <li className="ftl-results-track" key={track.questionId}>
                <span className="ftl-results-track__index">
                  {String(track.index + 1).padStart(2, "0")}
                </span>
                <span className="ftl-results-track__identity">
                  <span className="ftl-results-track__title">
                    {track.title ?? "In-progress song"}
                  </span>
                  <span className="ftl-results-track__artist">
                    {track.artist ?? "Details appear after the round."}
                  </span>
                </span>
                <span className="ftl-results-track__status">
                  <span>{track.solved ? "SOLVED" : track.status === "failed" ? "FAILED" : "IN PROGRESS"}</span>
                  {track.perfect && (
                    <span className="ftl-results-track__perfect" aria-label="Perfect, solved on Expert">
                      PERFECT
                    </span>
                  )}
                </span>
                <span className="ftl-results-track__score" aria-label={track.score === null ? "Score pending" : `Score ${track.score} out of 100`}>
                  {track.score === null ? "—" : `${track.score} / 100`}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <div className="ftl-results-actions" aria-label="Result actions">
        <Link className="ftl-results-action ftl-results-action--primary" href={retryUrl}>
          Play Again
          <span aria-hidden="true">→</span>
        </Link>
        <Link
          className="ftl-results-action ftl-results-action--secondary"
          href={isPublicPlaylist ? "/" : "/albums"}
        >
          Use Another Playlist
        </Link>
        {!challenge.complete && (
          <Link
            className="ftl-results-action ftl-results-action--tertiary"
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
    <StageAtmosphere
      intensity="solved"
      className="ftl-results-stage-shell"
    >
      <div className="ftl-results-page">
        <header className="ftl-results-header" aria-label="Results navigation">
          <BrandWordmark
            href="/"
            ariaLabel="FillTheLyrics home"
            subtitle="Final results"
          />
          <Link
            className="ftl-results-header__source"
            href={challenge?.source.kind === "public-playlist" ? "/" : "/albums"}
          >
            {challenge?.source.kind === "public-playlist" ? "Import" : "Library"}
          </Link>
        </header>
        <main
          className="ftl-results-main"
          aria-labelledby="challenge-results-heading"
        >
          {challenge ? (
            <ResultsContent challenge={challenge} />
          ) : errorCopy ? (
            <section role="alert" className="ftl-results-error">
              <h1>{errorCopy.heading}</h1>
              <p>{errorCopy.detail}</p>
              <div className="ftl-results-error__actions">
                <button
                  className="ftl-results-action ftl-results-action--primary"
                  type="button"
                  onClick={() => setReloadKey((key) => key + 1)}
                >
                  Try again
                </button>
                {errorCopy.reconnect && (
                  <a
                    className="ftl-results-action ftl-results-action--secondary"
                    href="/api/auth/spotify"
                  >
                    Reconnect Spotify
                  </a>
                )}
                <Link
                  className="ftl-results-action ftl-results-action--secondary"
                  href="/albums"
                >
                  Back to library
                </Link>
              </div>
            </section>
          ) : (
            <p role="status" aria-live="polite" className="ftl-results-loading">
              Loading results…
            </p>
          )}
        </main>
      </div>
    </StageAtmosphere>
  );
}
