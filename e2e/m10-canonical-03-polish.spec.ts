import { mkdirSync, unlinkSync } from "node:fs";

import { expect, test, type Page, type Route } from "@playwright/test";

const challengeId = "challenge_m10_polish_01";
const questionId = "question_m10_polish_01";
const artifactDirectory = "artifacts/M10-CANONICAL-03-POLISH-01";

const syntheticLines = [
  ["I", "walk", "to", "a", "dawn"],
  ["we", "go", "past", "blue", "lights"],
  ["quiet", "steps", "cross", "open", "water"],
  ["small", "signals", "guide", "home", "tonight"],
] as const;

const hiddenWords = [
  { lineIndex: 0, wordIndex: 0, value: "I" },
  { lineIndex: 0, wordIndex: 2, value: "to" },
  { lineIndex: 0, wordIndex: 3, value: "a" },
  { lineIndex: 1, wordIndex: 0, value: "we" },
  { lineIndex: 1, wordIndex: 1, value: "go" },
] as const;

const hiddenIds = new Set(
  hiddenWords.map(({ lineIndex, wordIndex }) => `polish_l${lineIndex}_w${wordIndex}`),
);

const revealLines = [
  "I walk to a dawn",
  "we go past blue lights",
  "quiet steps cross open water",
  "small signals guide home tonight",
] as const;

function token(id: string, text: string, state: "hidden" | "static") {
  return { id, text, state };
}

function questionView() {
  const lines = syntheticLines.map((line, lineIndex) => {
    const tokens: Array<ReturnType<typeof token>> = [];

    line.forEach((value, wordIndex) => {
      const id = `polish_l${lineIndex}_w${wordIndex}`;
      tokens.push(
        token(
          id,
          hiddenIds.has(id) ? "_".repeat(value.length) : value,
          hiddenIds.has(id) ? "hidden" : "static",
        ),
      );
      if (wordIndex < line.length - 1) {
        tokens.push(token(`${id}_space`, " ", "static"));
      }
    });

    return { timestampMs: lineIndex * 2_000, tokens };
  });

  return {
    id: questionId,
    attempt: 1 as const,
    maxAttempts: 4 as const,
    status: "active" as const,
    lines,
    hiddenTokenIds: [...hiddenIds],
    progress: {
      solved: 0,
      revealed: 0,
      totalAnswerTokens: hiddenWords.length,
    },
  };
}

function challengeView() {
  return {
    id: challengeId,
    seed: "m10-polish-01-synthetic-seed",
    source: {
      kind: "public-playlist" as const,
      spotifyId: "m10_polish_01_fixture",
      canonicalUrl: "https://open.spotify.com/playlist/m10_polish_01_fixture",
      displayName: "Synthetic Short Word Sessions",
    },
    questions: [questionView()],
    questionCount: 1,
    completedQuestionCount: 0,
    complete: false,
  };
}

async function fulfillJson(route: Route, payload: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: { "Cache-Control": "no-store" },
    body: JSON.stringify(payload),
  });
}

async function captureArtifact(page: Page, filename: string) {
  const artifactPath = `${artifactDirectory}/${filename}`;
  mkdirSync(artifactDirectory, { recursive: true });
  try {
    unlinkSync(artifactPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  await page.screenshot({
    path: artifactPath,
    fullPage: true,
    caret: "initial",
    style: "nextjs-portal { display: none !important; }",
  });
}

async function expectNoHorizontalOverflow(page: Page, width: number) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      ),
    )
    .toBeLessThanOrEqual(width);
}

async function expectDraftFits(page: Page, label: string, value: string) {
  const input = page.getByRole("textbox", { name: label });
  await input.fill(value);
  await expect(input).toHaveValue(value);

  const metrics = await input.evaluate((element) => {
    const inputElement = element as HTMLInputElement;
    const style = getComputedStyle(inputElement);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (context === null) {
      throw new Error("Canvas text measurement is unavailable.");
    }

    context.font = style.font;
    const textWidth = context.measureText(inputElement.value).width;
    const innerWidth =
      inputElement.clientWidth -
      Number.parseFloat(style.paddingLeft) -
      Number.parseFloat(style.paddingRight) -
      Number.parseFloat(style.borderLeftWidth) -
      Number.parseFloat(style.borderRightWidth);

    return {
      value: inputElement.value,
      textWidth,
      innerWidth,
      clientWidth: inputElement.clientWidth,
      scrollWidth: inputElement.scrollWidth,
      boxSizing: style.boxSizing,
      lineHeight: style.lineHeight,
      textAlign: style.textAlign,
    };
  });

  expect(metrics.value).toBe(value);
  expect(metrics.textWidth).toBeLessThanOrEqual(metrics.innerWidth + 0.5);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
  expect(metrics.boxSizing).toBe("border-box");
  expect(metrics.lineHeight).not.toBe("normal");
  expect(metrics.textAlign).toBe("center");
}

