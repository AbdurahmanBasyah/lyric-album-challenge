"use client";

import { motion, useReducedMotion } from "motion/react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

import type {
  ChallengeQuestionView,
  ChallengeRenderedToken,
} from "../../types/challenge";

export type HiddenSlotDescriptor = Readonly<{
  id: string;
  lineNumber: number;
  blankNumber: number;
}>;

/**
 * These are client-only presentation states. The server continues to expose
 * only hidden/solved/revealed/static token states.
 */
export type LyricWordUiState =
  | "static"
  | "hidden"
  | "focused"
  | "draft"
  | "focused-draft"
  | "solved"
  | "revealed";

const HIDDEN_PLACEHOLDER_PATTERN = /^_+$/u;
const MIN_INPUT_WIDTH_CH = 4;
const INPUT_WIDTH_BUFFER_CH = 1;
const INPUT_VIEWPORT_CAP = "42vw";
const MAX_DRAFT_LENGTH = 256;

/**
 * Keep each gap proportional to the server-provided underscore placeholder.
 * The placeholder is safe to use for layout because it contains no answer
 * text; answer values never cross this component boundary.
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

export function getFirstUnresolvedGapId(
  question: ChallengeQuestionView,
): string | null {
  return getHiddenSlotDescriptors(question)[0]?.id ?? null;
}

/**
 * Return the next unresolved gap in reading order. This helper is used by the
 * game shell when an attempt changes; ordinary keyboard traversal remains the
 * browser's native Tab/Shift+Tab order between the inline inputs.
 */
export function getNextUnresolvedGapId(
  question: ChallengeQuestionView,
  currentGapId: string | null,
): string | null {
  const slots = getHiddenSlotDescriptors(question);

  if (slots.length === 0) {
    return null;
  }

  const currentIndex = slots.findIndex((slot) => slot.id === currentGapId);
  return slots[currentIndex >= 0 ? (currentIndex + 1) % slots.length : 0]?.id ?? null;
}

export function getGapAccessibleLabel(slot: HiddenSlotDescriptor): string {
  return `Missing word ${slot.blankNumber} on line ${slot.lineNumber}`;
}

export type GapKeyboardEventLike = Readonly<{
  key: string;
  isComposing?: boolean;
  nativeEvent?: Readonly<{
    isComposing?: boolean;
    keyCode?: number;
  }>;
}>;

/**
 * Browsers expose composition state on both the React event and its native
 * event. Some engines still report keyCode 229 while an IME is composing.
 */
export function isImeCompositionActive(event: GapKeyboardEventLike): boolean {
  return (
    event.isComposing === true ||
    event.nativeEvent?.isComposing === true ||
    event.nativeEvent?.keyCode === 229
  );
}

/**
 * Enter is never a gap-navigation action. Returning true lets the input
 * handler suppress both implicit form submission and any browser-specific
 * default while preserving all composition/input events.
 */
export function shouldSuppressGapEnter(
  event: GapKeyboardEventLike,
): boolean {
  return event.key === "Enter";
}

export function getLyricWordUiState(
  token: ChallengeRenderedToken,
  activeGapId: string | null,
  draft: string | undefined,
): LyricWordUiState {
  if (token.state !== "hidden") {
    return token.state;
  }

  const hasDraft = typeof draft === "string" && draft.trim().length > 0;

  if (activeGapId === token.id) {
    return hasDraft ? "focused-draft" : "focused";
  }

  return hasDraft ? "draft" : "hidden";
}

export function getGapDisplayValue(draft: string | undefined): string {
  return typeof draft === "string" && draft.trim().length > 0 ? draft : "";
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

function renderSolvedToken(
  token: ChallengeRenderedToken,
  reducedMotion: boolean,
) {
  return (
    <motion.span
      className="ftl-lyric-token ftl-lyric-token--solved"
      key={token.id}
      aria-label="Player-solved lyric word, solved and locked"
      initial={reducedMotion ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.22, ease: "easeOut" }}
    >
      {token.text}
    </motion.span>
  );
}

function renderRevealedToken(
  token: ChallengeRenderedToken,
  reducedMotion: boolean,
) {
  return (
    <motion.span
      className="ftl-lyric-token ftl-lyric-token--revealed"
      key={token.id}
      aria-label="System-revealed lyric word, revealed hint"
      initial={reducedMotion ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.28, ease: "easeOut" }}
    >
      {token.text}
    </motion.span>
  );
}

