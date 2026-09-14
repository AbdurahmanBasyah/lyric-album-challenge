import { mkdirSync, unlinkSync } from "node:fs";

import { expect, test, type Page, type Route } from "@playwright/test";

const challengeId = "challenge_m10_corrective";
const questionId = "question_m10_corrective";
const playlistId = "m10_corrective_fixture";
const playlistUrl = `https://open.spotify.com/playlist/${playlistId}`;
const playlistTitle = "Synthetic Lantern Sessions";
const artifactDirectory = "artifacts/M10-CANONICAL-03-CORRECTIVE";

type TokenState = "hidden" | "solved" | "revealed" | "static";

type SyntheticWord = Readonly<{
  id: string;
  value: string;
  lineIndex: number;
  wordIndex: number;
}>;

const syntheticLines = [
  ["violet", "lanterns", "trace", "silver", "skylines", "above", "quiet", "rivers", "turning", "after", "rain"],
  ["paper", "windows", "carry", "distant", "signals", "through", "midnight", "gardens", "under", "soft", "clouds"],
  ["engines", "hum", "beneath", "electric", "clouds", "while", "memory", "gathers", "old", "promises", "slowly"],
  ["silver", "footsteps", "cross", "the", "station", "distant", "echoes", "return", "before", "early", "sunrise"],
] as const;

const words: readonly SyntheticWord[] = syntheticLines.flatMap((line, lineIndex) =>
  line.map((value, wordIndex) => ({
    id: `lyric_l${lineIndex}_w${wordIndex}`,
    value,
    lineIndex,
    wordIndex,
  })),
);

// The fixture is deliberately arranged so the canonical reveal order starts
// with one word from each semantic line, then a second from each line, before
// distributing the remaining words. This mirrors the pure mask fairness rule.
const revealOrder = [
  0, 11, 22, 33,
  1, 12, 23, 34,
  2, 13, 24, 35,
  3, 14, 25, 36,
  4, 15, 26, 37,
  5, 16, 27, 38,
  6, 17, 28, 39,
  7, 18, 29, 40,
  8, 19, 30, 41,
  9, 20, 31, 42,
  10, 21, 32, 43,
] as const;

const visibleCounts = { 1: 18, 2: 24, 3: 31, 4: 35 } as const;

function token(id: string, text: string, state: TokenState) {
  return { id, text, state };
}

function makeLine(lineIndex: number, visibleIds: ReadonlySet<string>, solvedIds: ReadonlySet<string>) {
  const lineWords = words.filter((word) => word.lineIndex === lineIndex);
  const tokens: ReturnType<typeof token>[] = [];

  lineWords.forEach((word, index) => {
    const state: TokenState = solvedIds.has(word.id)
      ? "solved"
      : visibleIds.has(word.id)
        ? "revealed"
        : "hidden";
    tokens.push(token(word.id, state === "hidden" ? "_".repeat(Array.from(word.value).length) : word.value, state));
    if (index < lineWords.length - 1) {
      tokens.push(token(`${word.id}_space`, " ", "static"));
    }
  });

  return {
    timestampMs: 1_000 + lineIndex * 2_000,
    tokens,
  };
}

function questionView(
  attempt: 1 | 2 | 3 | 4,
  solvedWordIds: readonly string[] = [],
) {
  const visibleIds = new Set(
    revealOrder.slice(0, visibleCounts[attempt]).map((wordIndex) => words[wordIndex]?.id),
  );
  const solvedIds = new Set(solvedWordIds);
  const lines = [0, 1, 2, 3].map((lineIndex) => makeLine(lineIndex, visibleIds, solvedIds));
  const renderedTokens = lines.flatMap((line) => line.tokens);
  const hiddenTokenIds = renderedTokens
    .filter((renderedToken) => renderedToken.state === "hidden")
    .map((renderedToken) => renderedToken.id);
  const solved = renderedTokens.filter((renderedToken) => renderedToken.state === "solved").length;
  const revealed = renderedTokens.filter((renderedToken) => renderedToken.state === "revealed").length;

  return {
    id: questionId,
    attempt,
    maxAttempts: 4,
    status: "active" as const,
    ...(attempt === 4 ? { titleHint: "Synthetic Lantern Song" } : {}),
    lines,
    hiddenTokenIds,
    progress: {
      solved,
      revealed,
      totalAnswerTokens: words.length,
    },
  };
}

