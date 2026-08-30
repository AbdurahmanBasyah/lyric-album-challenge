import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DIFFICULTY_LEVELS,
  getDifficultyLabel,
  getDifficultyStepState,
} from "./difficulty-progress-rail";

const source = readFileSync(
  resolve(
    process.cwd(),
    "src/components/challenge/difficulty-progress-rail.tsx",
  ),
  "utf8",
);

describe("difficulty progress rail", () => {
  it("maps the requested labels to attempts one through four", () => {
    expect(DIFFICULTY_LEVELS).toEqual([
      { attempt: 1, label: "Expert" },
      { attempt: 2, label: "Hard" },
      { attempt: 3, label: "Medium" },
      { attempt: 4, label: "Easy" },
    ]);
    expect(getDifficultyLabel(1)).toBe("Expert");
    expect(getDifficultyLabel(4)).toBe("Easy");
  });

  it("marks prior, current, and future difficulty states deterministically", () => {
    expect(getDifficultyStepState(1, 3)).toBe("completed");
    expect(getDifficultyStepState(3, 3)).toBe("active");
    expect(getDifficultyStepState(4, 3)).toBe("upcoming");
  });

  it("keeps arrow direction, text semantics, and reduced motion in source", () => {
    expect(source).toContain('aria-current={isActive ? "step"');
    expect(source).toContain('aria-labelledby="difficulty-progress-heading"');
    expect(source).toContain("difficulty-rail-mobile");
    expect(source).toContain("difficulty-step-status");
    expect(source).toContain("useReducedMotion");
    expect(source).toContain("→");
    expect(source).toContain("↓");
    expect(source).toContain("lg:hidden");
    expect(source).toContain("lg:flex");
  });
});
