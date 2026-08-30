"use client";

import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { YOUTUBE_VIDEO_ID_PATTERN } from "./challenge-api";
import {
  createYouTubeIframePlayer,
  type YouTubeIframePlayerHandle,
} from "./youtube-iframe-player";
import type {
  ChallengePlaybackUnavailableReason,
  ChallengePlaybackView,
  ChallengeRevealView,
} from "../../types/challenge";

export type PlaybackRequest = (
  signal?: AbortSignal,
) => Promise<ChallengePlaybackView>;

export type PlaybackStatus =
  | "idle"
  | "loading"
  | "available"
  | "manual"
  | "unavailable"
  | "error";

export type PlaybackStatusCopy = Readonly<{
  label: string;
  detail: string;
}>;

export const PLAYBACK_UNAVAILABLE_REASONS: readonly ChallengePlaybackUnavailableReason[] = [
  "configuration",
  "no-candidate",
  "low-confidence",
  "rate-limited",
  "timeout",
  "unavailable",
] as const;

const STATUS_COPY: Readonly<Record<PlaybackStatus, PlaybackStatusCopy>> = {
  idle: {
    label: "Optional listening",
    detail: "A visible YouTube player will load automatically after the reveal.",
  },
  loading: {
    label: "Loading YouTube playback",
    detail: "The player will appear here when it is ready.",
  },
  available: {
    label: "YouTube player ready",
    detail: "Use the player controls when you want to listen.",
  },
  manual: {
    label: "Manual YouTube playback",
    detail: "Autoplay was unavailable. Use the visible player controls to listen.",
  },
  unavailable: {
    label: "YouTube playback unavailable",
    detail: "You can continue the challenge without listening.",
  },
  error: {
    label: "YouTube playback could not load",
    detail: "Try again, or continue the challenge without listening.",
  },
};

const UNAVAILABLE_COPY: Readonly<
  Record<ChallengePlaybackUnavailableReason, PlaybackStatusCopy>
> = {
  configuration: {
    label: "YouTube playback is not configured",
    detail: "You can continue the challenge without listening.",
  },
  "no-candidate": {
    label: "No matching YouTube video is available",
    detail: "You can continue the challenge without listening.",
  },
  "low-confidence": {
    label: "A matching YouTube video could not be confirmed",
    detail: "You can continue the challenge without listening.",
  },
  "rate-limited": {
    label: "YouTube lookup is temporarily unavailable",
    detail: "Try again later, or continue the challenge without listening.",
  },
  timeout: {
    label: "YouTube lookup took too long",
    detail: "Try again, or continue the challenge without listening.",
  },
  unavailable: {
    label: "No YouTube playback is available right now",
    detail: "You can continue the challenge without listening.",
  },
};