async function expectSolvedState(page: Page) {
  await expect(page.getByRole("heading", { name: "You got it." })).toBeVisible();
  await expect(page.locator(".ftl-gameplay-feedback")).not.toContainText(/you got it\./iu);
  await expect(page.locator(".ftl-round-complete")).toBeVisible();
}

test("captures short drafts and solved-state microcopy polish", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.route(`**/api/challenges/${challengeId}`, async (route) => {
    await fulfillJson(route, { challenge: challengeView() });
  });

  await page.route(
    `**/api/challenges/${challengeId}/questions/${questionId}/playback/warmup`,
    async (route) => {
      expect(route.request().postDataJSON()).toEqual({});
      await fulfillJson(
        route,
        { warmup: { provider: "youtube", status: "accepted" } },
        202,
      );
    },
  );

  await page.route(
    `**/api/challenges/${challengeId}/questions/${questionId}/guess`,
    async (route) => {
      const body = route.request().postDataJSON() as {
        answers?: Record<string, unknown>;
      };
      expect(Object.keys(body.answers ?? {})).toEqual([...hiddenIds]);
      await fulfillJson(route, {
        result: "solved",
        questionId,
        attemptsUsed: 1,
        progress: {
          solved: hiddenWords.length,
          revealed: 0,
          totalAnswerTokens: hiddenWords.length,
        },
        reveal: {
          lines: revealLines,
          trackName: "Synthetic Short Word Track",
          artistNames: ["Synthetic Fixture"],
          startTimestampMs: 2_000,
        },
        perfect: true,
        streak: 1,
        questionCount: 1,
        completedQuestionCount: 1,
        complete: true,
      });
    },
  );

  await page.route(
    `**/api/challenges/${challengeId}/questions/${questionId}/playback`,
    async (route) => {
      await fulfillJson(route, {
        playback: {
          provider: "youtube",
          status: "unavailable",
          reason: "no-candidate",
        },
      });
    },
  );
  await page.route("https://www.youtube.com/**", (route) => route.abort());

  await page.setViewportSize({ width: 1_440, height: 900 });
  await page.goto(`/play/${challengeId}`);
  await expect(page.getByRole("heading", { name: "FillTheLyrics lyric challenge" })).toBeVisible();
  await expect(page.locator(".ftl-lyric-gap")).toHaveCount(hiddenWords.length);

  await expectDraftFits(page, "Missing word 1 on line 1", "I");
  await expectNoHorizontalOverflow(page, 1_440);
  await captureArtifact(page, "gameplay-short-1-letter-desktop-1440.png");

  await page.getByRole("textbox", { name: "Missing word 1 on line 1" }).fill("");
  await expectDraftFits(page, "Missing word 2 on line 1", "to");
  await expectNoHorizontalOverflow(page, 1_440);
  await captureArtifact(page, "gameplay-short-2-letter-desktop-1440.png");

  await page.setViewportSize({ width: 390, height: 844 });
  await expectDraftFits(page, "Missing word 1 on line 1", "I");
  await expectNoHorizontalOverflow(page, 390);
  await captureArtifact(page, "gameplay-short-1-letter-mobile-390.png");

  await page.getByRole("textbox", { name: "Missing word 1 on line 1" }).fill("");
  await expectDraftFits(page, "Missing word 2 on line 1", "to");
  await expectNoHorizontalOverflow(page, 390);
  await captureArtifact(page, "gameplay-short-2-letter-mobile-390.png");

  for (const [index, word] of hiddenWords.entries()) {
    await page.locator(".ftl-lyric-gap").nth(index).fill(word.value);
  }
  await page.getByRole("button", { name: "Check Words" }).click();
  await expectSolvedState(page);
  await page.waitForTimeout(1_800);
  await expectNoHorizontalOverflow(page, 390);
  await page.setViewportSize({ width: 1_440, height: 900 });
  await expectSolvedState(page);
  await expectNoHorizontalOverflow(page, 1_440);
  await captureArtifact(page, "round-complete-solved-1440.png");

  await page.setViewportSize({ width: 390, height: 844 });
  await expectSolvedState(page);
  await expectNoHorizontalOverflow(page, 390);
  await captureArtifact(page, "round-complete-solved-390.png");

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
