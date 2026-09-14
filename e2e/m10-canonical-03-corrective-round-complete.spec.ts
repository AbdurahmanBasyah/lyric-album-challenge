import { mkdirSync, unlinkSync } from "node:fs";

import { expect, test, type Page, type Route } from "@playwright/test";

const artifactDirectory = "artifacts/M10-CANONICAL-03-CORRECTIVE";
const playlistUrl = "https://open.spotify.com/playlist/m10_round_fixture";

const scenarios = {
  solved: {
    challengeId: "challenge_m10_round_solved",
    questionId: "question_m10_round_solved",
  },
  failed: {
    challengeId: "challenge_m10_round_failed",
    questionId: "question_m10_round_failed",
  },
  pending: {
    challengeId: "challenge_m10_round_pending",
    questionId: "question_m10_round_pending",
  },
} as const;

type Scenario = keyof typeof scenarios;

const syntheticLines = [
  ["violet", "lanterns", "cross", "quiet", "water"],
  ["paper", "windows", "hold", "distant", "signals"],
  ["silver", "engines", "hum", "beneath", "clouds"],
  ["morning", "colors", "turn", "toward", "home"],
] as const;

const words = syntheticLines.flatMap((line, lineIndex) =>
  line.map((value, wordIndex) => ({
    id: `lyric_round_l${lineIndex}_w${wordIndex}`,
    value,
    lineIndex,
    wordIndex,
  })),
);

const revealLines = [
  "Violet lanterns cross quiet water",
  "Paper windows hold distant signals",
  "Silver engines hum beneath clouds",
  "Morning colors turn toward home",
] as const;

function token(id: string, text: string, state: "hidden" | "static") {
  return { id, text, state };
}

function questionView(
  questionId: string,
  attempt: 1 | 2 | 3 | 4,
) {
  const lines = syntheticLines.map((line, lineIndex) => {
    const tokens: ReturnType<typeof token>[] = [];

    line.forEach((value, wordIndex) => {
      const id = `lyric_round_l${lineIndex}_w${wordIndex}`;
      tokens.push(token(id, "_".repeat(value.length), "hidden"));
      if (wordIndex < line.length - 1) {
        tokens.push(token(`${id}_space`, " ", "static"));
      }
    });

    return { timestampMs: lineIndex * 2_000, tokens };
  });
  const hiddenTokenIds = words.map((word) => word.id);

  return {
    id: questionId,
    attempt,
    maxAttempts: 4,
    status: "active" as const,
    ...(attempt === 4 ? { titleHint: "Lantern Drift" } : {}),
    lines,
    hiddenTokenIds,
    progress: {
      solved: 0,
      revealed: 0,
      totalAnswerTokens: words.length,
    },
  };
}

