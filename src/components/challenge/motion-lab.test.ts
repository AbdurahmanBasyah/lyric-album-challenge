import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const componentSource = readFileSync(
  resolve(process.cwd(), "src/components/challenge/motion-lab.tsx"),
  "utf8",
);
const routeSource = readFileSync(
  resolve(process.cwd(), "src/app/dev/motion/page.tsx"),
  "utf8",
);

describe("development Motion Lab contract", () => {
  it("exposes every repeatable production state with synthetic copy", () => {
    for (const label of [
      "Correct Word",
      "Incorrect Word",
      "System Hint Reveal",
      "Expert -> Hard",
      "Hard -> Medium",
      "Medium -> Easy",
      "PERFECT",
      "STREAK x2",
      "STREAK x3",
      "Round Complete Solved",
      "Round Complete Failed",
      "Next Song transition",
      "Reduced Motion Preview",
    ]) {
      expect(componentSource).toContain(label);
    }

    expect(componentSource).toContain("Neon windows remember the shape of a melody.");
    expect(componentSource).toContain("synthetic fixture / no live providers");
    expect(componentSource).toContain("ChallengeCelebration");
    expect(componentSource).toContain("FTL_MOTION");
    expect(componentSource).toContain("data-motion-reduced");
    expect(componentSource).not.toContain("fetch(");
    expect(componentSource).not.toContain("spotify");
    expect(componentSource).not.toContain("youtube");
  });

  it("guards the route outside development", () => {
    expect(routeSource).toContain('process.env.NODE_ENV !== "development"');
    expect(routeSource).toContain("notFound()");
    expect(routeSource).toContain("<MotionLab />");
  });
});
