"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { BrandWordmark } from "@/components/fillthelyrics/visual/brand-wordmark";
import { HandwrittenAnnotation } from "@/components/fillthelyrics/visual/handwritten-annotation";
import { StageAtmosphere } from "@/components/fillthelyrics/visual/stage-atmosphere";
import type { ChallengeView } from "@/types/challenge";

import {
  createChallenge,
  createPublicPlaylistChallenge,
  getChallengeErrorCopy,
  readRecoveryPointer,
  saveRecoveryPointer,
  type ChallengeSourceContext,
} from "./challenge-api";

const INTRO_STATUS_ID = "challenge-intro-status";

export type PublicPreStartState =
  | Readonly<{ phase: "loading" }>
  | Readonly<{ phase: "ready"; challenge: ChallengeView }>
  | Readonly<{ phase: "error"; error: unknown }>;

type LegacyIntroPhase = "idle" | "loading" | "error";

type PublicImportEntry = Readonly<{
  key: string;
  promise: Promise<ChallengeView>;
}>;

const previewLines = [
  [
    { text: "The", state: "static" },
    { text: "quiet", state: "hidden" },
    { text: "room", state: "static" },
    { text: "waits", state: "revealed" },
  ],
  [
    { text: "A", state: "static" },
    { text: "small", state: "hidden" },
    { text: "signal", state: "solved" },
    { text: "finds", state: "static" },
    { text: "us", state: "static" },
  ],
  [
    { text: "Keep", state: "static" },
    { text: "the", state: "static" },
    { text: "next", state: "revealed" },
    { text: "beat", state: "hidden" },
    { text: "close", state: "static" },
  ],
  [
    { text: "Let", state: "static" },
    { text: "one", state: "hidden" },
    { text: "word", state: "solved" },
    { text: "lead", state: "static" },
    { text: "the", state: "static" },
    { text: "way", state: "hidden" },
  ],
] as const;