function challengeView(challengeId: string, questionId: string, attempt: 1 | 2 | 3 | 4 = 1) {
  return {
    id: challengeId,
    seed: "m10-round-synthetic-seed",
    source: {
      kind: "public-playlist" as const,
      spotifyId: "m10_round_fixture",
      displayName: "Synthetic round fixture",
      canonicalUrl: playlistUrl,
    },
    questions: [questionView(questionId, attempt)],
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
    caret: "hide",
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

async function installScenario(
  page: Page,
  scenario: Scenario,
  playbackMode: "available" | "unavailable" | "pending",
) {
  const { challengeId, questionId } = scenarios[scenario];
  let guessCount = 0;
  let warmupCount = 0;
  let releasePlayback!: () => void;
  const playbackGate = new Promise<void>((resolve) => {
    releasePlayback = resolve;
  });

  await page.route(`**/api/challenges/${challengeId}`, async (route) => {
    const attempt = scenario === "failed" && guessCount > 0
      ? Math.min(guessCount + 1, 4) as 1 | 2 | 3 | 4
      : 1;
    await fulfillJson(route, {
      challenge: challengeView(challengeId, questionId, attempt),
    });
  });

  await page.route(
    `**/api/challenges/${challengeId}/questions/${questionId}/playback/warmup`,
    async (route) => {
      warmupCount += 1;
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
      const body = route.request().postDataJSON() as { answers?: Record<string, unknown> };
      expect(Object.keys(body.answers ?? {}).every((id) => id.startsWith("lyric_round_"))).toBe(true);
      guessCount += 1;

      if (scenario === "failed" && guessCount < 4) {
        const attempt = (guessCount + 1) as 2 | 3 | 4;
        await fulfillJson(route, {
          result: "continue",
          questionId,
          attempt,
          maxAttempts: 4,
          status: "active",
          ...(attempt === 4 ? { titleHint: "Lantern Drift" } : {}),
          progress: { solved: 0, revealed: 0, totalAnswerTokens: words.length },
          lines: questionView(questionId, attempt).lines,
          hiddenTokenIds: words.map((word) => word.id),
          questionCount: 1,
          completedQuestionCount: 0,
          complete: false,
        });
        return;
      }

      await fulfillJson(route, {
        result: scenario === "failed" ? "failed" : "solved",
        questionId,
        attemptsUsed: scenario === "failed" ? 4 : 1,
        progress: {
          solved: scenario === "failed" ? 0 : words.length,
          revealed: 0,
          totalAnswerTokens: words.length,
        },
        reveal: {
          lines: revealLines,
          trackName: "Lantern Drift",
          artistNames: ["Quiet Signals"],
          startTimestampMs: 10_000,
        },
        perfect: scenario !== "failed",
        streak: scenario === "failed" ? 0 : 1,
        questionCount: 1,
        completedQuestionCount: 1,
        complete: true,
      });
    },
  );

  await page.route(
    `**/api/challenges/${challengeId}/questions/${questionId}/playback`,
    async (route) => {
      if (playbackMode === "pending") {
        await playbackGate;
      }

      await fulfillJson(route, {
        playback:
          playbackMode === "available" || playbackMode === "pending"
            ? {
                provider: "youtube",
                status: "available",
                videoId: "AbCdEfGhIjK",
                startAtMs: 8_500,
              }
            : {
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
  await expect(
    page.getByRole("heading", { name: "FillTheLyrics lyric challenge" }),
  ).toBeVisible();
  await expect(page.locator(".ftl-lyric-gap")).toHaveCount(words.length);
  await expect(page.locator(".ftl-gameplay-lyric-line")).toHaveCount(4);

  if (scenario === "failed") {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await page.getByRole("button", { name: "Check Words" }).click();
      if (attempt < 3) {
        await expect(page.getByText(`Attempt ${attempt + 2} / 4`)).toBeVisible();
      }
    }
  } else {
    const gaps = page.locator(".ftl-lyric-gap");
    for (const [index, word] of words.entries()) {
      await gaps.nth(index).fill(word.value);
    }
    await page.getByRole("button", { name: "Check Words" }).click();
  }

  await expect(page.locator(".ftl-round-complete")).toBeVisible();
  expect(warmupCount).toBe(1);

  return {
    challengeId,
    questionId,
    releasePlayback,
    getGuessCount: () => guessCount,
  };
}

test("captures solved Round Complete beside ready media", async ({ page }) => {
  await installScenario(page, "solved", "available");
  await page.waitForTimeout(1_800);
  await expect(page.getByRole("heading", { name: "You got it." })).toBeVisible();
  await expect(page.getByText("Lantern Drift", { exact: true })).toBeVisible();
  await expect(page.getByText("Violet lanterns cross quiet water", { exact: true })).toBeVisible();
  await expect(page.locator('[data-playback-status="available"], [data-playback-status="manual"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Reload YouTube player/i })).toHaveCount(0);

  const layout = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>(".ftl-round-complete__content")?.getBoundingClientRect();
    const media = document.querySelector<HTMLElement>(".ftl-round-complete__media")?.getBoundingClientRect();
    return content && media
      ? { contentX: content.x, mediaX: media.x, contentWidth: content.width, mediaWidth: media.width }
      : null;
  });
  expect(layout).not.toBeNull();
  expect(layout?.mediaX).toBeGreaterThan(layout?.contentX ?? 0);
  const total = (layout?.contentWidth ?? 0) + (layout?.mediaWidth ?? 0);
  expect((layout?.contentWidth ?? 0) / total).toBeGreaterThan(0.5);
  expect((layout?.contentWidth ?? 0) / total).toBeLessThan(0.62);
  await expectNoHorizontalOverflow(page, 1_440);
  await captureArtifact(page, "round-complete-solved-1440.png");

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page, 390);
  const mobileLayout = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>(".ftl-round-complete__content")?.getBoundingClientRect();
    const media = document.querySelector<HTMLElement>(".ftl-round-complete__media")?.getBoundingClientRect();
    const actions = document.querySelector<HTMLElement>(".ftl-round-complete__actions")?.getBoundingClientRect();
    return content && media && actions
      ? { contentBottom: content.bottom, mediaTop: media.top, mediaBottom: media.bottom, actionsTop: actions.top }
      : null;
  });
  expect(mobileLayout?.mediaTop).toBeGreaterThan(mobileLayout?.contentBottom ?? 0);
  expect(mobileLayout?.actionsTop).toBeGreaterThan(mobileLayout?.mediaBottom ?? 0);
  await expectNoMobileRailTextClipping(page);
  await captureArtifact(page, "round-complete-mobile-390.png");
});

test("captures failed Round Complete with a restrained no-result state", async ({ page }) => {
  const state = await installScenario(page, "failed", "unavailable");
  await expect(page.getByRole("heading", { name: "Here is the full fragment." })).toBeVisible();
  await expect(page.getByText(/No matching YouTube video is available/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Reload YouTube player/i })).toHaveCount(0);
  expect(state.getGuessCount()).toBe(4);
  await expectNoHorizontalOverflow(page, 1_440);
  await captureArtifact(page, "round-complete-failed-1440.png");
});

test("captures an accessible pending media skeleton before terminal hydration", async ({ page }) => {
  const state = await installScenario(page, "pending", "pending");
  await page.waitForTimeout(1_800);
  await expect(page.getByRole("heading", { name: "You got it." })).toBeVisible();
  await expect(page.locator(".ftl-playback-skeleton")).toBeVisible();
  await expect(page.locator('[data-playback-status="loading"]')).toBeVisible();
  await expect(page.getByRole("button", { name: /Reload YouTube player/i })).toHaveCount(0);
  await expectNoHorizontalOverflow(page, 1_440);
  await captureArtifact(page, "round-complete-pending-1440.png");
  state.releasePlayback();
  await expect(page.locator('[data-playback-status="available"], [data-playback-status="manual"]')).toHaveCount(1);
});
