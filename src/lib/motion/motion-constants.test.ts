import { describe, expect, it } from "vitest";

import { FTL_MOTION, motionSeconds } from "./motion-constants";

describe("canonical motion constants", () => {
  it("keeps the shared timing vocabulary and easing", () => {
    expect(FTL_MOTION).toMatchObject({
      microMs: 160,
      uiMs: 280,
      stateMs: 500,
      celebrationMs: 1500,
      perfectHoldMs: 500,
      streakHoldMs: 450,
      nextSongMs: 700,
    });
    expect(FTL_MOTION.ease).toEqual([0.22, 1, 0.36, 1]);
  });

  it("converts timer values at the animation boundary", () => {
    expect(motionSeconds(FTL_MOTION.reducedMotionMs)).toBe(0.15);
    expect(motionSeconds(FTL_MOTION.perfectTotalMs)).toBe(1.8);
  });
});
