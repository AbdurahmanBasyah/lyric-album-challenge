import { describe, expect, it } from "vitest";

import type { FourLineLyricWindow } from "@/types/game";

import { normalizeLyricWord, tokenizeLyricLine, tokenizeLyricWindow } from "./tokenize";

function makeWindow(texts: readonly string[]): FourLineLyricWindow {
  if (texts.length !== 4) {
    throw new Error("A test lyric window must contain exactly four lines");
  }

  return texts.map((text, index) => ({ timestampMs: 1_000 + index * 500, text })) as FourLineLyricWindow;
}

describe("normalizeLyricWord", () => {
  it("normalizes compatibility characters, case, curly apostrophes, and whitespace", () => {
    expect(normalizeLyricWord("  Ｗｅ’Ｒｅ  ")).toBe("we're");
    expect(normalizeLyricWord("L’enfant")).toBe("l'enfant");
  });

  it("does not remove internal lexical characters or punctuation", () => {
    expect(normalizeLyricWord("rock'n'roll!")).toBe("rock'n'roll!");
  });
});

describe("tokenizeLyricLine", () => {
  it("reconstructs every line exactly from raw token values", () => {
    const text = "  We’re  here\t— now... 🪩  ";
    const tokens = tokenizeLyricLine(text, 2);

    expect(tokens.map((token) => token.raw).join("")).toBe(text);
  });

  it("preserves punctuation, hyphens, repeated whitespace, and tabs as static segments", () => {
    const tokens = tokenizeLyricLine("well-being,\tready", 0);

    expect(tokens.map((token) => [token.raw, token.isWord])).toEqual([
      ["well", true],
      ["-", false],
      ["being", true],
      [",\t", false],
      ["ready", true],
    ]);
  });

  it("keeps leading and trailing whitespace losslessly", () => {
    const tokens = tokenizeLyricLine("  quiet  ", 0);

    expect(tokens[0]).toMatchObject({ raw: "  ", normalized: "", state: "static", isWord: false });
    expect(tokens.at(-1)).toMatchObject({ raw: "  ", normalized: "", state: "static", isWord: false });
  });

  it("keeps ASCII and curly apostrophe contractions as one answer word", () => {
    const tokens = tokenizeLyricLine("don't we’re l'enfant", 0);
    const words = tokens.filter((token) => token.isWord);

    expect(words.map((token) => [token.raw, token.normalized])).toEqual([
      ["don't", "don't"],
      ["we’re", "we're"],
      ["l'enfant", "l'enfant"],
    ]);
  });

  it("recognizes Unicode letters, combining marks, and numbers as words", () => {
    const tokens = tokenizeLyricLine("café e\u0301lan 42 東京", 0);

    expect(tokens.filter((token) => token.isWord).map((token) => token.normalized)).toEqual([
      "café",
      "élan",
      "42",
      "東京",
    ]);
  });

  it("keeps emoji, symbols, and surrounding punctuation static", () => {
    const tokens = tokenizeLyricLine("(hello) 💫 + world!", 0);
    const staticTokens = tokens.filter((token) => !token.isWord);

    expect(staticTokens.map((token) => token.raw)).toEqual(["(", ") 💫 + ", "!"]);
    expect(staticTokens.every((token) => token.state === "static" && token.normalized === "")).toBe(true);
  });

  it("starts with no tokens for an empty line", () => {
    expect(tokenizeLyricLine("", 3)).toEqual([]);
  });

  it("assigns sequential deterministic IDs to all segments", () => {
    const first = tokenizeLyricLine("echo echo", 1);
    const second = tokenizeLyricLine("echo echo", 1);

    expect(first.map((token) => token.id)).toEqual(["l1t0", "l1t1", "l1t2"]);
    expect(first.map((token) => token.id)).toEqual(second.map((token) => token.id));
    expect(new Set(first.map((token) => token.id)).size).toBe(first.length);
    expect(first.filter((token) => token.isWord).map((token) => token.id)).toEqual(["l1t0", "l1t2"]);
  });
});

describe("tokenizeLyricWindow", () => {
  it("preserves four line boundaries, timestamps, and line indexes", () => {
    const window = makeWindow(["first line", "second line", "third line", "fourth line"]);
    const tokenized = tokenizeLyricWindow(window);

    expect(tokenized).toHaveLength(4);
    expect(tokenized.map((line) => line.lineIndex)).toEqual([0, 1, 2, 3]);
    expect(tokenized.map((line) => line.timestampMs)).toEqual([1_000, 1_500, 2_000, 2_500]);
    expect(tokenized.map((line) => line.tokens.map((token) => token.raw).join(""))).toEqual(
      window.map((line) => line.text),
    );
  });

  it("does not mutate source line objects or text", () => {
    const window = makeWindow(["one", "two", "three", "four"]);
    const original = window.map((line) => ({ ...line }));

    tokenizeLyricWindow(window);

    expect(window).toEqual(original);
    expect(window[0]).toBe(window[0]);
  });

  it("keeps word states separate from static states", () => {
    const tokenized = tokenizeLyricWindow(makeWindow(["one, two", "", "three", "four"]));
    const tokens = tokenized.flatMap((line) => line.tokens);

    expect(tokens.filter((token) => token.isWord).every((token) => token.state === "hidden")).toBe(true);
    expect(tokens.filter((token) => !token.isWord).every((token) => token.state === "static")).toBe(true);
  });
});