function AbstractPlaylistMark() {
  return (
    <div className="ftl-prestart-identity-mark" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

function PreviewFragment() {
  return (
    <div className="ftl-prestart-preview-fragment">
      {previewLines.map((line, lineIndex) => (
        <p key={`setup-line-${lineIndex}`}>
          {line.map((token, tokenIndex) => (
            <span
              key={`${lineIndex}-${tokenIndex}-${token.text}`}
              className={`ftl-setup-token ftl-setup-token--${token.state}`}
              aria-label={token.state === "hidden" ? "missing sample word" : undefined}
            >
              {token.state === "hidden"
                ? "_".repeat(Math.max(3, token.text.length))
                : token.text}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}

function ProgressionExplanation() {
  return (
    <div className="ftl-prestart-progression" aria-labelledby="progression-heading">
      <p id="progression-heading" className="ftl-prestart-panel-label">
        Progressive reveal
      </p>
      <ol>
        <li>
          <strong>Expert</strong>
          <span>Many words hidden</span>
        </li>
        <li>
          <strong>Hard</strong>
          <span>Some complete words revealed</span>
        </li>
        <li>
          <strong>Medium</strong>
          <span>More complete words revealed</span>
        </li>
        <li>
          <strong>Easy</strong>
          <span>Most context visible + title hint</span>
        </li>
      </ol>
    </div>
  );
}

function saveChallengeRecovery(challengeId: string) {
  try {
    saveRecoveryPointer(window.localStorage, {
      challengeId,
      currentQuestionIndex: 0,
      updatedAt: Date.now(),
    });
  } catch {
    // Browser storage is optional; the URL and server state remain usable.
  }
}

export function ChallengeIntro({
  source,
}: {
  source: ChallengeSourceContext | null;
}) {
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();
  const reducedMotion = prefersReducedMotion ?? false;
  const mountedRef = useRef(false);
  const publicAttemptRef = useRef(0);
  const publicImportRef = useRef<PublicImportEntry | null>(null);
  const startingRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const [starting, setStarting] = useState(false);
  const [legacyPhase, setLegacyPhase] = useState<LegacyIntroPhase>("idle");
  const [legacyError, setLegacyError] = useState<unknown>(null);
  const [recoveryId, setRecoveryId] = useState<string | null>(null);
  const [publicState, setPublicState] = useState<PublicPreStartState>({
    phase: "loading",
  });

  const publicSourceUrl =
    source?.kind === "public-playlist" ? source.canonicalUrl : null;
  const isPublicPlaylist = source?.kind === "public-playlist";

  useEffect(() => {
    mountedRef.current = true;

    queueMicrotask(() => {
      if (!mountedRef.current) {
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
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  const beginPublicImport = useCallback(
    (canonicalUrl: string, forceFresh = false) => {
      const key = canonicalUrl;

      if (forceFresh || publicImportRef.current?.key !== key) {
        publicImportRef.current = null;
      }

      const existing = publicImportRef.current;
      const promise =
        existing?.promise ?? createPublicPlaylistChallenge(canonicalUrl);
      publicImportRef.current = existing ?? { key, promise };

      const attempt = publicAttemptRef.current + 1;
      publicAttemptRef.current = attempt;
      setPublicState({ phase: "loading" });

      void promise.then(
        (challenge) => {
          if (!mountedRef.current || publicAttemptRef.current !== attempt) {
            return;
          }

          setPublicState({ phase: "ready", challenge });
        },
        (error: unknown) => {
          if (!mountedRef.current || publicAttemptRef.current !== attempt) {
            return;
          }

          setPublicState({ phase: "error", error });
        },
      );
    },
    [],
  );

  useEffect(() => {
    if (publicSourceUrl === null) {
      return;
    }

    // The promise/ref pair makes this effect idempotent under Strict Mode and
    // keeps the provider call out of the landing component.
    queueMicrotask(() => {
      if (mountedRef.current) {
        beginPublicImport(publicSourceUrl);
      }
    });
  }, [beginPublicImport, publicSourceUrl]);

  const startLegacyChallenge = async () => {
    if (
      source === null ||
      source.kind === "public-playlist" ||
      startingRef.current
    ) {
      return;
    }

    startingRef.current = true;
    setStarting(true);
    setLegacyPhase("loading");
    setLegacyError(null);
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const challenge = await createChallenge(source, {
        signal: controller.signal,
      });

      if (!mountedRef.current) {
        return;
      }

      saveChallengeRecovery(challenge.id);
      router.replace(`/play/${encodeURIComponent(challenge.id)}`);
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") {
        return;
      }

      if (mountedRef.current) {
        setLegacyError(requestError);
        setLegacyPhase("error");
        setStarting(false);
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
      startingRef.current = false;
    }
  };

  const startPublicChallenge = () => {
    if (
      !isPublicPlaylist ||
      publicState.phase !== "ready" ||
      startingRef.current
    ) {
      return;
    }

    startingRef.current = true;
    setStarting(true);
    saveChallengeRecovery(publicState.challenge.id);
    router.replace(`/play/${encodeURIComponent(publicState.challenge.id)}`);
  };

  const retryPublicImport = () => {
    if (publicSourceUrl === null || publicState.phase !== "error") {
      return;
    }

    beginPublicImport(publicSourceUrl, true);
  };

  const publicErrorCopy =
    publicState.phase === "error"
      ? getChallengeErrorCopy(publicState.error)
      : null;
  const legacyErrorCopy =
    legacyError === null ? null : getChallengeErrorCopy(legacyError);
  const backHref = isPublicPlaylist ? "/" : "/albums";
  const atmosphereState = isPublicPlaylist
    ? publicState.phase
    : legacyPhase === "error"
      ? "error"
      : legacyPhase === "loading"
        ? "loading"
        : "ready";
  const publicChallenge =
    publicState.phase === "ready" ? publicState.challenge : null;
  const publicDisplayName =
    publicChallenge?.source.kind === "public-playlist" &&
    publicChallenge.source.displayName
      ? publicChallenge.source.displayName
      : "Your public playlist";
  const legacyDisplayName =
    source?.kind === "album"
      ? source.displayName
      : source?.displayName ?? "Selected playlist";
  const heading = isPublicPlaylist
    ? publicState.phase === "ready"
      ? publicDisplayName
      : publicState.phase === "error"
        ? "Challenge setup"
        : "Preparing your challenge"
    : source === null
      ? "Choose a valid source"
      : legacyDisplayName;
  const description = isPublicPlaylist
    ? publicState.phase === "ready"
      ? "Your playlist is ready. Rebuild four-line fragments one word at a time."
      : publicState.phase === "error"
        ? "We couldn't prepare this playlist yet. You can retry or choose another one."
        : "We’re finding playable, synced lyric fragments from this playlist."
    : source === null
      ? "The source link is incomplete or invalid. Return and choose it again."
      : "We’ll choose lyric fragments without revealing the tracks first. Every solved word stays locked.";

  return (
    <StageAtmosphere
      intensity="setup"
      className={`ftl-prestart-stage ftl-prestart-stage--${atmosphereState}`}
    >
      <div className="ftl-prestart-page">
        <header className="ftl-prestart-header">
          <BrandWordmark
            href={backHref}
            ariaLabel={
              isPublicPlaylist ? "FillTheLyrics home" : "Back to source library"
            }
            subtitle={isPublicPlaylist ? "Public playlist" : "Challenge setup"}
          />
          <Link className="ftl-prestart-header-link" href={backHref}>
            {isPublicPlaylist ? "Choose another playlist" : "Change source"}
          </Link>
        </header>

        <main className="ftl-prestart-main">
          <motion.div
            className="ftl-prestart-grid"
            initial={{ opacity: 1, y: reducedMotion ? 0 : 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.42, ease: "easeOut" }}
          >
            <section
              className="ftl-prestart-identity"
              aria-labelledby="challenge-intro-heading"
            >
              <p className="ftl-prestart-kicker">
                <span className="ftl-eyebrow__line" aria-hidden="true" />
                {isPublicPlaylist ? "Public playlist" : "Prepare your fragment"}
              </p>
              <div className="ftl-prestart-source-row">
                <AbstractPlaylistMark />
                <span>
                  {isPublicPlaylist
                    ? publicState.phase === "ready"
                      ? "Imported playlist"
                      : "Playlist import"
                    : "Saved source"}
                </span>
              </div>
              <h1 id="challenge-intro-heading" className="ftl-prestart-heading">
                {heading}
              </h1>
              <p className="ftl-prestart-description">{description}</p>

              <div className="ftl-prestart-facts" aria-live="polite">
                {isPublicPlaylist ? (
                  publicState.phase === "ready" && publicChallenge ? (
                    <dl>
                      <div>
                        <dt>Playable songs</dt>
                        <dd>
                          {publicChallenge.questionCount} {publicChallenge.questionCount === 1 ? "song" : "songs"}
                        </dd>
                      </div>
                      <div>
                        <dt>Each song</dt>
                        <dd>4 attempts</dd>
                      </div>
                    </dl>
                  ) : publicState.phase === "loading" ? (
                    <dl>
                      <div>
                        <dt>Challenge</dt>
                        <dd>Preparing</dd>
                      </div>
                      <div>
                        <dt>Each song</dt>
                        <dd>4 attempts</dd>
                      </div>
                    </dl>
                  ) : null
                ) : source !== null ? (
                  <dl>
                    <div>
                      <dt>Challenge size</dt>
                      <dd>Up to 5 songs</dd>
                    </div>
                    <div>
                      <dt>Each song</dt>
                      <dd>4 attempts</dd>
                    </div>
                  </dl>
                ) : null}
              </div>

              <ProgressionExplanation />
            </section>

            <section
              className="ftl-prestart-panel"
              aria-labelledby="prestart-preview-heading"
              aria-busy={
                isPublicPlaylist && publicState.phase === "loading"
              }
            >
              <div className="ftl-prestart-panel-head">
                <div>
                  <p className="ftl-prestart-panel-label">Preview</p>
                  <h2 id="prestart-preview-heading">One fragment, four chances</h2>
                </div>
                <span className="ftl-prestart-panel-index">01 / 04</span>
              </div>
              <PreviewFragment />
              <p className="ftl-prestart-preview-caption">
                Complete words appear as the round opens up.
              </p>

              <div
                id={INTRO_STATUS_ID}
                className="ftl-prestart-status"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {isPublicPlaylist && publicState.phase === "loading" && (
                  <p className="ftl-prestart-status-message ftl-prestart-status-message--loading">
                    <span
                      className="ftl-prestart-loading-signal"
                      aria-hidden="true"
                    >
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                    </span>
                    Importing playlist and finding lyric fragments…
                  </p>
                )}
                {isPublicPlaylist && publicState.phase === "ready" && (
                  <p className="ftl-prestart-status-message ftl-prestart-status-message--ready">
                    Challenge ready when you are.
                  </p>
                )}
                {isPublicPlaylist && publicErrorCopy && (
                  <div className="ftl-prestart-error" role="alert">
                    <p>{publicErrorCopy.heading}</p>
                    <span>{publicErrorCopy.detail}</span>
                  </div>
                )}
                {!isPublicPlaylist && legacyPhase === "loading" && (
                  <p className="ftl-prestart-status-message">
                    Building your challenge…
                  </p>
                )}
                {!isPublicPlaylist && legacyErrorCopy && (
                  <div className="ftl-prestart-error" role="alert">
                    <p>{legacyErrorCopy.heading}</p>
                    <span>{legacyErrorCopy.detail}</span>
                  </div>
                )}
              </div>

              <div className="ftl-prestart-actions">
                {isPublicPlaylist ? (
                  publicState.phase === "ready" ? (
                    <button
                      className="ftl-prestart-primary"
                      type="button"
                      disabled={starting}
                      aria-busy={starting}
                      aria-describedby={INTRO_STATUS_ID}
                      onClick={startPublicChallenge}
                    >
                      {starting ? "Opening challenge…" : "Start Challenge"}
                      <span aria-hidden="true">→</span>
                    </button>
                  ) : publicState.phase === "error" ? (
                    <button
                      className="ftl-prestart-primary"
                      type="button"
                      disabled={starting}
                      aria-busy={starting}
                      aria-describedby={INTRO_STATUS_ID}
                      onClick={retryPublicImport}
                    >
                      Try again
                      <span aria-hidden="true">↻</span>
                    </button>
                  ) : null
                ) : source !== null ? (
                  <button
                    className="ftl-prestart-primary"
                    type="button"
                    disabled={starting}
                    aria-busy={starting}
                    aria-describedby={INTRO_STATUS_ID}
                    onClick={() => void startLegacyChallenge()}
                  >
                    {starting ? "Building your challenge…" : "Start Challenge"}
                    <span aria-hidden="true">→</span>
                  </button>
                ) : null}

                {isPublicPlaylist ? (
                  <Link className="ftl-prestart-secondary" href="/">
                    Choose another playlist
                  </Link>
                ) : source === null ? (
                  <Link className="ftl-prestart-secondary" href={backHref}>
                    Back to library
                  </Link>
                ) : (
                  <>
                    {legacyErrorCopy?.reconnect && (
                      <a className="ftl-prestart-secondary" href="/api/auth/spotify">
                        Reconnect Spotify
                      </a>
                    )}
                    {recoveryId && legacyPhase === "idle" && (
                      <Link
                        className="ftl-prestart-recovery"
                        href={`/play/${encodeURIComponent(recoveryId)}`}
                      >
                        Resume active challenge
                      </Link>
                    )}
                    <Link className="ftl-prestart-secondary" href={backHref}>
                      Choose another source
                    </Link>
                  </>
                )}
              </div>
            </section>
          </motion.div>
        </main>

        <HandwrittenAnnotation
          text="One word at a time"
          tone="mint"
          size="sm"
          rotateDeg={4}
          underline="single"
          className="ftl-prestart-note ftl-prestart-note--right"
        />
      </div>
    </StageAtmosphere>
  );
}
