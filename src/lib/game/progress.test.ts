import { describe, expect, it } from "vitest";

import type {
  FourLineLyricWindow,
  TokenizedLyricWindow,
  TokenState,
} from "@/types/game";

import { tokenizeLyricWindow } from "./tokenize";
import { applyGuess } from "./progress";

function makeWindow(texts: readonly string[]): TokenizedLyricWindow {
  if (texts.length !== 4) {
    throw new Error("A test lyric window must contain exactly four lines");
  }

  const source = texts.map((text, index) => ({
    timestampMs: 1_000 + index * 500,
    text,
  })) as FourLineLyricWindow;

  return tokenizeLyricWindow(source);
}

function allTokens(window: TokenizedLyricWindow) {
  return window.flatMap((line) => line.tokens);
}

function wordTokens(window: TokenizedLyricWindow) {
  return allTokens(window).filter((token) => token.isWord);
}

function setTokenState(
  window: TokenizedLyricWindow,
  tokenId: string,
  state: TokenState,
): TokenizedLyricWindow {
  return window.map((line) => ({
    ...line,
    tokens: line.tokens.map((token) =>
      token.id === tokenId ? { ...token, state } : token,
    ),
  })) as unknown as TokenizedLyricWindow;
}

function freezeWindow(window: TokenizedLyricWindow): TokenizedLyricWindow {
  return Object.freeze(
    window.map((line) =>
      Object.freeze({
        ...line,
        tokens: Object.freeze(line.tokens.map((token) => Object.freeze({ ...token }))),
      }),
    ),
  ) as unknown as TokenizedLyricWindow;
}

describe("applyGuess", () => {
  it("solves one correct hidden word and reports one incorrect word", () => {
    const window = makeWindow([
      "Maybe lost",
      "in the quiet",
      "silver night",
      "again tomorrow",
    ]);

    const result = applyGuess(window, {
      l0t0: "MAYBE",
      l0t2: "wrong",
    });

    expect(result.newlySolvedTokenIds).toEqual(["l0t0"]);
    expect(result.incorrectTokenIds).toEqual(["l0t2"]);
    expect(result.unresolvedTokenIds).toEqual(
      wordTokens(window).slice(1).map((token) => token.id),
    );
    expect(result.window[0].tokens[0]).toMatchObject({ state: "solved" });
    expect(result.window[0].tokens[2]).toMatchObject({ state: "hidden" });
  });

  it("matches by stable token ID regardless of answer object insertion order", () => {
    const window = makeWindow([
      "first second",
      "third fourth",
      "fifth sixth",
      "seventh eighth",
    ]);

    const result = applyGuess(window, {
      l1t0: "third",
      l0t0: "first",
    });

    expect(result.newlySolvedTokenIds).toEqual(["l0t0", "l1t0"]);
    expect(result.incorrectTokenIds).toEqual([]);
    expect(result.unresolvedTokenIds).toEqual(
      wordTokens(window)
        .filter((token) => token.id !== "l0t0" && token.id !== "l1t0")
        .map((token) => token.id),
    );
  });

  it("leaves missing hidden answers unresolved", () => {
    const window = makeWindow(["one two", "three four", "five six", "seven eight"]);
    const result = applyGuess(window, { l0t0: "one" });

    expect(result.newlySolvedTokenIds).toEqual(["l0t0"]);
    expect(result.incorrectTokenIds).toEqual([]);
    expect(result.unresolvedTokenIds).toEqual(
      wordTokens(window).slice(1).map((token) => token.id),
    );
  });

  it("locks solved words across a second guess and rejects targeting them", () => {
    const window = makeWindow(["one two", "three four", "five six", "seven eight"]);
    const first = applyGuess(window, { l0t0: "one" });
    const second = applyGuess(first.window, { l1t0: "THREE" });

    expect(first.window[0].tokens[0]).toMatchObject({ state: "solved" });
    expect(second.newlySolvedTokenIds).toEqual(["l1t0"]);
    expect(second.window[0].tokens[0]).toMatchObject({ state: "solved" });
    expect(() => applyGuess(first.window, { l0t0: "one" })).toThrow(/not a hidden word/i);
  });

  it("keeps revealed and static tokens unchanged and not answerable", () => {
    const base = makeWindow(["(one) two", "three four", "five six", "seven eight"]);
    const revealed = setTokenState(base, "l0t1", "revealed");
    const staticTokenId = revealed[0].tokens.find((token) => !token.isWord)?.id as string;

    expect(() => applyGuess(revealed, { l0t1: "one" })).toThrow(/not a hidden word/i);
    expect(() => applyGuess(revealed, { [staticTokenId]: "anything" })).toThrow(
      /not a hidden word/i,
    );

    const result = applyGuess(revealed, { l0t3: "two" });
    expect(result.window[0].tokens[1]).toMatchObject({ state: "revealed", raw: "one" });
    expect(result.window[0].tokens[2]).toMatchObject({ state: "static", raw: ") " });
  });

  it("rejects unknown, non-word, and non-string answer IDs explicitly", () => {
    const window = makeWindow(["one two", "three four", "five six", "seven eight"]);
    const staticTokenId = window[0].tokens.find((token) => !token.isWord)?.id as string;

    expect(() => applyGuess(window, { missing: "one" })).toThrow(/unknown token ID/i);
    expect(() => applyGuess(window, { [staticTokenId]: " " })).toThrow(/not a hidden word/i);
    expect(() => applyGuess(window, { l0t0: 123 as unknown as string })).toThrow(
      /must be a string/i,
    );
  });

  it("returns source-order IDs and deterministic repeated results", () => {
    const window = makeWindow(["one two", "three four", "five six", "seven eight"]);
    const answers = { l1t2: "wrong", l0t0: "one", l0t2: "wrong" };

    const first = applyGuess(window, answers);
    const second = applyGuess(window, answers);

    expect(first).toEqual(second);
    expect(first.newlySolvedTokenIds).toEqual(["l0t0"]);
    expect(first.incorrectTokenIds).toEqual(["l0t2", "l1t2"]);
    expect(first.unresolvedTokenIds).toEqual(
      wordTokens(window).slice(1).map((token) => token.id),
    );
  });

  it("does not mutate mutable, frozen, or answer inputs", () => {
    const window = makeWindow(["one two", "three four", "five six", "seven eight"]);
    const originalWindow = structuredClone(window);
    const answers = Object.freeze({ l0t0: "one" });
    const result = applyGuess(window, answers);

    expect(window).toEqual(originalWindow);
    expect(answers).toEqual({ l0t0: "one" });
    expect(() => applyGuess(freezeWindow(window), answers)).not.toThrow();
    expect(result.window).not.toBe(window);
  });

  it("does not echo submitted answer text in progress facts", () => {
    const window = makeWindow(["one two", "three four", "five six", "seven eight"]);
    const submittedAnswer = "not-present-in-lyric";
    const result = applyGuess(window, { l0t0: submittedAnswer });

    expect(result.incorrectTokenIds).toEqual(["l0t0"]);
    expect(result).not.toHaveProperty("answers");
    expect(JSON.stringify(result)).not.toContain(submittedAnswer);
  });
});
