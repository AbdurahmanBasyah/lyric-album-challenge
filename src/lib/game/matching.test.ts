import { describe, expect, it } from "vitest";

import { compareToken, normalizeAnswer } from "./matching";

describe("normalizeAnswer", () => {
  it("normalizes case, NFKC compatibility characters, curly apostrophes, and whitespace", () => {
    expect(normalizeAnswer("  ＷＥ’ＲＥ\tHERE  ")).toBe("we're here");
  });

  it("preserves meaningful internal punctuation and diacritics", () => {
    expect(normalizeAnswer("  Rock'n'Röll!  ")).toBe("rock'n'röll!");
    expect(normalizeAnswer("café")).toBe("café");
  });

  it("does not use fuzzy matching or remove punctuation", () => {
    expect(normalizeAnswer("well-being")).toBe("well-being");
    expect(compareToken("ask", "asked").matched).toBe(false);
    expect(compareToken("rock'n'roll", "rock n roll").matched).toBe(false);
    expect(compareToken("café", "cafe").matched).toBe(false);
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
  it("matches normalized exact answers case-insensitively", () => {
    expect(compareToken("We're", "  we’re  ")).toEqual({ matched: true });
    expect(compareToken("signal", "SIGNAL")).toEqual({ matched: true });
  });

  it("returns only a match fact and does not echo answer content", () => {
    const result = compareToken("hidden-lyric", "wrong-submission");

    expect(result).toEqual({ matched: false });
    expect(JSON.stringify(result)).not.toContain("wrong-submission");
    expect(Object.keys(result)).toEqual(["matched"]);
  });
});
