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

function Step({
  attempt,
  label,
  currentAttempt,
  reducedMotion,
}: {
  attempt: AttemptNumber;
  label: string;
  currentAttempt: AttemptNumber;
  reducedMotion: boolean;
}) {
  const state = getDifficultyStepState(attempt, currentAttempt);
  const isActive = state === "active";
  const statusLabel =
    state === "completed"
      ? "completed"
      : state === "active"
        ? "current"
        : "upcoming";

  return (
    <motion.div
      className={`difficulty-step relative min-w-0 rounded-[1rem] border px-3 py-3 text-left transition-colors lg:px-4 ${
        isActive
          ? "border-[var(--accent)] bg-[rgba(216,185,255,0.14)] text-[var(--foreground)] shadow-[0_0_0_3px_rgba(216,185,255,0.08),0_0_24px_rgba(216,185,255,0.08)]"
          : state === "completed"
            ? "border-[rgba(157,240,209,0.4)] bg-[rgba(157,240,209,0.08)] text-[var(--muted-strong)]"
            : "border-[var(--border)] bg-[rgba(17,22,51,0.62)] text-[var(--muted)]"
      }`}
      initial={false}
      animate={{
        scale: reducedMotion ? 1 : isActive ? 1.025 : 1,
        opacity: state === "upcoming" ? 0.68 : 1,
      }}
      transition={{ duration: reducedMotion ? 0 : 0.24, ease: "easeOut" }}
      aria-current={isActive ? "step" : undefined}
    >
      <span className="flex min-w-0 items-center justify-between gap-2">
        <span className="difficulty-step-label min-w-0 truncate text-[0.67rem] font-bold uppercase tracking-[0.15em]">
          {label}
        </span>
        <span
          className={`difficulty-step-index grid h-5 w-5 flex-none place-items-center rounded-full border text-[0.62rem] font-bold ${
            state === "completed"
              ? "border-[var(--teal)] text-[var(--teal)]"
              : isActive
                ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]"
                : "border-[var(--border-strong)] text-[var(--muted)]"
          }`}
          aria-hidden="true"
        >
          {state === "completed" ? "✓" : attempt}
        </span>
      </span>
      <span className="difficulty-step-status mt-1 block text-[0.64rem] uppercase tracking-[0.1em] opacity-80">
        Attempt {attempt} · {statusLabel}
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
      className="min-w-0 lg:sticky lg:top-6 lg:self-start"
      aria-labelledby="difficulty-progress-heading"
    >
      <h2 className="sr-only" id="difficulty-progress-heading">
        Difficulty and attempt progression
      </h2>
      <p className="mb-3 text-[0.68rem] font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">
        Hint progression
      </p>

      <ol className="difficulty-rail-mobile grid grid-cols-4 items-stretch gap-1 lg:hidden">
        {DIFFICULTY_LEVELS.map((level, index) => (
          <li className="relative min-w-0" key={level.attempt}>
            <Step
              attempt={level.attempt}
              label={level.label}
              currentAttempt={attempt}
              reducedMotion={reducedMotion}
            />
            {index < DIFFICULTY_LEVELS.length - 1 && (
              <span
                className="difficulty-step-arrow pointer-events-none absolute -right-[0.42rem] top-1/2 z-10 -translate-y-1/2 text-xs text-[var(--muted)]"
                aria-hidden="true"
              >
                →
              </span>
            )}
          </li>
        ))}
      </ol>

      <ol className="hidden w-44 flex-col lg:flex">
        {DIFFICULTY_LEVELS.map((level, index) => (
          <li className="relative" key={level.attempt}>
            <Step
              attempt={level.attempt}
              label={level.label}
              currentAttempt={attempt}
              reducedMotion={reducedMotion}
            />
            {index < DIFFICULTY_LEVELS.length - 1 && (
              <span
                className="flex h-7 items-center justify-center text-sm text-[var(--muted)]"
                aria-hidden="true"
              >
                ↓
              </span>
            )}
          </li>
        ))}
      </ol>

      <p className="mt-3 text-xs leading-5 text-[var(--muted-strong)]">
        Hint level: <strong className="text-[var(--foreground)]">{label}</strong>
        {" · "}
        Attempt {attempt} of 4{finished ? " · round complete" : ""}
      </p>
    </aside>
  );
}
