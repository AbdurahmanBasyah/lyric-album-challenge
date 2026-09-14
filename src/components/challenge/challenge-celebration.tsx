"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect } from "react";

import { FTL_MOTION, motionSeconds } from "../../lib/motion/motion-constants";
import type { ChallengeGuessFinishedView } from "../../types/challenge";

/** The streak popup starts only after two consecutive solved songs. */
export const MIN_STREAK_FOR_CELEBRATION = 2 as const;
export const MAX_STREAK_FOR_CELEBRATION = 5 as const;

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
 * The terminal response is the authority for celebration facts. The attempt
 * guard is intentionally repeated at this presentation boundary so a stale
 * or malformed response can never show Perfect for a recovery attempt. The
 * initial Expert mask is free baseline visibility and is not inspected here.
 */
export function isPerfectCelebrationResult(
  result: Pick<ChallengeGuessFinishedView, "result" | "attemptsUsed" | "perfect">,
): boolean {
  return (
    result.result === "solved" &&
    result.attemptsUsed === 1 &&
    result.perfect === true
  );
}

/**
 * Build one ordered presentation queue from server-owned terminal facts.
 * Perfect always precedes Streak when both are earned. Failed results never
 * emit either event, and Streak 1 remains a quiet metric rather than a large
 * overlay.
 */
export function buildCelebrationQueue(
  result: Pick<
    ChallengeGuessFinishedView,
    "result" | "questionId" | "attemptsUsed" | "perfect" | "streak"
  >,
): readonly ChallengeCelebrationEvent[] {
  if (result.result !== "solved") {
    return Object.freeze([]);
  }

  const events: ChallengeCelebrationEvent[] = [];

  if (isPerfectCelebrationResult(result)) {
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

export type CelebrationPresentationPhase =
  | "gameplay"
  | "celebrating-perfect"
  | "celebrating-streak"
  | "round-complete";

export function phaseForCelebrationEvent(
  event: ChallengeCelebrationEvent | undefined,
): CelebrationPresentationPhase {
  if (event?.kind === "perfect") {
    return "celebrating-perfect";
  }

  if (event?.kind === "streak") {
    return "celebrating-streak";
  }

  return "round-complete";
}

function eventAnnouncement(event: ChallengeCelebrationEvent): string {
  return event.kind === "perfect"
    ? "Perfect. Solved on Expert."
    : `Streak: ${event.streak} songs.`;
}

function celebrationDurationMs(
  event: ChallengeCelebrationEvent,
  reducedMotion: boolean,
): number {
  if (reducedMotion) {
    return FTL_MOTION.reducedMotionMs;
  }

  return event.kind === "perfect"
    ? FTL_MOTION.perfectTotalMs
    : FTL_MOTION.streakTotalMs;
}

function ImpactAccents() {
  return (
    <span className="ftl-celebration-accents" aria-hidden="true">
      <span className="ftl-celebration-accents__line ftl-celebration-accents__line--left" />
      <span className="ftl-celebration-accents__line ftl-celebration-accents__line--right" />
      <span className="ftl-celebration-accents__bars">
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
      </span>
    </span>
  );
}

export type ChallengeCelebrationProps = Readonly<{
  queue: readonly ChallengeCelebrationEvent[];
  onDismiss: () => void;
  /** Used by the Motion Lab; production follows the browser preference. */
  reducedMotionOverride?: boolean;
}>;

/**
 * A short, non-modal impact layer. The stage remains mounted underneath it;
 * this layer is pointer-transparent and never becomes a route or dialog.
 */
export function ChallengeCelebration({
  queue,
  onDismiss,
  reducedMotionOverride,
}: ChallengeCelebrationProps) {
  const prefersReducedMotion = useReducedMotion();
  const reducedMotion =
    reducedMotionOverride ?? prefersReducedMotion ?? false;
  const event = queue[0];

  useEffect(() => {
    if (event === undefined) {
      return undefined;
    }

    const timeoutId = window.setTimeout(
      onDismiss,
      celebrationDurationMs(event, reducedMotion),
    );
    return () => window.clearTimeout(timeoutId);
  }, [event, onDismiss, reducedMotion]);

  if (event === undefined) {
    return null;
  }

  const eventKey = `${event.questionId}-${event.kind}`;
  const isPerfect = event.kind === "perfect";

  return (
    <div
      className={`ftl-celebration-layer pointer-events-none max-w-[calc(100vw-2rem)] ${
        reducedMotion ? "ftl-celebration-layer--reduced" : ""
      }`}
      data-celebration-kind={event.kind}
      aria-live="polite"
      aria-atomic="true"
      role="status"
    >
      <span className="sr-only" key={`announcement-${eventKey}`}>
        {eventAnnouncement(event)}
      </span>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={eventKey}
          className={`ftl-celebration-stage ${
            isPerfect
              ? "ftl-celebration-stage--perfect"
              : "ftl-celebration-stage--streak"
          }`}
          initial={{
            opacity: 0,
            scale: reducedMotion ? 1 : isPerfect ? 0.88 : 0.94,
            y: reducedMotion ? 0 : 10,
          }}
          animate={{
            opacity: 1,
            scale: 1,
            y: 0,
          }}
          exit={{
            opacity: 0,
            scale: 1,
            y: reducedMotion ? 0 : -5,
          }}
          transition={{
            duration: motionSeconds(
              reducedMotion ? FTL_MOTION.reducedMotionMs : FTL_MOTION.uiMs,
            ),
            ease: FTL_MOTION.ease,
          }}
          aria-hidden="true"
        >
          <span className="ftl-celebration-bloom" />
          <ImpactAccents />

          {isPerfect ? (
            <span className="ftl-celebration-copy">
              <span className="ftl-celebration-copy__headline">PERFECT</span>
              <span className="ftl-celebration-copy__sublabel">EXPERT CLEAR</span>
            </span>
          ) : (
            <span className="ftl-celebration-copy ftl-celebration-copy--streak">
              <span className="ftl-celebration-copy__headline">STREAK</span>
              <span className="ftl-celebration-copy__value">×{event.streak}</span>
            </span>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
