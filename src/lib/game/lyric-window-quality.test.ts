import { describe, expect, it } from "vitest";

import type { FourLineLyricWindow } from "@/types/game";

import {
  DEFAULT_LYRIC_WINDOW_QUALITY_CONFIG,
  evaluateLyricWindowQuality,
} from "./lyric-window-quality";

function makeWindow(lines: string[]): FourLineLyricWindow {
  if (lines.length !== 4) {
    throw new Error("A test lyric window must contain exactly four lines");
  }

  return lines.map((text, index) => ({
    timestampMs: index * 1_000,
    text,
  })) as FourLineLyricWindow;
}

describe("evaluateLyricWindowQuality", () => {
  it("accepts a strong natural-language synthetic window", () => {
    const result = evaluateLyricWindowQuality(
      makeWindow([
        "Morning trains carry silver echoes through the city",
        "Quiet windows gather stories beneath the rain",
        "Every corner keeps a map of unfinished chances",
        "I follow distant footsteps toward a brighter name",
      ]),
    );

    expect(result.eligible).toBe(true);
    expect(result.rejectionReasons).toEqual([]);
    expect(result.metrics.totalWordCount).toBeGreaterThanOrEqual(12);
  });

  it("rejects a filler-dominated window", () => {
    const result = evaluateLyricWindowQuality(makeWindow(["Oh", "Yeah", "Baby", "Oh"]));

    expect(result.eligible).toBe(false);
    expect(result.rejectionReasons).toEqual(
      expect.arrayContaining(["too-short", "insufficient-content", "filler-dominated"]),
    );
  });

  it("rejects an empty or punctuation-only window", () => {
    const result = evaluateLyricWindowQuality(makeWindow(["", "...", "—", "   "]));

    expect(result.eligible).toBe(false);
    expect(result.rejectionReasons).toEqual(["empty"]);
    expect(result.metrics.totalWordCount).toBe(0);
  });

  it("rejects an extremely short window", () => {
    const result = evaluateLyricWindowQuality(makeWindow(["Small", "words", "stay", "brief"]));

    expect(result.eligible).toBe(false);
    expect(result.rejectionReasons).toContain("too-short");
  });

  it("rejects identical and highly repetitive lines", () => {
    const result = evaluateLyricWindowQuality(
      makeWindow([
        "echo echo echo echo",
        "echo echo echo echo",
        "echo echo echo echo",
        "echo echo echo echo",
      ]),
    );

    expect(result.eligible).toBe(false);
    expect(result.rejectionReasons).toEqual(
      expect.arrayContaining(["low-diversity", "repetitive"]),
    );
    expect(result.metrics.uniqueLineCount).toBe(1);
  });

  it("rejects exact metadata-only lines without rejecting a normal sentence containing solo", () => {
    const metadataResult = evaluateLyricWindowQuality(
      makeWindow([
        "[Instrumental]",
        "City lights guide the late train home",
        "Rain settles over quiet streets",
        "Distant windows hold a warmer story",
      ]),
    );
    const normalResult = evaluateLyricWindowQuality(
      makeWindow([
        "I practice solo under amber lights",
        "The patient room remembers every chord",
        "Tomorrow carries music through the open door",
        "And every careful measure finds its shape",
      ]),
    );

    expect(metadataResult.rejectionReasons).toContain("metadata");
    expect(normalResult.rejectionReasons).not.toContain("metadata");
    expect(normalResult.eligible).toBe(true);
  });

  it("counts Unicode words and internal apostrophes consistently", () => {
    const result = evaluateLyricWindowQuality(
      makeWindow([
        "L'été brûle, déjà, sous les étoiles",
        "Cœur tranquille, l'enfant poursuit son rêve",
        "Mañana llevará música hacia la montaña",
        "We‘ll remember what we’ve learned together",
      ]),
      { minTotalWordCount: 1, minUniqueWordCount: 1, minContentWordCount: 1, minUniqueLineCount: 1 },
    );

    expect(result.eligible).toBe(true);
    expect(result.metrics.totalWordCount).toBe(24);
    expect(result.metrics.uniqueWordCount).toBeGreaterThan(20);
  });

  it("is deterministic for the same window and config", () => {
    const window = makeWindow([
      "Lanterns bloom above the river after midnight",
      "Careful hands arrange forgotten paper maps",
      "Small roads become a constellation of returns",
      "Dawn arrives with patient golden weather",
    ]);

    expect(evaluateLyricWindowQuality(window)).toEqual(evaluateLyricWindowQuality(window));
  });

  it("changes eligibility predictably with custom thresholds without mutating defaults", () => {
    const window = makeWindow([
      "Bright stars cross the evening sky",
      "Soft winds carry the river song",
      "Old bridges hold the morning light",
      "New footsteps find a steady road",
    ]);
    const relaxed = evaluateLyricWindowQuality(window, {
      minTotalWordCount: 1,
      minUniqueWordCount: 1,
      minContentWordCount: 1,
      minUniqueLineCount: 1,
    });
    const strict = evaluateLyricWindowQuality(window, { minTotalWordCount: 100 });

    expect(relaxed.eligible).toBe(true);
    expect(strict.eligible).toBe(false);
    expect(strict.rejectionReasons).toContain("too-short");
    expect(DEFAULT_LYRIC_WINDOW_QUALITY_CONFIG.minTotalWordCount).toBe(12);
  });

  it("throws for invalid configuration", () => {
    const window = makeWindow([
      "one two three four",
      "five six seven eight",
      "nine ten eleven twelve",
      "thirteen fourteen fifteen sixteen",
    ]);

    expect(() => evaluateLyricWindowQuality(window, { minTotalWordCount: -1 })).toThrow();
    expect(() => evaluateLyricWindowQuality(window, { maxFillerRatio: 1.1 })).toThrow();
    expect(() => evaluateLyricWindowQuality(window, { minLexicalDiversity: Number.NaN })).toThrow();
  });

  it("always returns a finite score from 0 through 100 without lyric payload", () => {
    const result = evaluateLyricWindowQuality(
      makeWindow(["One bright river", "Two quiet roads", "Three open doors", "Four patient stars"]),
    );

    expect(Number.isFinite(result.qualityScore)).toBe(true);
    expect(result.qualityScore).toBeGreaterThanOrEqual(0);
    expect(result.qualityScore).toBeLessThanOrEqual(100);
    expect(result).not.toHaveProperty("lines");
    expect(result).not.toHaveProperty("words");
    expect(JSON.stringify(result)).not.toContain("bright river");
  });
});
