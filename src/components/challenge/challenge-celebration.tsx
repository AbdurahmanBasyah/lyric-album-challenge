"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect } from "react";

import type { ChallengeGuessFinishedView } from "../../types/challenge";

/** The streak popup starts only after two consecutive solved songs. */
export const MIN_STREAK_FOR_CELEBRATION = 2 as const;
const MAX_STREAK_FOR_CELEBRATION = 5 as const;
const CELEBRATION_DURATION_MS = 1_600;

export type ChallengeCelebrationEvent =
  | Readonly<{
      kind: "perfect";
      questionId: string;
    }>
  | Readonly<{
      kind: "streak";
      questionId: string;
      streak: number;
    }>;

/**
 * Build the terminal celebration queue from server-owned facts.
 *
 * Perfect is intentionally inserted first when both achievements are present.
 * Failed results never produce an event, and streak values are used only for
 * the presentation-safe `LYRIC STREAK ×N` label.
 */
export function buildCelebrationQueue(
  result: Pick<
    ChallengeGuessFinishedView,
    "result" | "questionId" | "perfect" | "streak"
  >,
): readonly ChallengeCelebrationEvent[] {
  if (result.result !== "solved") {
    return Object.freeze([]);
  }

  const events: ChallengeCelebrationEvent[] = [];

  if (result.perfect === true) {
    events.push(
      Object.freeze({
        kind: "perfect" as const,
        questionId: result.questionId,
      }),
    );
  }

  if (
    Number.isSafeInteger(result.streak) &&
    result.streak >= MIN_STREAK_FOR_CELEBRATION
  ) {
    events.push(
      Object.freeze({
        kind: "streak" as const,
        questionId: result.questionId,
        streak: Math.min(result.streak, MAX_STREAK_FOR_CELEBRATION),
      }),
    );
  }

  return Object.freeze(events);
}

/** Explicit alias for callers that describe the output as events. */
export const buildCelebrationEvents = buildCelebrationQueue;

function eventLabel(event: ChallengeCelebrationEvent): string {
  return event.kind === "perfect"
    ? "PERFECT!"
    : `LYRIC STREAK ×${event.streak}`;
}

function eventClasses(event: ChallengeCelebrationEvent): Readonly<{
  shell: string;
  label: string;
  bloom: string;
}> {
  if (event.kind === "perfect") {
    return {
      shell: "min-h-[7.5rem] sm:min-h-[10rem]",
      label:
        "bg-[linear-gradient(105deg,#d8c3ff_5%,#f5f0ff_48%,#78e9bc_96%)] bg-clip-text text-[clamp(4.25rem,14vw,10rem)] font-black italic leading-[0.82] tracking-[-0.085em] text-transparent drop-shadow-[0_0_26px_rgba(216,185,255,0.3)]",
      bloom:
        "bg-[radial-gradient(ellipse_at_center,rgba(216,185,255,0.34),rgba(125,235,190,0.17)_42%,transparent_72%)]",
    };
  }

  return {
    shell: "min-h-[5.5rem] sm:min-h-[7rem]",
    label:
      "rounded-full border border-[rgba(216,185,255,0.46)] bg-[linear-gradient(115deg,rgba(216,185,255,0.2),rgba(157,240,209,0.14))] px-6 py-3 text-[clamp(1rem,3.3vw,1.7rem)] font-black uppercase tracking-[0.18em] text-[var(--accent-strong)] shadow-[0_0_32px_rgba(216,185,255,0.2)] backdrop-blur-xl sm:px-9 sm:py-4",
    bloom:
      "bg-[radial-gradient(ellipse_at_center,rgba(157,240,209,0.24),rgba(216,185,255,0.14)_45%,transparent_72%)]",
  };
}

function ImpactAccents() {
  return (
    <span className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <span className="absolute left-[4%] top-1/2 h-px w-[24%] -rotate-3 bg-gradient-to-r from-transparent via-[var(--accent)]/70 to-transparent" />
      <span className="absolute right-[4%] top-[42%] h-px w-[24%] rotate-3 bg-gradient-to-r from-transparent via-[var(--teal)]/70 to-transparent" />
      <span className="absolute bottom-0 left-1/2 flex -translate-x-1/2 items-end gap-1.5 opacity-55">
        <span className="h-2 w-1 rounded-full bg-[var(--accent)]" />
        <span className="h-5 w-1 rounded-full bg-[var(--teal)]" />
        <span className="h-3 w-1 rounded-full bg-[var(--accent)]" />
        <span className="h-7 w-1 rounded-full bg-[var(--teal)]" />
        <span className="h-3 w-1 rounded-full bg-[var(--accent)]" />
        <span className="h-5 w-1 rounded-full bg-[var(--teal)]" />
        <span className="h-2 w-1 rounded-full bg-[var(--accent)]" />
      </span>
    </span>
  );
}

export type ChallengeCelebrationProps = Readonly<{
  queue: readonly ChallengeCelebrationEvent[];
  onDismiss: () => void;
}>;

/**
 * A short, non-modal impact layer. It has no backdrop or interactive surface,
 * so the active Next/See results controls remain available beneath it.
 */
export function ChallengeCelebration({
  queue,
  onDismiss,
}: ChallengeCelebrationProps) {
  const prefersReducedMotion = useReducedMotion();
  const reducedMotion = prefersReducedMotion ?? false;
  const event = queue[0];

  useEffect(() => {
    if (event === undefined) {
      return undefined;
    }

    const timeoutId = window.setTimeout(onDismiss, CELEBRATION_DURATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [event, onDismiss]);

  const classes = event === undefined ? null : eventClasses(event);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-[clamp(5.25rem,12vh,8rem)] z-50 flex justify-center px-4"
      aria-live="polite"
      aria-atomic="true"
      role="status"
    >
      <AnimatePresence mode="wait" initial={false}>
        {event !== undefined && classes !== null && (
          <motion.div
            key={`${event.questionId}-${event.kind}`}
            className={`relative isolate flex w-full max-w-[calc(100vw-2rem)] items-center justify-center overflow-visible text-center sm:max-w-5xl ${classes.shell}`}
            initial={{ opacity: 0, scale: reducedMotion ? 1 : 0.68, y: reducedMotion ? 0 : -12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: reducedMotion ? 1 : 1.04, y: reducedMotion ? 0 : -8 }}
            transition={
              reducedMotion
                ? { duration: 0 }
                : { type: "spring", stiffness: 360, damping: 22, mass: 0.78 }
            }
          >
            <span
              className={`absolute inset-[-45%_-8%] -z-10 blur-2xl ${classes.bloom}`}
              aria-hidden="true"
            />
            <ImpactAccents />
            <span className={`relative inline-flex items-center justify-center ${classes.label}`}>
              {eventLabel(event)}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
