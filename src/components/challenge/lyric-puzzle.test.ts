import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { ChallengeQuestionView } from "../../types/challenge";
import {
  buildSubmittedAnswers,
  getFirstUnresolvedGapId,
  getGapDisplayValue,
  getGapAccessibleLabel,
  getHiddenSlotDescriptors,
  getLyricWordUiState,
  getNextUnresolvedGapId,
  getResponsiveBlankWidth,
  isImeCompositionActive,
  shouldSuppressGapEnter,
} from "./lyric-puzzle";

const source = readFileSync(
  resolve(process.cwd(), "src/components/challenge/lyric-puzzle.tsx"),
  "utf8",
);

function question(): ChallengeQuestionView {
  return {
    id: "question_12345678",
    attempt: 1,
    maxAttempts: 4,
    status: "active",
    lines: [0, 1, 2, 3].map((lineIndex) => ({
      timestampMs: lineIndex * 1_000,
      tokens: [
        {
          id: `l${lineIndex}t0`,
          text: "_".repeat(lineIndex + 2),
          state: "hidden",
        },
        { id: `l${lineIndex}t1`, text: " ", state: "static" },
        { id: `l${lineIndex}t2`, text: "hint", state: "revealed" },
      ],
    })),
    hiddenTokenIds: ["l0t0", "l1t0", "l2t0", "l3t0"],
    progress: { solved: 0, revealed: 4, totalAnswerTokens: 8 },
  };
}

describe("lyric puzzle helpers", () => {
  it("maps hidden token IDs to stable line and blank labels", () => {
    expect(getHiddenSlotDescriptors(question())).toEqual([
      { id: "l0t0", lineNumber: 1, blankNumber: 1 },
      { id: "l1t0", lineNumber: 2, blankNumber: 2 },
      { id: "l2t0", lineNumber: 3, blankNumber: 3 },
      { id: "l3t0", lineNumber: 4, blankNumber: 4 },
    ]);
  });

  it("submits only non-empty answers for current hidden token IDs", () => {
    expect(
      buildSubmittedAnswers(question(), {
        l0t0: "answer",
        l1t0: "  ",
        l2t0: "second",
        unknown: "must-not-cross",
      }),
    ).toEqual({ l0t0: "answer", l2t0: "second" });
  });

  it("selects stable first and next unresolved targets in reading order", () => {
    const value = question();
    expect(getFirstUnresolvedGapId(value)).toBe("l0t0");
    expect(getNextUnresolvedGapId(value, "l0t0")).toBe("l1t0");
    expect(getNextUnresolvedGapId(value, "l3t0")).toBe("l0t0");
    expect(getNextUnresolvedGapId(value, "solved-id")).toBe("l0t0");
    expect(
      getGapAccessibleLabel({ id: "l1t0", lineNumber: 2, blankNumber: 2 }),
    ).toBe("Missing word 2 on line 2");
  });

  it("derives focused, focused-draft, draft, solved, and revealed states", () => {
    const hidden = question().lines[0].tokens[0];
    const revealed = question().lines[0].tokens[2];
    const solved = { ...hidden, state: "solved" as const, text: "locked" };

    expect(getLyricWordUiState(hidden, hidden.id, "")).toBe("focused");
    expect(getLyricWordUiState(hidden, hidden.id, "candidate")).toBe(
      "focused-draft",
    );
    expect(getLyricWordUiState(hidden, "other", "candidate")).toBe("draft");
    expect(getLyricWordUiState(hidden, "other", "  ")).toBe("hidden");
    expect(getLyricWordUiState(solved, null, undefined)).toBe("solved");
    expect(getLyricWordUiState(revealed, null, undefined)).toBe("revealed");
  });

  it("keeps drafts visible in their corresponding controls", () => {
    expect(getGapDisplayValue(undefined)).toBe("");
    expect(getGapDisplayValue("  ")).toBe("");
    expect(getGapDisplayValue("candidate")).toBe("candidate");
  });

  it("sizes blanks from their variable server-provided placeholders", () => {
    expect(getResponsiveBlankWidth("_")).toBe("min(4ch, 42vw)");
    expect(getResponsiveBlankWidth("__")).toBe("min(4ch, 42vw)");
    expect(getResponsiveBlankWidth("_______")).toBe("min(8ch, 42vw)");
    expect(getResponsiveBlankWidth("_".repeat(64))).toBe("min(65ch, 42vw)");
    expect(getResponsiveBlankWidth("invalid")).toBe("min(4ch, 42vw)");
  });

  it("keeps short drafts readable inside the safe lexical-width floor", () => {
    const samples = ["a", "I", "to", "go", "we", "ordinary"];

    for (const sample of samples) {
      expect(getGapDisplayValue(sample)).toBe(sample);
      const width = getResponsiveBlankWidth("_".repeat(sample.length));
      const expectedWidth = Math.max(4, sample.length + 1);
      expect(width).toBe(`min(${expectedWidth}ch, 42vw)`);
    }
  });

  it("suppresses Enter without ever making it a navigation action", () => {
    expect(shouldSuppressGapEnter({ key: "Enter" })).toBe(true);
    expect(shouldSuppressGapEnter({ key: "Tab" })).toBe(false);
    expect(isImeCompositionActive({ key: "Enter", isComposing: true })).toBe(
      true,
    );
    expect(
      isImeCompositionActive({
        key: "Enter",
        nativeEvent: { isComposing: true },
      }),
    ).toBe(true);
    expect(
      isImeCompositionActive({ key: "Enter", nativeEvent: { keyCode: 229 } }),
    ).toBe(true);
  });

  it("keeps the inline input and security contract explicit", () => {
    expect(source).toContain('aria-labelledby={`lyric-puzzle-heading-');
    expect(source).toContain("Four-line lyric puzzle");
    expect(source).toContain("solved and locked");
    expect(source).toContain("revealed hint");
    expect(source).toContain("Missing word");
    expect(source).toContain("ftl-lyric-gap");
    expect(source).toContain("placeholder={token.text}");
    expect(source).toContain("autoFocus={autoFocus}");
    expect(source).toContain("onFocus={() => onSelectGap(token.id)}");
    expect(source).toContain("onDraftChange(token.id");
    expect(source).toContain(
      "style={{ width: getResponsiveBlankWidth(token.text) }}",
    );
    expect(source).toContain("shouldSuppressGapEnter(event)");
    expect(source).toContain("isImeCompositionActive(event)");
    expect(source).toContain("use Tab or Shift+Tab");
    expect(source).not.toContain(["Answer", "Composer"].join(""));
    expect(source).not.toContain(["answer", "-composer"].join(""));
    expect(source).not.toContain('placeholder="____"');
    expect(source).not.toContain("firstInputRef.current?.focus()");
    expect(source.match(/<input\b/g)).toHaveLength(1);
    expect(source).toContain("useReducedMotion");
  });
});
