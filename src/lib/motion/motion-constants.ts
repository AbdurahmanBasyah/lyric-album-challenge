/**
 * Shared motion timings for the canonical FillTheLyrics stage.
 *
 * Values are kept in milliseconds because they are also used by presentation
 * timers. Motion components convert them to seconds only at the boundary.
 * Reduced-motion timings are deliberately short: state must remain readable
 * without waiting for a decorative animation to finish.
 */
export const FTL_MOTION = {
  microMs: 160,
  uiMs: 280,
  stateMs: 500,
  celebrationMs: 1_500,
  perfectHoldMs: 500,
  streakHoldMs: 450,
  nextSongMs: 700,
  reducedMotionMs: 150,
  perfectTotalMs: 1_800,
  streakTotalMs: 1_650,
  ease: [0.22, 1, 0.36, 1] as const,
} as const;

export type FtlMotionConstants = typeof FTL_MOTION;

export function motionSeconds(milliseconds: number): number {
  return milliseconds / 1_000;
}