function challengeView(
  attempt: 1 | 2 | 3 | 4,
  solvedWordIds: readonly string[] = [],
) {
  return {
    id: challengeId,
    seed: "m10-corrective-synthetic-seed",
    source: {
      kind: "public-playlist" as const,
      spotifyId: playlistId,
      canonicalUrl: playlistUrl,
      displayName: playlistTitle,
    },
    questions: [questionView(attempt, solvedWordIds)],
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

async function expectNoMobileRailTextClipping(page: Page) {
  const metrics = await page
    .locator(".difficulty-rail-mobile .ftl-difficulty-step__status")
    .evaluateAll((elements) =>
      elements.map((element) => ({
        text: element.textContent?.trim() ?? "",
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      })),
    );

  expect(metrics).toHaveLength(4);
  expect(metrics.every((metric) => metric.text.length > 0)).toBe(true);
  expect(metrics.every((metric) => metric.scrollWidth <= metric.clientWidth)).toBe(true);
}

async function waitForGameplaySettle(page: Page, attempt: 2 | 3 | 4) {
  const form = page.locator(`.ftl-gameplay-form[data-attempt="${attempt}"]`);
  await expect(form).toHaveCount(1);
  await expect
    .poll(() => form.evaluate((element) => Number(getComputedStyle(element).opacity)))
    .toBeGreaterThan(0.98);
}

test("captures fair inline gameplay states at desktop and mobile sizes", async ({ page }) => {
  let currentAttempt: 1 | 2 | 3 | 4 = 1;
  let solvedWordIds: string[] = [];
  let guessCount = 0;
  const terminalPlaybackRequests: string[] = [];
  const warmupRequests: string[] = [];
  const externalRequests = new Set<string>();
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("request", (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.pathname.endsWith("/playback/warmup")) {
      warmupRequests.push(requestUrl.pathname);
    } else if (requestUrl.pathname.endsWith("/playback")) {
      terminalPlaybackRequests.push(requestUrl.pathname);
    }
    if (
      (requestUrl.protocol === "http:" || requestUrl.protocol === "https:") &&
      requestUrl.hostname !== "127.0.0.1" &&
      requestUrl.hostname !== "localhost"
    ) {
      externalRequests.add(requestUrl.origin);
    }
  });

  await page.route("**/api/public-playlists/challenge", async (route) => {
    const body = route.request().postDataJSON() as { url?: unknown };
    expect(body).toEqual({ url: playlistUrl });
    await fulfillJson(route, { challenge: challengeView(1) }, 201);
  });

  await page.route(`**/api/challenges/${challengeId}`, async (route) => {
    await fulfillJson(route, { challenge: challengeView(currentAttempt, solvedWordIds) });
  });

  await page.route(
    `**/api/challenges/${challengeId}/questions/${questionId}/guess`,
    async (route) => {
      const body = route.request().postDataJSON() as { answers?: Record<string, unknown> };
      expect(body).toHaveProperty("answers");
      expect(Object.keys(body.answers ?? {}).every((id) => id.startsWith("lyric_"))).toBe(true);
      guessCount += 1;
      const nextAttempt = Math.min(guessCount + 1, 4) as 2 | 3 | 4;
      const solvedIndex = visibleCounts[currentAttempt];
      const solvedWord = words[revealOrder[solvedIndex] ?? -1];
      solvedWordIds = solvedWord === undefined ? solvedWordIds : [...solvedWordIds, solvedWord.id];
      currentAttempt = nextAttempt;
      const nextQuestion = questionView(nextAttempt, solvedWordIds);
      await fulfillJson(route, {
        result: "continue",
        questionId,
        attempt: nextQuestion.attempt,
        maxAttempts: nextQuestion.maxAttempts,
        status: nextQuestion.status,
        ...(nextQuestion.titleHint === undefined ? {} : { titleHint: nextQuestion.titleHint }),
        progress: nextQuestion.progress,
        lines: nextQuestion.lines,
        hiddenTokenIds: nextQuestion.hiddenTokenIds,
        questionCount: 1,
        completedQuestionCount: 0,
        complete: false,
      });
    },
  );

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

  await page.setViewportSize({ width: 1_440, height: 900 });
  await page.goto("/");
  const playlistInput = page.getByLabel("Public Spotify playlist link");
  await playlistInput.fill(playlistUrl);
  await playlistInput.press("Enter");
  await expect(page).toHaveURL(/\/play\?kind=public-playlist/);
  await expect(page.getByRole("heading", { name: playlistTitle })).toBeVisible();
  await page.getByRole("button", { name: "Start Challenge" }).click();
  await expect(page).toHaveURL(new RegExp(`/play/${challengeId}$`));
  await expect(page.getByRole("heading", { name: "FillTheLyrics lyric challenge" })).toBeVisible();

  const gaps = page.locator(".ftl-lyric-gap");
  await expect(gaps).toHaveCount(26);
  await expect(page.locator(".ftl-gameplay-lyric-line")).toHaveCount(4);
  await expect(page.locator(".ftl-lyric-stage__progress")).toHaveCount(1);
  await expect(page.locator(".ftl-lyric-stage__progress")).toHaveText("0 of 44 solved");
  await expect(gaps.first()).toBeFocused();
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Shared lyric answer" })).toHaveCount(0);
  await expect(page.getByText("Synthetic Lantern Song", { exact: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page, 1_440);
  await captureArtifact(page, "gameplay-expert-1440.png");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(gaps).toHaveCount(26);
  await expectNoMobileRailTextClipping(page);
  await expectNoHorizontalOverflow(page, 390);
  await captureArtifact(page, "gameplay-expert-390.png");

  await page.setViewportSize({ width: 1_440, height: 900 });
  await gaps.nth(0).fill("draft lantern");
  await gaps.nth(1).fill("draft silver");
  await gaps.nth(2).fill("draft river");
  await expect(gaps.nth(0)).toHaveValue("draft lantern");
  await expect(gaps.nth(1)).toHaveValue("draft silver");
  await expect(gaps.nth(2)).toHaveValue("draft river");
  await gaps.nth(0).press("Tab");
  await expect(gaps.nth(1)).toBeFocused();
  await gaps.nth(1).press("Shift+Tab");
  await expect(gaps.nth(0)).toBeFocused();
  await gaps.nth(0).press("Enter");
  await expect(gaps.nth(0)).toBeFocused();
  expect(guessCount).toBe(0);
  await captureArtifact(page, "gameplay-expert-drafts-1440.png");

  const inputLabels = await gaps.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("aria-label")),
  );
  expect(inputLabels.every((label) => label?.startsWith("Missing word "))).toBe(true);
  const placeholders = await gaps.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("placeholder") ?? ""),
  );
  expect(placeholders.every((placeholder) => /^_+$/u.test(placeholder))).toBe(true);

  await page.getByRole("button", { name: "Check Words" }).click();
  await expect(page.getByText("Attempt 2 / 4")).toBeVisible();
  await waitForGameplaySettle(page, 2);
  await expect(page.locator(".ftl-stage-atmosphere--hard")).toBeVisible();
  await expect(page.locator(".ftl-lyric-gap")).toHaveCount(20);
  await expect(page.getByLabel("Player-solved lyric word, solved and locked")).toBeVisible();
  await expect(page.getByLabel("System-revealed lyric word, revealed hint").first()).toBeVisible();
  await expect(page.locator(".ftl-lyric-stage__progress")).toHaveText("1 of 44 solved");
  await expect(page.locator(".ftl-lyric-gap").first()).toBeFocused();
  await expectNoHorizontalOverflow(page, 1_440);
  await captureArtifact(page, "gameplay-hard-1440.png");

  await page.getByRole("textbox").first().fill("synthetic-answer");
  await page.getByRole("button", { name: "Check Words" }).click();
  await expect(page.getByText("Attempt 3 / 4")).toBeVisible();
  await waitForGameplaySettle(page, 3);
  await expect(page.locator(".ftl-stage-atmosphere--medium")).toBeVisible();
  await expect(page.locator(".ftl-lyric-gap")).toHaveCount(13);
  await expect(page.locator(".ftl-lyric-stage__progress")).toHaveText("2 of 44 solved");
  await expect(page.locator(".ftl-lyric-gap").first()).toBeFocused();
  await expectNoHorizontalOverflow(page, 1_440);
  await captureArtifact(page, "gameplay-medium-1440.png");

  await page.getByRole("textbox").first().fill("synthetic-answer");
  await page.getByRole("button", { name: "Check Words" }).click();
  await expect(page.getByText("Attempt 4 / 4")).toBeVisible();
  await waitForGameplaySettle(page, 4);
  await expect(page.locator(".ftl-stage-atmosphere--easy")).toBeVisible();
  await expect(page.getByText("Synthetic Lantern Song", { exact: true })).toBeVisible();
  await expect(page.locator(".ftl-lyric-gap")).toHaveCount(9);
  await expect(page.locator(".ftl-lyric-stage__progress")).toHaveText("3 of 44 solved");
  await expect(page.locator(".ftl-lyric-gap").first()).toBeFocused();
  await expectNoHorizontalOverflow(page, 1_440);
  await captureArtifact(page, "gameplay-easy-1440.png");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("Synthetic Lantern Song", { exact: true })).toBeVisible();
  await expect(page.locator(".ftl-gameplay-lyric-line")).toHaveCount(4);
  await expectNoMobileRailTextClipping(page);
  await expectNoHorizontalOverflow(page, 390);
  await captureArtifact(page, "gameplay-easy-390.png");

  expect(terminalPlaybackRequests).toEqual([]);
  expect(warmupRequests).toHaveLength(1);
  expect(externalRequests).toEqual(new Set());
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