const DEFAULT_PLAYBACK_REQUEST: PlaybackRequest = async () => ({
  provider: "youtube",
  status: "unavailable",
  reason: "unavailable",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidStartAtMs(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function isUnavailableReason(
  value: unknown,
): value is ChallengePlaybackUnavailableReason {
  return (
    typeof value === "string" &&
    PLAYBACK_UNAVAILABLE_REASONS.includes(
      value as ChallengePlaybackUnavailableReason,
    )
  );
}

/**
 * Build the one fixed YouTube embed shape accepted by the player. The ID is
 * checked again here so an injected or future callback cannot turn this into
 * an arbitrary provider URL.
 */
export function createYouTubeEmbedUrl(value: unknown): string | null {
  if (typeof value !== "string" || !YOUTUBE_VIDEO_ID_PATTERN.test(value)) {
    return null;
  }

  return `https://www.youtube.com/embed/${value}?controls=1&rel=0`;
}

function getValidatedPlaybackState(
  value: unknown,
  revealKey: string,
):
  | Readonly<{
      status: "available";
      revealKey: string;
      embedUrl: string;
      videoId: string;
      startAtMs: number;
    }>
  | Readonly<{
      status: "unavailable";
      revealKey: string;
      reason: ChallengePlaybackUnavailableReason;
    }>
  | Readonly<{ status: "error"; revealKey: string }> {
  if (!isRecord(value) || value.provider !== "youtube") {
    return { status: "error", revealKey };
  }

  if (value.status === "available") {
    const videoId = value.videoId;
    const embedUrl = createYouTubeEmbedUrl(videoId);
    return typeof videoId !== "string" || embedUrl === null || !isValidStartAtMs(value.startAtMs)
      ? { status: "error", revealKey }
      : { status: "available", revealKey, embedUrl, videoId, startAtMs: value.startAtMs };
  }

  return value.status === "unavailable" && isUnavailableReason(value.reason)
    ? { status: "unavailable", revealKey, reason: value.reason }
    : { status: "error", revealKey };
}

/** Reduce an application playback value to the UI's stable state vocabulary. */
export function getPlaybackStatus(value: unknown): PlaybackStatus {
  if (!isRecord(value) || value.provider !== "youtube") {
    return "error";
  }

  if (value.status === "available") {
    return createYouTubeEmbedUrl(value.videoId) === null || !isValidStartAtMs(value.startAtMs)
      ? "error"
      : "available";
  }

  return value.status === "unavailable" && isUnavailableReason(value.reason)
    ? "unavailable"
    : "error";
}

export function getPlaybackStatusCopy(
  status: PlaybackStatus,
): PlaybackStatusCopy {
  return STATUS_COPY[status];
}

export function getPlaybackUnavailableCopy(
  reason: ChallengePlaybackUnavailableReason,
): PlaybackStatusCopy {
  return UNAVAILABLE_COPY[reason] ?? STATUS_COPY.unavailable;
}

type PlaybackUiState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading"; revealKey: string }>
  | Readonly<{
      status: "available";
      revealKey: string;
      embedUrl: string;
      videoId: string;
      startAtMs: number;
    }>
  | Readonly<{
      status: "manual";
      revealKey: string;
      embedUrl: string;
      videoId: string;
      startAtMs: number;
    }>
  | Readonly<{
      status: "unavailable";
      revealKey: string;
      reason: ChallengePlaybackUnavailableReason;
    }>
  | Readonly<{ status: "error"; revealKey: string }>;

type YouTubeIframeSurfaceProps = Readonly<{
  videoId: string;
  startAtMs: number;
  fallbackUrl: string;
  title: string;
  onAutoplayBlocked: () => void;
  onError: () => void;
}>;

/**
 * Mounts the official IFrame API only after the parent has received the
 * server-owned available DTO. A fixed normal embed remains visible when the
 * API script or player cannot load; it never becomes a hidden/background
 * player and keeps YouTube controls available.
 */
function YouTubeIframeSurface({
  videoId,
  startAtMs,
  fallbackUrl,
  title,
  onAutoplayBlocked,
  onError,
}: YouTubeIframeSurfaceProps) {
  const [showFallback, setShowFallback] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<YouTubeIframePlayerHandle | null>(null);
  const mountedRef = useRef(false);
  const failedRef = useRef(false);
  const callbacksRef = useRef({ onAutoplayBlocked, onError });

  useEffect(() => {
    callbacksRef.current = { onAutoplayBlocked, onError };
  }, [onAutoplayBlocked, onError]);

  useEffect(() => {
    mountedRef.current = true;
    failedRef.current = false;

    const controller = new AbortController();
    let disposed = false;
    const container = containerRef.current;

    if (container === null) {
      return () => {
        mountedRef.current = false;
        controller.abort();
      };
    }

    void createYouTubeIframePlayer({
      container,
      videoId,
      startAtMs,
      title,
      signal: controller.signal,
      onAutoplayBlocked: () => {
        if (!disposed && mountedRef.current) {
          callbacksRef.current.onAutoplayBlocked();
        }
      },
      onError: () => {
        if (disposed || !mountedRef.current) {
          return;
        }

        handleRef.current?.destroy();
        handleRef.current = null;
        failedRef.current = true;
        setShowFallback(true);
        callbacksRef.current.onError();
      },
    })
      .then((handle) => {
        if (disposed || !mountedRef.current || controller.signal.aborted) {
          handle.destroy();
          return;
        }

        if (failedRef.current) {
          handle.destroy();
          return;
        }

        handleRef.current = handle;
      })
      .catch(() => {
        if (disposed || !mountedRef.current || controller.signal.aborted) {
          return;
        }

        setShowFallback(true);
        callbacksRef.current.onError();
      });

    return () => {
      disposed = true;
      mountedRef.current = false;
      controller.abort();
      handleRef.current?.destroy();
      handleRef.current = null;
    };
  }, [startAtMs, title, videoId]);

  if (showFallback) {
    return (
      <iframe
        className="block h-full min-h-[200px] min-w-[200px] w-full border-0"
        src={fallbackUrl}
        title={title}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        allow="encrypted-media; picture-in-picture; web-share"
        allowFullScreen
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className="block h-full min-h-[200px] min-w-[200px] w-full [&>iframe]:block [&>iframe]:h-full [&>iframe]:min-h-[200px] [&>iframe]:min-w-[200px] [&>iframe]:w-full"
      aria-label={title}
    />
  );
}

export type ChallengePlaybackProps = Readonly<{
  /** Only completed/failed reveal data is accepted; active questions have no reveal. */
  reveal: ChallengeRevealView;
  /** The caller supplies the same-origin request for the terminal reveal. */
  requestPlayback?: PlaybackRequest;
}>;

/**
 * Keep one request/player lifecycle per terminal reveal, even when the
 * caller recreates the reveal object or callback during an unrelated render.
 */
function getRevealKey(reveal: ChallengeRevealView): string {
  return JSON.stringify({
    lines: reveal.lines,
    trackName: reveal.trackName,
    artistNames: reveal.artistNames,
    startTimestampMs: reveal.startTimestampMs,
  });
}

function getLiveCopy(state: PlaybackUiState): PlaybackStatusCopy {
  if (state.status === "unavailable") {
    return getPlaybackUnavailableCopy(state.reason);
  }

  return getPlaybackStatusCopy(state.status);
}

export function ChallengePlayback({
  reveal,
  requestPlayback = DEFAULT_PLAYBACK_REQUEST,
}: ChallengePlaybackProps) {
  const prefersReducedMotion = useReducedMotion();
  const reducedMotion = prefersReducedMotion ?? false;
  const revealKey = getRevealKey(reveal);
  const [state, setState] = useState<PlaybackUiState>({ status: "idle" });
  const [isPending, setIsPending] = useState(false);
  const mountedRef = useRef(false);
  const pendingRef = useRef(false);
  const requestControllerRef = useRef<AbortController | null>(null);
  const requestPlaybackRef = useRef<PlaybackRequest>(requestPlayback);
  const currentRevealKeyRef = useRef(revealKey);
  const autoStartedRevealKeyRef = useRef<string | null>(null);
  const activeRequestRevealKeyRef = useRef<string | null>(null);
  const cleanupTokenRef = useRef(0);

  useEffect(() => {
    requestPlaybackRef.current = requestPlayback;
    currentRevealKeyRef.current = revealKey;
  }, [requestPlayback, revealKey]);

  const abortPlaybackRequest = useCallback(() => {
    const controller = requestControllerRef.current;
    requestControllerRef.current = null;
    pendingRef.current = false;
    activeRequestRevealKeyRef.current = null;
    controller?.abort();

    if (mountedRef.current) {
      setIsPending(false);
    }
  }, []);

  const handlePlaybackRequest = useCallback(() => {
    if (!mountedRef.current || pendingRef.current) {
      return;
    }

    const requestKey = currentRevealKeyRef.current;
    const controller = new AbortController();
    requestControllerRef.current = controller;
    activeRequestRevealKeyRef.current = requestKey;
    pendingRef.current = true;
    setIsPending(true);
    setState({ status: "loading", revealKey: requestKey });

    void requestPlaybackRef.current(controller.signal)
      .then((result) => {
        if (
          !mountedRef.current ||
          controller.signal.aborted ||
          requestControllerRef.current !== controller ||
          currentRevealKeyRef.current !== requestKey
        ) {
          return;
        }

        setState(getValidatedPlaybackState(result, requestKey));
      })
      .catch(() => {
        if (
          !mountedRef.current ||
          controller.signal.aborted ||
          requestControllerRef.current !== controller ||
          currentRevealKeyRef.current !== requestKey
        ) {
          return;
        }

        setState({ status: "error", revealKey: requestKey });
      })
      .finally(() => {
        if (requestControllerRef.current !== controller) {
          return;
        }

        requestControllerRef.current = null;
        activeRequestRevealKeyRef.current = null;
        pendingRef.current = false;

        if (mountedRef.current) {
          setIsPending(false);
        }
      });
  }, []);

  useEffect(() => {
    // React Strict Mode performs an effect setup/cleanup/setup probe. The
    // short-lived cleanup token lets that probe preserve one in-flight
    // request, while a real unmount still aborts it on the next microtask.
    mountedRef.current = true;
    cleanupTokenRef.current = 0;

    if (
      activeRequestRevealKeyRef.current !== null &&
      activeRequestRevealKeyRef.current !== revealKey
    ) {
      abortPlaybackRequest();
    }

    if (autoStartedRevealKeyRef.current !== revealKey) {
      autoStartedRevealKeyRef.current = revealKey;
      handlePlaybackRequest();
    }

    return () => {
      mountedRef.current = false;
      const cleanupToken = cleanupTokenRef.current + 1;
      cleanupTokenRef.current = cleanupToken;

      void Promise.resolve().then(() => {
        if (
          cleanupTokenRef.current !== cleanupToken ||
          mountedRef.current
        ) {
          return;
        }

        cleanupTokenRef.current = 0;
        abortPlaybackRequest();
      });
    };
  }, [abortPlaybackRequest, handlePlaybackRequest, revealKey]);

  const stateForReveal =
    state.status !== "idle" && state.revealKey !== revealKey
      ? ({ status: "idle" } satisfies PlaybackUiState)
      : state;
  const playerState =
    stateForReveal.status === "available" ||
    stateForReveal.status === "manual"
      ? stateForReveal
      : null;
  const liveCopy = getLiveCopy(stateForReveal);
  const status = stateForReveal.status;

  return (
    <motion.section
      className="mt-6 rounded-[1.25rem] border border-[var(--border)] bg-[rgba(13,25,29,0.62)] p-4 sm:p-5"
      initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.22, ease: "easeOut" }}
      aria-labelledby="challenge-playback-heading"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
            Optional listening
          </p>
          <h3
            id="challenge-playback-heading"
            className="mt-2 text-base font-semibold text-[var(--foreground)]"
          >
            Hear the revealed fragment on YouTube
          </h3>
          <p className="mt-1 text-sm leading-6 text-[var(--muted-strong)]">
            {reveal.trackName} · The challenge is complete without listening.
          </p>
        </div>

        <button
          className="inline-flex min-h-11 flex-none items-center justify-center rounded-full border border-[var(--border-strong)] px-5 text-sm font-semibold text-[var(--foreground)] transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-65"
          type="button"
          disabled={isPending}
          aria-busy={isPending}
          aria-label={`${status === "available" || status === "manual" ? "Reload" : "Retry"} optional YouTube playback for ${reveal.trackName}`}
          onClick={handlePlaybackRequest}
        >
          {isPending
            ? "Loading YouTube player…"
            : status === "available" || status === "manual"
              ? "Reload YouTube player"
              : "Try YouTube playback again"}
        </button>
      </div>

      {playerState !== null && (
        <motion.div
          className="mt-5 w-full min-w-[200px] max-w-3xl overflow-x-auto rounded-xl border border-[var(--border-strong)] bg-black p-1"
          initial={{ opacity: 0, y: reducedMotion ? 0 : 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.18, ease: "easeOut" }}
        >
          <div className="aspect-video min-h-[200px] min-w-[200px] w-full">
            <YouTubeIframeSurface
              key={`${playerState.revealKey}-${playerState.videoId}-${playerState.startAtMs}`}
              videoId={playerState.videoId}
              startAtMs={playerState.startAtMs}
              fallbackUrl={playerState.embedUrl}
              title={`YouTube player for ${reveal.trackName}`}
              onAutoplayBlocked={() => setState((current) =>
                current.status === "available" && current.revealKey === revealKey
                  ? { ...current, status: "manual" }
                  : current,
              )}
              onError={() => setState((current) =>
                current.status === "available" && current.revealKey === revealKey
                  ? { ...current, status: "manual" }
                  : current,
              )}
            />
          </div>
        </motion.div>
      )}

      <motion.p
        key={`${status}-${status === "unavailable" ? stateForReveal.reason : ""}`}
        className="mt-4 flex items-start gap-2 border-t border-[var(--border)] pt-3 text-sm leading-6 text-[var(--muted-strong)]"
        initial={{ opacity: 0, y: reducedMotion ? 0 : 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.16, ease: "easeOut" }}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-playback-status={status}
      >
        <span
          className="mt-1 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full border border-[var(--border-strong)] text-xs font-bold text-[var(--accent)]"
          aria-hidden="true"
        >
          {isPending ? "…" : status === "available" ? "✓" : "i"}
        </span>
        <span>
          {isPending
            ? "Loading the optional YouTube player…"
            : `${liveCopy.label}. ${liveCopy.detail}`}
        </span>
      </motion.p>
    </motion.section>
  );
}
