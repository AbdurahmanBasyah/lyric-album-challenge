import { describe, expect, it } from "vitest";

import type {
  AttemptNumber,
  FourLineLyricWindow,
  LyricToken,
  TokenizedLyricWindow,
} from "@/types/game";

import { parseLrc } from "./lrc";
import { applyRevealForAttempt, getRevealTargetCount } from "./mask";
import { applyGuess } from "./progress";
import { seededTake } from "./seeded-random";
import { tokenizeLyricWindow } from "./tokenize";
import { generateFourLineWindows } from "./lyric-window";
import { evaluateLyricWindowQuality } from "./lyric-window-quality";

const FIXTURE_LRC = `[00:00.00] Silver currents carry quiet stories through midnight skies
[00:04.50] We follow distant signals across the open valley
[00:09.00] Every shadow gathers under patient neon weather
[00:13.50] I remember the promise moving beyond the border
[00:18.00] Tomorrow brings another answer into changing colors
[00:22.50] These restless footsteps find a home inside the echo`;

const ATTEMPTS: readonly AttemptNumber[] = [1, 2, 3, 4];
const PIPELINE_SEED = "eng-07-fixed-seed";

type PipelineResult = Readonly<{
  parsedLines: ReturnType<typeof parseLrc>;
  windows: FourLineLyricWindow[];
  eligibleWindows: FourLineLyricWindow[];
  sourceWindow: FourLineLyricWindow;
  tokenizedWindow: TokenizedLyricWindow;
  attempts: TokenizedLyricWindow[];
}>;

function wordTokens(window: TokenizedLyricWindow): LyricToken[] {
  return window.flatMap((line) => line.tokens.filter((token) => token.isWord));
}

function revealedWordCount(window: TokenizedLyricWindow): number {
  return wordTokens(window).filter((token) => token.state === "revealed").length;
}

function visibleWordCount(window: TokenizedLyricWindow): number {
  return wordTokens(window).filter((token) => token.state !== "hidden").length;
}

function hiddenWordTokens(window: TokenizedLyricWindow): LyricToken[] {
  return wordTokens(window).filter((token) => token.state === "hidden");
}

function tokenIds(window: TokenizedLyricWindow): string[] {
  return window.flatMap((line) => line.tokens.map((token) => token.id));
}

function lineTexts(window: FourLineLyricWindow): string[] {
  return window.map((line) => line.text);
}

function buildPipeline(seed: string): PipelineResult {
  const parsedLines = parseLrc(FIXTURE_LRC);
  const windows = generateFourLineWindows(parsedLines);
  const eligibleWindows = windows.filter(
    (window) => evaluateLyricWindowQuality(window).eligible,
  );
  const [sourceWindow] = seededTake(eligibleWindows, 1, seed);

  if (sourceWindow === undefined) {
    throw new Error("The synthetic fixture must produce an eligible lyric window");
  }

  const tokenizedWindow = tokenizeLyricWindow(sourceWindow);
  const attempts: TokenizedLyricWindow[] = [];
  let current = tokenizedWindow;

  for (const attempt of ATTEMPTS) {
    current = applyRevealForAttempt(current, attempt, seed);
    attempts.push(current);
  }

  return {
    parsedLines,
    windows,
    eligibleWindows,
    sourceWindow,
    tokenizedWindow,
    attempts,
  };
}

