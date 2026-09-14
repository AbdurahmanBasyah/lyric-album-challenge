import { describe, expect, it } from "vitest";

import { compareToken, normalizeAnswer } from "./matching";

describe("normalizeAnswer", () => {
  it("normalizes case, NFKC compatibility characters, apostrophes, and whitespace", () => {
    expect(normalizeAnswer("  \uFF37\uFF25\u2019\uFF32\uFF25\tHERE  ")).toBe(
      "were here",
    );
  });

  it("preserves hyphens, meaningful punctuation, and diacritics", () => {
    expect(normalizeAnswer("  Rock'n'R\u00F6ll!  ")).toBe("rocknr\u00F6ll!");
    expect(normalizeAnswer("caf\u00E9")).toBe("caf\u00E9");
    expect(normalizeAnswer("well-being")).toBe("well-being");
    expect(compareToken("5\u2032", "5").matched).toBe(false);
  });

  it("does not use fuzzy matching or remove non-apostrophe punctuation", () => {
    expect(compareToken("ask", "asked").matched).toBe(false);
    expect(compareToken("rock'n'roll", "rock n roll").matched).toBe(false);
    expect(compareToken("caf\u00E9", "cafe").matched).toBe(false);
  });

  it("rejects non-string values explicitly", () => {
    expect(() => normalizeAnswer(42 as unknown as string)).toThrow(/must be a string/i);
    expect(() => compareToken("word", null as unknown as string)).toThrow(/must be a string/i);
  });

  it("treats an empty answer as a valid normalized value", () => {
    expect(normalizeAnswer(" \n\t ")).toBe("");
    expect(compareToken("word", " ").matched).toBe(false);
  });
});

describe("compareToken", () => {
  it("matches apostrophe-optional normalized answers case-insensitively", () => {
    expect(compareToken("We're", "  we\u2019re  ")).toEqual({ matched: true });
    expect(compareToken("don't", "dont")).toEqual({ matched: true });
    expect(compareToken("I\u2019m", "im")).toEqual({ matched: true });
    expect(compareToken("you\u2019re", "youre")).toEqual({ matched: true });
    expect(compareToken("don\u02BCt", "DON'T")).toEqual({ matched: true });
    expect(compareToken("signal", "SIGNAL")).toEqual({ matched: true });
  });

  it("keeps hyphen, diacritic, and other meaningful punctuation differences strict", () => {
    expect(compareToken("well-being", "wellbeing").matched).toBe(false);
    expect(compareToken("caf\u00E9", "cafe").matched).toBe(false);
    expect(compareToken("word!", "word").matched).toBe(false);
  });

  it("returns only a match fact and does not echo answer content", () => {
    const result = compareToken("hidden-lyric", "wrong-submission");

    expect(result).toEqual({ matched: false });
    expect(JSON.stringify(result)).not.toContain("wrong-submission");
    expect(Object.keys(result)).toEqual(["matched"]);
  });
});
