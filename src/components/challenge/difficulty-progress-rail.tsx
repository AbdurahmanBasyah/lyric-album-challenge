"use client";

import { motion, useReducedMotion } from "motion/react";

import type { AttemptNumber } from "../../types/game";

export const DIFFICULTY_LEVELS = Object.freeze([
  Object.freeze({ attempt: 1 as const, label: "Expert" }),
  Object.freeze({ attempt: 2 as const, label: "Hard" }),
  Object.freeze({ attempt: 3 as const, label: "Medium" }),
  Object.freeze({ attempt: 4 as const, label: "Easy" }),
]);

export type DifficultyStepState = "completed" | "active" | "upcoming";

export function getDifficultyLabel(attempt: AttemptNumber): string {
  return DIFFICULTY_LEVELS[attempt - 1].label;
}

export function getDifficultyStepState(
  stepAttempt: AttemptNumber,
  currentAttempt: AttemptNumber,
): DifficultyStepState {
  if (stepAttempt < currentAttempt) {
    return "completed";
  }

  return stepAttempt === currentAttempt ? "active" : "upcoming";
}

function statusCopy(state: DifficultyStepState, finished: boolean): string {
  if (state === "completed") {
    return "past attempt";
  }

  if (state === "active") {
    return finished ? "last attempt" : "current";
  }

  return "up next";
}

function Step({
  attempt,
  label,
  currentAttempt,
  finished,
  reducedMotion,
}: {
  attempt: AttemptNumber;
  label: string;
  currentAttempt: AttemptNumber;
  finished: boolean;
  reducedMotion: boolean;
}) {
  const state = getDifficultyStepState(attempt, currentAttempt);
  const isActive = state === "active";
  const stateCopy = statusCopy(state, finished);

  return (
    <motion.div
      className={`difficulty-step ftl-difficulty-step ftl-difficulty-step--${state}`}
      initial={false}
      animate={{ opacity: state === "upcoming" ? 0.62 : 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.24, ease: "easeOut" }}
      aria-current={isActive ? "step" : undefined}
      aria-label={`${label}, ${stateCopy}`}
    >
      <span className="ftl-difficulty-step__marker" aria-hidden="true">
        {state === "completed" ? "•" : attempt}
      </span>
      <span className="ftl-difficulty-step__copy">
        <span className="difficulty-step-label ftl-difficulty-step__label">{label}</span>
        <span className="difficulty-step-status ftl-difficulty-step__status">
          {stateCopy}
        </span>
      </span>
    </motion.div>
  );
}

export function DifficultyProgressRail({
  attempt,
  finished = false,
}: {
  attempt: AttemptNumber;
  finished?: boolean;
}) {
  const prefersReducedMotion = useReducedMotion();
  const reducedMotion = prefersReducedMotion ?? false;
  const label = getDifficultyLabel(attempt);

  return (
    <aside
      className="ftl-difficulty-rail min-w-0 lg:sticky lg:top-6 lg:self-start"
      aria-labelledby="difficulty-progress-heading"
    >
      <h2 className="sr-only" id="difficulty-progress-heading">
        Difficulty and attempt progression
      </h2>
      <p className="ftl-difficulty-rail__heading">Hint progression</p>

      <ol className="difficulty-rail-mobile ftl-difficulty-rail__steps ftl-difficulty-rail__steps--mobile lg:hidden">
        {DIFFICULTY_LEVELS.map((level, index) => (
          <li className="ftl-difficulty-rail__item" key={level.attempt}>
            <Step
              attempt={level.attempt}
              label={level.label}
              currentAttempt={attempt}
              finished={finished}
              reducedMotion={reducedMotion}
            />
            {index < DIFFICULTY_LEVELS.length - 1 && (
              <span className="difficulty-step-arrow ftl-difficulty-rail__connector" aria-hidden="true">
                →
              </span>
            )}
          </li>
        ))}
      </ol>

      <ol className="ftl-difficulty-rail__steps ftl-difficulty-rail__steps--desktop hidden lg:flex">
        {DIFFICULTY_LEVELS.map((level, index) => (
          <li className="ftl-difficulty-rail__item" key={level.attempt}>
            <Step
              attempt={level.attempt}
              label={level.label}
              currentAttempt={attempt}
              finished={finished}
              reducedMotion={reducedMotion}
            />
            {index < DIFFICULTY_LEVELS.length - 1 && (
              <span className="ftl-difficulty-rail__connector ftl-difficulty-rail__connector--desktop" aria-hidden="true">
                ↓
              </span>
            )}
          </li>
        ))}
      </ol>

      <p className="ftl-difficulty-rail__summary">
        <span>{label}</span>
        <span aria-hidden="true">·</span>
        <span>Attempt {attempt} of 4</span>
      </p>
    </aside>
  );
}