describe("pure game engine integration pipeline", () => {
  it("parses the fixture and creates the expected four-line sliding windows", () => {
    const pipeline = buildPipeline(PIPELINE_SEED);

    expect(pipeline.parsedLines).toHaveLength(6);
    expect(pipeline.parsedLines.map((line) => line.timestampMs)).toEqual([
      0,
      4_500,
      9_000,
      13_500,
      18_000,
      22_500,
    ]);
    expect(pipeline.windows).toHaveLength(3);
    expect(pipeline.windows.map(lineTexts)).toEqual([
      [
        "Silver currents carry quiet stories through midnight skies",
        "We follow distant signals across the open valley",
        "Every shadow gathers under patient neon weather",
        "I remember the promise moving beyond the border",
      ],
      [
        "We follow distant signals across the open valley",
        "Every shadow gathers under patient neon weather",
        "I remember the promise moving beyond the border",
        "Tomorrow brings another answer into changing colors",
      ],
      [
        "Every shadow gathers under patient neon weather",
        "I remember the promise moving beyond the border",
        "Tomorrow brings another answer into changing colors",
        "These restless footsteps find a home inside the echo",
      ],
    ]);
    expect(pipeline.eligibleWindows).toHaveLength(3);
  });

  it("keeps source selection, token IDs, and reveal states deterministic", () => {
    const first = buildPipeline(PIPELINE_SEED);
    const second = buildPipeline(PIPELINE_SEED);
    const totalWordCount = wordTokens(first.tokenizedWindow).length;
    const expectedRevealCounts = ATTEMPTS.map((attempt) =>
      getRevealTargetCount(totalWordCount, attempt),
    );
    const actualRevealCounts = first.attempts.map(revealedWordCount);

    expect(first.sourceWindow).toEqual(second.sourceWindow);
    expect(tokenIds(first.tokenizedWindow)).toEqual(tokenIds(second.tokenizedWindow));
    expect(first.attempts).toEqual(second.attempts);
    expect(actualRevealCounts).toEqual(expectedRevealCounts);
    expect(actualRevealCounts.every((count, index) => index === 0 || count >= actualRevealCounts[index - 1])).toBe(
      true,
    );
    expect(first.attempts[3]).toEqual(second.attempts[3]);
    expect(hiddenWordTokens(first.attempts[3]).length).toBeGreaterThan(0);
    expect(
      first.attempts.every((attempt) =>
        attempt.flatMap((line) => line.tokens).every((token) =>
          token.isWord ? token.state !== "static" : token.state === "static",
        ),
      ),
    ).toBe(true);
  });

  it("locks a correct hidden answer while later reveals remain cumulative", () => {
    const pipeline = buildPipeline(PIPELINE_SEED);
    const attemptOne = pipeline.attempts[0];
    const target = hiddenWordTokens(attemptOne)[0];

    if (target === undefined) {
      throw new Error("Attempt 1 must contain at least one hidden answer token");
    }

    const originalAttemptOne = structuredClone(attemptOne);
    const answers = { [target.id]: target.raw.toUpperCase() };
    const guess = applyGuess(attemptOne, answers);

    expect(attemptOne).toEqual(originalAttemptOne);
    expect(answers).toEqual({ [target.id]: target.raw.toUpperCase() });
    expect(guess.newlySolvedTokenIds).toEqual([target.id]);
    expect(guess.incorrectTokenIds).toEqual([]);
    expect(guess.window.flatMap((line) => line.tokens).find((token) => token.id === target.id)).toMatchObject({
      id: target.id,
      raw: target.raw,
      normalized: target.normalized,
      state: "solved",
    });

    const changedTokenIds = guess.window
      .flatMap((line, lineIndex) =>
        line.tokens
          .map((token, tokenIndex) => ({ token, lineIndex, tokenIndex }))
          .filter(({ token, lineIndex, tokenIndex }) => {
            const previous = attemptOne[lineIndex].tokens[tokenIndex];
            return token.state !== previous.state;
          }),
      )
      .map(({ token }) => token.id);
    expect(changedTokenIds).toEqual([target.id]);

    const progressed: TokenizedLyricWindow[] = [guess.window];
    let current = guess.window;
    for (const attempt of ATTEMPTS.slice(1)) {
      current = applyRevealForAttempt(current, attempt, PIPELINE_SEED);
      progressed.push(current);
    }

    const visibleCounts = progressed.map(visibleWordCount);
    expect(visibleCounts.every((count, index) => index === 0 || count >= visibleCounts[index - 1])).toBe(
      true,
    );
    expect(
      progressed.every((window) =>
        wordTokens(window).some((token) => token.id === target.id && token.state === "solved"),
      ),
    ).toBe(true);
    expect(hiddenWordTokens(progressed[3]).length).toBeGreaterThan(0);
  });
});
