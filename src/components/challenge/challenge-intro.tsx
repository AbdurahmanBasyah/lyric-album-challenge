"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import {
  createChallenge,
  createPublicPlaylistChallenge,
  getChallengeErrorCopy,
  readRecoveryPointer,
  saveRecoveryPointer,
  type ChallengeSourceContext,
} from "./challenge-api";

const INTRO_STATUS_ID = "challenge-intro-status";

export function ChallengeIntro({
  source,
}: {
  source: ChallengeSourceContext | null;
}) {
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();
  const reducedMotion = prefersReducedMotion ?? false;
  const controllerRef = useRef<AbortController | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [recoveryId, setRecoveryId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    queueMicrotask(() => {
      if (!active) {
        return;
      }

      try {
        setRecoveryId(
          readRecoveryPointer(window.localStorage)?.challengeId ?? null,
        );
      } catch {
        setRecoveryId(null);
      }
    });

    return () => {
      active = false;
      controllerRef.current?.abort();
    };
  }, []);

  const startChallenge = async () => {
    if (source === null || starting) {
      return;
    }

    setStarting(true);
    setError(null);
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      // Public URLs are resolved only after this explicit confirmation. The
      // setup screen never invents a name, artwork, provider metadata, or progress.
      const challenge = source.kind === "public-playlist"
        ? await createPublicPlaylistChallenge(source.canonicalUrl, {
          signal: controller.signal,
        })
        : await createChallenge(source, {
          signal: controller.signal,
        });

      try {
        saveRecoveryPointer(window.localStorage, {
          challengeId: challenge.id,
          currentQuestionIndex: 0,
          updatedAt: Date.now(),
        });
      } catch {
        // Browser storage is optional; the URL and server state remain usable.
      }

      router.replace(`/play/${encodeURIComponent(challenge.id)}`);
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") {
        return;
      }

      setError(requestError);
      setStarting(false);
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  };

  const errorCopy = error === null ? null : getChallengeErrorCopy(error);
  const sourceLabel = source?.displayName ??
    (source?.kind === "album"
      ? "Selected album"
      : source?.kind === "public-playlist"
        ? "Imported playlist"
        : "Selected playlist");
  const isPublicPlaylist = source?.kind === "public-playlist";
  const backHref = isPublicPlaylist ? "/" : "/albums";
  const primaryActionLabel = starting
    ? "Building your challenge…"
    : errorCopy
      ? "Try again"
      : "Start challenge";

  return (
    <div className="site-shell intro-shell">
      <div className="ambient-shader" aria-hidden="true" />

      <header className="site-header">
        <Link className="brand-lockup" href={backHref}>
          <span className="brand-mark" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path
                d="M5 15.5V8.5M9.5 18V6M14 15.5V8.5M18.5 13V11"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span className="brand-name">
            <span>FillTheLyrics</span>
            <span>Challenge setup</span>
          </span>
        </Link>
        <Link className="header-pill no-underline" href={backHref}>
          {isPublicPlaylist ? "Change playlist" : "Change source"}
        </Link>
      </header>

      <main className="intro-main">
        <motion.section
          className="intro-grid"
          initial={{ opacity: 1, y: reducedMotion ? 0 : 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.42, ease: "easeOut" }}
          aria-labelledby="challenge-intro-heading"
        >
          <div className="intro-copy">
            <p className="eyebrow">
              <span className="eyebrow-line" aria-hidden="true" />
              Prepare your fragment
            </p>
            <h1 id="challenge-intro-heading" className="intro-heading">
              {source === null ? "Choose a valid source" : sourceLabel}
            </h1>
            <p className="intro-description">
              {source === null
                ? "The source link is incomplete or invalid. Return and choose it again."
                : "We will choose lyric fragments without revealing the tracks first. Every solved word stays locked."}
            </p>
            <div className="intro-note" role="note">
              <span className="intro-note-mark" aria-hidden="true">+</span>
              <span>
                {isPublicPlaylist
                  ? "Your playlist stays the source; only eligible lyric fragments become questions."
                  : "Your source stays bounded; the challenge picks up to five lyric fragments."}
              </span>
            </div>
          </div>

          <aside
            className="intro-card glass-panel glass-panel-strong"
            aria-labelledby="intro-card-heading"
          >
            <p className="intro-card-kicker">Ready when you are</p>
            <h2 id="intro-card-heading" className="intro-card-heading">
              A focused listening round
            </h2>

            <dl className="intro-stats">
              <div className="intro-stat">
                <dt>Questions</dt>
                <dd>Up to 5 songs</dd>
              </div>
              <div className="intro-stat">
                <dt>Each song</dt>
                <dd>4 attempts</dd>
              </div>
              <div className="intro-stat">
                <dt>First level</dt>
                <dd className="intro-stat-accent">Expert</dd>
              </div>
            </dl>

            <div
              id={INTRO_STATUS_ID}
              className="intro-status"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {starting && (
                <p className="intro-status-loading">
                  {isPublicPlaylist
                    ? "Importing the playlist and finding lyric fragments…"
                    : "Building your challenge…"}
                </p>
              )}
              {errorCopy && (
                <div className="intro-error" role="alert">
                  <p className="intro-error-heading">{errorCopy.heading}</p>
                  <p className="intro-error-detail">{errorCopy.detail}</p>
                </div>
              )}
            </div>

            <div className="intro-actions">
              {source !== null && (
                <button
                  className="intro-primary-action"
                  type="button"
                  disabled={starting}
                  aria-busy={starting}
                  aria-describedby={INTRO_STATUS_ID}
                  onClick={() => void startChallenge()}
                >
                  {primaryActionLabel}
                </button>
              )}
              {errorCopy?.reconnect && (
                <a
                  className="intro-secondary-action"
                  href="/api/auth/spotify"
                >
                  Reconnect Spotify
                </a>
              )}
              {recoveryId && (
                <Link
                  className="intro-recovery-action"
                  href={`/play/${encodeURIComponent(recoveryId)}`}
                >
                  Resume active challenge
                </Link>
              )}
              {source === null && (
                <Link className="intro-secondary-action" href={backHref}>
                  {isPublicPlaylist ? "Import another playlist" : "Back to library"}
                </Link>
              )}
            </div>
          </aside>
        </motion.section>
      </main>
    </div>
  );
}
