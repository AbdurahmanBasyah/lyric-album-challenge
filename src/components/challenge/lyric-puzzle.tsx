"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";

import type { ChallengeQuestionView } from "../../types/challenge";

export type HiddenSlotDescriptor = Readonly<{
  id: string;
  lineNumber: number;
  blankNumber: number;
}>;

const HIDDEN_PLACEHOLDER_PATTERN = /^_+$/u;
const MIN_INPUT_WIDTH_CH = 3;
const INPUT_WIDTH_BUFFER_CH = 1;
const INPUT_VIEWPORT_CAP = "42vw";

/**
 * Keep each answer slot proportional to the server-provided word-length hint
 * without allowing a long word to force horizontal overflow on small screens.
 * The placeholder itself remains untouched and is still rendered by the
 * browser, so this only controls the input's layout width.
 */
export function getResponsiveBlankWidth(placeholder: string): string {
  const placeholderLength = HIDDEN_PLACEHOLDER_PATTERN.test(placeholder)
    ? Array.from(placeholder).length
    : MIN_INPUT_WIDTH_CH - INPUT_WIDTH_BUFFER_CH;
  const widthInCh = Math.max(
    MIN_INPUT_WIDTH_CH,
    placeholderLength + INPUT_WIDTH_BUFFER_CH,
  );

  return `min(${widthInCh}ch, ${INPUT_VIEWPORT_CAP})`;
}

export function getHiddenSlotDescriptors(
  question: ChallengeQuestionView,
): readonly HiddenSlotDescriptor[] {
  const hiddenIds = new Set(question.hiddenTokenIds);
  const slots: HiddenSlotDescriptor[] = [];
  let blankNumber = 0;

  question.lines.forEach((line, lineIndex) => {
    line.tokens.forEach((token) => {
      if (token.state === "hidden" && hiddenIds.has(token.id)) {
        blankNumber += 1;
        slots.push(
          Object.freeze({
            id: token.id,
            lineNumber: lineIndex + 1,
            blankNumber,
          }),
        );
      }
    });
  });

  return Object.freeze(slots);
}

export function buildSubmittedAnswers(
  question: ChallengeQuestionView,
  drafts: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const answers: Record<string, string> = {};

  for (const { id } of getHiddenSlotDescriptors(question)) {
    const value = drafts[id];

    if (typeof value === "string" && value.trim().length > 0) {
      answers[id] = value;
    }
  }

  return Object.freeze(answers);
}

export function LyricPuzzle({
  question,
  drafts,
  disabled,
  onDraftChange,
}: {
  question: ChallengeQuestionView;
  drafts: Readonly<Record<string, string>>;
  disabled: boolean;
  onDraftChange: (tokenId: string, value: string) => void;
}) {
  const prefersReducedMotion = useReducedMotion();
  const reducedMotion = prefersReducedMotion ?? false;
  const hiddenIds = new Set(question.hiddenTokenIds);
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const descriptors = new Map(
    getHiddenSlotDescriptors(question).map((slot) => [slot.id, slot]),
  );

  // Focus only when a question/attempt changes. Draft edits do not change
  // these keys, so typing never gets interrupted by a rerender. The parent
  // disables the inputs while a guess is in flight; wait until the new state
  // is interactive before moving focus.
  useEffect(() => {
    if (disabled) {
      return;
    }

    firstInputRef.current?.focus();
  }, [disabled, question.attempt, question.id]);

  return (
    <section
      className="lyric-puzzle-surface glass-panel glass-panel-strong min-w-0 rounded-[1.5rem] px-4 py-6 shadow-[0_28px_80px_rgba(2,2,15,0.24)] sm:px-7 sm:py-8"
      aria-labelledby={`lyric-puzzle-heading-${question.id}`}
    >
      <h2
        className="sr-only"
        id={`lyric-puzzle-heading-${question.id}`}
      >
        Four-line lyric puzzle
      </h2>
      <p className="sr-only" id={`lyric-puzzle-help-${question.id}`}>
        Fill each hidden lyric word. Solved words are locked, and revealed
        words are hints.
      </p>
      <div className="space-y-4 sm:space-y-5">
        {question.lines.map((line, lineIndex) => (
          <p
            className="lyric-puzzle-line min-w-0 text-[clamp(1.18rem,2.4vw,1.75rem)] font-medium leading-[1.85] tracking-[-0.025em] text-[var(--foreground)]"
            key={`${question.id}-line-${lineIndex}`}
          >
            <span className="sr-only">Line {lineIndex + 1}: </span>
            {line.tokens.map((token) => {
              const descriptor = descriptors.get(token.id);

              if (
                token.state === "hidden" &&
                hiddenIds.has(token.id) &&
                descriptor !== undefined
              ) {
                return (
                  <input
                    className="lyric-puzzle-input mx-1 inline-block h-[2.15rem] max-w-[42vw] rounded-md border border-[rgba(216,185,255,0.42)] bg-[rgba(8,11,33,0.78)] px-1.5 text-center font-mono text-[0.86em] text-[var(--foreground)] caret-[var(--teal)] outline-none transition-[border-color,box-shadow,background-color] placeholder:text-[var(--muted)] focus:border-[var(--teal)] focus:bg-[rgba(17,22,51,0.92)] focus:shadow-[0_0_0_3px_rgba(157,240,209,0.13)] disabled:cursor-wait disabled:opacity-65"
                    key={token.id}
                    ref={descriptor.blankNumber === 1 ? firstInputRef : undefined}
                    id={`answer-${question.id}-${token.id}`}
                    type="text"
                    value={drafts[token.id] ?? ""}
                    placeholder={token.text}
                    style={{ width: getResponsiveBlankWidth(token.text) }}
                    aria-label={`Line ${descriptor.lineNumber}, blank ${descriptor.blankNumber}, hidden answer`}
                    aria-describedby={`lyric-puzzle-help-${question.id}`}
                    autoComplete="off"
                    autoCapitalize="none"
                    inputMode="text"
                    spellCheck={false}
                    maxLength={256}
                    disabled={disabled}
                    onChange={(event) =>
                      onDraftChange(token.id, event.currentTarget.value)
                    }
                  />
                );
              }

              if (token.state === "solved") {
                return (
                  <motion.span
                    className="inline rounded-md border border-[rgba(157,240,209,0.48)] bg-[rgba(157,240,209,0.12)] px-1 py-0.5 text-[var(--teal)] shadow-[0_0_18px_rgba(157,240,209,0.08)]"
                    key={token.id}
                    aria-label={`${token.text}, solved and locked`}
                    initial={false}
                    animate={{ scale: reducedMotion ? 1 : [1, 1.06, 1] }}
                    transition={{ duration: reducedMotion ? 0 : 0.32 }}
                  >
                    {token.text}
                    <span className="ml-1 text-[0.58em] font-bold" aria-hidden="true">
                      ✓
                    </span>
                  </motion.span>
                );
              }

              if (token.state === "revealed") {
                return (
                  <span
                    className="inline rounded-sm border-b border-dashed border-[var(--accent)] text-[var(--accent-strong)]"
                    key={token.id}
                    aria-label={`${token.text}, revealed hint`}
                  >
                    {token.text}
                  </span>
                );
              }

              return (
                <span className="whitespace-pre-wrap" key={token.id}>
                  {token.text}
                </span>
              );
            })}
          </p>
        ))}
      </div>
    </section>
  );
}
