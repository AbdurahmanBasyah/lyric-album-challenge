import { describe, expect, it } from "vitest";

import type { SyncedLyricLine } from "@/types/game";

import { generateFourLineWindows } from "./lyric-window";

function makeLines(count: number): SyncedLyricLine[] {
  return Array.from({ length: count }, (_, index) => ({
    timestampMs: index * 1_000,
    text: `Synthetic line ${index}`,
  }));
}

describe("generateFourLineWindows", () => {
  it("returns no windows for fewer than four lines", () => {
    expect(generateFourLineWindows(makeLines(0))).toEqual([]);
    expect(generateFourLineWindows(makeLines(1))).toEqual([]);
    expect(generateFourLineWindows(makeLines(2))).toEqual([]);
    expect(generateFourLineWindows(makeLines(3))).toEqual([]);
  });

  it("returns one window for exactly four lines", () => {
    const lines = makeLines(4);

    expect(generateFourLineWindows(lines)).toEqual([lines]);
  });

  it("returns consecutive sliding windows for five lines", () => {
    const lines = makeLines(5);

    expect(generateFourLineWindows(lines)).toEqual([lines.slice(0, 4), lines.slice(1, 5)]);
  });

  it("returns N minus 3 windows for longer input", () => {
    expect(generateFourLineWindows(makeLines(8))).toHaveLength(5);
  });

  it("keeps four consecutive lines and their object identity", () => {
    const lines = makeLines(6);
    const windows = generateFourLineWindows(lines);

    for (const [windowIndex, window] of windows.entries()) {
      expect(window).toHaveLength(4);

      for (const [lineIndex, line] of window.entries()) {
        expect(line).toBe(lines[windowIndex + lineIndex]);
      }
    }
  });

  it("does not mutate the input", () => {
    const lines = makeLines(6);
    const originalLines = [...lines];

    generateFourLineWindows(lines);

    expect(lines).toEqual(originalLines);
    expect(lines).toStrictEqual(originalLines);
  });
});
