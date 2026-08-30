import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { ChallengeQuestionView } from "../../types/challenge";
import {
  buildSubmittedAnswers,
  getHiddenSlotDescriptors,
  getResponsiveBlankWidth,
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

  it("sizes blanks from their variable server-provided placeholders", () => {
    expect(getResponsiveBlankWidth("__")).toBe("min(3ch, 42vw)");
    expect(getResponsiveBlankWidth("_______")).toBe("min(8ch, 42vw)");
    expect(getResponsiveBlankWidth("_".repeat(64))).toBe("min(65ch, 42vw)");
    expect(getResponsiveBlankWidth("invalid")).toBe("min(3ch, 42vw)");
  });

  it("keeps four-line semantics and non-color solved/revealed labels", () => {
    expect(source).toContain("aria-labelledby={`lyric-puzzle-heading-");
    expect(source).toContain("Four-line lyric puzzle");
    expect(source).toContain("solved and locked");
    expect(source).toContain("revealed hint");
    expect(source).toContain("hidden answer");
    expect(source).toContain("placeholder={token.text}");
    expect(source).toContain("getResponsiveBlankWidth(token.text)");
    expect(source).toContain("firstInputRef.current?.focus()");
    expect(source).toContain("question.attempt");
    expect(source).not.toContain('placeholder="____"');
    expect(source).toContain("useReducedMotion");
  });
});