function renderInlineGap({
  token,
  descriptor,
  questionId,
  draft,
  uiState,
  disabled,
  autoFocus,
  reducedMotion,
  onSelectGap,
  onDraftChange,
}: {
  token: ChallengeRenderedToken;
  descriptor: HiddenSlotDescriptor;
  questionId: string;
  draft: string;
  uiState: LyricWordUiState;
  disabled: boolean;
  autoFocus: boolean;
  reducedMotion: boolean;
  onSelectGap: (tokenId: string) => void;
  onDraftChange: (tokenId: string, value: string) => void;
}) {
  const visibleValue = getGapDisplayValue(draft);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!shouldSuppressGapEnter(event)) {
      // In particular, do not intercept Tab. Native DOM order is the reading
      // order of unresolved inputs, so Tab and Shift+Tab work naturally.
      return;
    }

    // Let the IME own Enter so it can commit the composing text. The form has
    // no submit control and its submit guard prevents an accidental guess.
    if (isImeCompositionActive(event)) {
      return;
    }

    // Ordinary Enter is never navigation or implicit validation.
    event.preventDefault();
  };

  return (
    <motion.span
      className={`ftl-lyric-gap-wrap ftl-lyric-gap-wrap--${uiState}`}
      key={token.id}
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.16, ease: "easeOut" }}
    >
      <input
        className="ftl-lyric-gap"
        id={`lyric-gap-${questionId}-${token.id}`}
        type="text"
        value={visibleValue}
        placeholder={token.text}
        aria-label={getGapAccessibleLabel(descriptor)}
        aria-describedby={`lyric-puzzle-help-${questionId}`}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        inputMode="text"
        spellCheck={false}
        maxLength={MAX_DRAFT_LENGTH}
        disabled={disabled}
        autoFocus={autoFocus}
        style={{ width: getResponsiveBlankWidth(token.text) }}
        onFocus={() => onSelectGap(token.id)}
        onChange={(event) => {
          // onChange can be delivered before a browser focus event in a few
          // assistive/mobile flows, so keep activeGapId authoritative here too.
          onSelectGap(token.id);
          onDraftChange(token.id, event.currentTarget.value);
        }}
        onKeyDown={handleKeyDown}
      />
    </motion.span>
  );
}

export function LyricPuzzle({
  question,
  drafts,
  activeGapId,
  disabled,
  onSelectGap,
  onDraftChange,
  children,
}: {
  question: ChallengeQuestionView;
  drafts: Readonly<Record<string, string>>;
  activeGapId: string | null;
  disabled: boolean;
  onSelectGap: (tokenId: string) => void;
  onDraftChange: (tokenId: string, value: string) => void;
  children?: ReactNode;
}) {
  const prefersReducedMotion = useReducedMotion();
  const reducedMotion = prefersReducedMotion ?? false;
  const hiddenIds = new Set(question.hiddenTokenIds);
  const slots = getHiddenSlotDescriptors(question);
  const descriptors = new Map(slots.map((slot) => [slot.id, slot]));
  const firstGapId = slots[0]?.id ?? null;
  const autoFocusGapId = activeGapId ?? firstGapId;

  return (
    <section
      className="ftl-lyric-stage"
      aria-labelledby={`lyric-puzzle-heading-${question.id}`}
    >
      <div className="ftl-lyric-stage__topline">
        <p className="ftl-lyric-stage__eyebrow">Four-line lyric stage</p>
        <p
          className="ftl-lyric-stage__progress"
          aria-label="Current lyric progress"
        >
          {question.progress.solved} of {question.progress.totalAnswerTokens} solved
        </p>
      </div>
      <h2 className="sr-only" id={`lyric-puzzle-heading-${question.id}`}>
        Four-line lyric puzzle
      </h2>
      <p className="sr-only" id={`lyric-puzzle-help-${question.id}`}>
        Each missing lyric word is an inline answer field. Type in a gap and
        use Tab or Shift+Tab to move between gaps. Check Words validates the
        current attempt. Solved words are locked, and revealed words are hints.
      </p>
      <div className="ftl-lyric-lines">
        {question.lines.map((line, lineIndex) => (
          <p
            className="ftl-gameplay-lyric-line"
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
                const draft = drafts[token.id] ?? "";
                const uiState = getLyricWordUiState(
                  token,
                  activeGapId,
                  draft,
                );

                return renderInlineGap({
                  token,
                  descriptor,
                  questionId: question.id,
                  draft,
                  uiState,
                  disabled,
                  autoFocus: autoFocusGapId === token.id,
                  reducedMotion,
                  onSelectGap,
                  onDraftChange,
                });
              }

              if (token.state === "solved") {
                return renderSolvedToken(token, reducedMotion);
              }

              if (token.state === "revealed") {
                return renderRevealedToken(token, reducedMotion);
              }

              return (
                <span
                  className="ftl-lyric-token ftl-lyric-token--static"
                  key={token.id}
                >
                  {token.text}
                </span>
              );
            })}
          </p>
        ))}
      </div>
      {children}
    </section>
  );
}
