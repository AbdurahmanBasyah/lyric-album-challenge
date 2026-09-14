import { expect, test, type Page, type Route } from "@playwright/test";

const challengeId = "m10_demo_01";
const questionId = "m10_song_01";
const resultsChallengeId = "m10_results_01";

type CelebrationKind = "perfect" | "streak";

const mockModes = new WeakMap<Page, { kind: CelebrationKind; streak: number }>();

function activeChallenge(): Record<string, unknown> {
  return {
    id: challengeId,
    seed: "m10-canonical-04-fixture",
    source: {
      kind: "public-playlist",
      spotifyId: "m10_playlist_01",
      displayName: "Night Drive Sketches",
      canonicalUrl: "https://open.spotify.com/playlist/m10_playlist_01",
    },
    questions: [
      {
        id: questionId,
        attempt: 1,
        maxAttempts: 4,
        status: "active",
        lines: [
          {
            timestampMs: 1000,
            tokens: [
              { id: "m10_01_a", text: "Neon", state: "static" },
              { id: "m10_01_b", text: "____", state: "hidden" },
            ],
          },
          {
            timestampMs: 2000,
            tokens: [
              { id: "m10_02_a", text: "Paper", state: "static" },
              { id: "m10_02_b", text: "____", state: "hidden" },
            ],
          },
          {
            timestampMs: 3000,
            tokens: [
              { id: "m10_03_a", text: "Quiet", state: "static" },
              { id: "m10_03_b", text: "____", state: "hidden" },
            ],
          },
          {
            timestampMs: 4000,
            tokens: [
              { id: "m10_04_a", text: "Small", state: "static" },
              { id: "m10_04_b", text: "____", state: "hidden" },
            ],
          },
        ],
        hiddenTokenIds: [
          "m10_01_b",
          "m10_02_b",
          "m10_03_b",
          "m10_04_b",
        ],
        progress: { solved: 0, revealed: 0, totalAnswerTokens: 4 },
      },
    ],
    questionCount: 1,
    completedQuestionCount: 0,
    complete: false,
  };
}

function resultQuestion(
  id: string,
  attempt: 1 | 2 | 4,
  status: "solved" | "failed",
  trackName: string,
  artistName: string,
): Record<string, unknown> {
  const tokenState = status === "failed" ? "revealed" : "solved";
  const lines = [1, 2, 3, 4].map((line) => ({
    timestampMs: line * 1000,
    tokens: [
      { id: `${id}_${line}_anchor`, text: "Neon", state: "static" },
      {
        id: `${id}_${line}_answer`,
        text: tokenState === "solved" ? "windows" : "windows",
        state: tokenState,
      },
    ],
  }));

  if (status === "failed") {
    const finalLine = lines[3] as {
      timestampMs: number;
      tokens: Array<Record<string, string>>;
    };
    finalLine.tokens[1] = {
      id: `${id}_4_answer`,
      text: "____",
      state: "hidden",
    };
  }

  return {
    id,
    attempt,
    maxAttempts: 4,
    status,
    lines,
    hiddenTokenIds: status === "failed" ? [`${id}_4_answer`] : [],
    progress:
      status === "failed"
        ? { solved: 0, revealed: 3, totalAnswerTokens: 4 }
        : { solved: 4, revealed: 0, totalAnswerTokens: 4 },
    reveal: {
      lines: [
        "Neon windows remember the shape of a melody.",
        "Paper stars keep time with the crowd.",
        "Quiet rooms carry every bright refrain.",
        "Small songs turn the night around.",
      ],
      trackName,
      artistNames: [artistName],
      startTimestampMs: 1000,
    },
  };
}

function completeChallenge(): Record<string, unknown> {
  return {
    id: resultsChallengeId,
    seed: "m10-canonical-04-results",
    source: {
      kind: "public-playlist",
      spotifyId: "m10_playlist_01",
      displayName: "Night Drive Sketches",
      canonicalUrl: "https://open.spotify.com/playlist/m10_playlist_01",
    },
    questions: [
      resultQuestion(
        "m10_result_q1",
        1,
        "solved",
        "Midnight Paper Stars",
        "The Synthetic Hours",
      ),
      resultQuestion(
        "m10_result_q2",
        2,
        "solved",
        "Glass Elevator",
        "The Synthetic Hours",
      ),
      resultQuestion(
        "m10_result_q3",
        4,
        "failed",
        "Static on the Line",
        "The Synthetic Hours",
      ),
    ],
    questionCount: 3,
    completedQuestionCount: 3,
    complete: true,
    // Deliberately return a different order so the client must match by ID
    // while preserving the challenge question order in the editorial list.
    score: {
      total: 72,
      songs: [
        { questionId: "m10_result_q3", score: 28 },
        { questionId: "m10_result_q1", score: 100 },
        { questionId: "m10_result_q2", score: 45 },
      ],
    },
  };
}

function incompleteChallenge(): Record<string, unknown> {
  const { score: _score, ...challenge } = completeChallenge();
  void _score;
  return {
    ...challenge,
    id: "m10_incomplete_01",
    questions: [
      ...(challenge.questions as Array<Record<string, unknown>>).slice(0, 2),
      {
        id: "m10_result_q3",
        attempt: 1,
        maxAttempts: 4,
        status: "active",
        lines: [1, 2, 3, 4].map((line) => ({
          timestampMs: line * 1000,
          tokens: [
            { id: `m10_result_q3_${line}_anchor`, text: "Neon", state: "static" },
            { id: `m10_result_q3_${line}_answer`, text: "____", state: "hidden" },
          ],
        })),
        hiddenTokenIds: [
          "m10_result_q3_1_answer",
          "m10_result_q3_2_answer",
          "m10_result_q3_3_answer",
          "m10_result_q3_4_answer",
        ],
        progress: { solved: 0, revealed: 0, totalAnswerTokens: 4 },
      },
    ],
    questionCount: 3,
    completedQuestionCount: 2,
    complete: false,
  };
}

async function mockResultsApi(page: Page): Promise<void> {
  await page.route("**/api/challenges/**", async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith(`/api/challenges/${resultsChallengeId}`)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ challenge: completeChallenge() }),
      });
      return;
    }

    if (url.pathname.endsWith("/api/challenges/m10_incomplete_01")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ challenge: incompleteChallenge() }),
      });
      return;
    }

    await route.continue();
  });
}

function terminalGuess(kind: CelebrationKind, streak: number): Record<string, unknown> {
  return {
    result: "solved",
    questionId,
    attemptsUsed: kind === "perfect" ? 1 : 2,
    progress: { solved: 4, revealed: 0, totalAnswerTokens: 4 },
    reveal: {
      lines: [
        "Neon windows remember the shape of a melody.",
        "Paper stars keep time with the crowd.",
        "Quiet rooms carry every bright refrain.",
        "Small songs turn the night around.",
      ],
      trackName: "Midnight Paper Stars",
      artistNames: ["The Synthetic Hours"],
      startTimestampMs: 1000,
    },
    perfect: kind === "perfect",
    streak,
    questionCount: 1,
    completedQuestionCount: 1,
    complete: true,
  };
}

async function mockGameApis(
  page: Page,
  kind: CelebrationKind,
  streak: number,
): Promise<void> {
  if (!mockModes.has(page)) {
    await page.route("**/api/challenges/**", async (route: Route) => {
      const mode = mockModes.get(page);
      if (mode === undefined) {
        await route.continue();
        return;
      }
      const url = route.request().url();

      if (url.endsWith("/warmup")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ warmup: { provider: "youtube", status: "accepted" } }),
        });
        return;
      }

      if (url.endsWith("/guess")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(terminalGuess(mode.kind, mode.streak)),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ challenge: activeChallenge() }),
      });
    });
  }

  mockModes.set(page, { kind, streak });
}

async function captureCelebration(
  page: Page,
  kind: CelebrationKind,
  streak: number,
  path: string,
): Promise<void> {
  await mockGameApis(page, kind, streak);
  await page.goto(`/play/${challengeId}`);
  await expect(page.getByRole("button", { name: "Check Words" })).toBeVisible();
  await page.getByRole("button", { name: "Check Words" }).click();
  await expect(page.locator(`[data-celebration-kind="${kind}"]`)).toBeVisible();
  await page.screenshot({ path, fullPage: true });
}

test.describe("M10-CANONICAL-04 Phase A celebrations", () => {
  test("captures Perfect and Streak overlays with the explicit terminal sequence", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await captureCelebration(
      page,
      "perfect",
      1,
      "artifacts/M10-CANONICAL-04/perfect-overlay-1440.png",
    );

    await captureCelebration(
      page,
      "streak",
      2,
      "artifacts/M10-CANONICAL-04/streak-2-overlay-1440.png",
    );

    await captureCelebration(
      page,
      "streak",
      3,
      "artifacts/M10-CANONICAL-04/streak-3-overlay-1440.png",
    );
  });

  test("keeps the overlay readable at mobile width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await captureCelebration(
      page,
      "perfect",
      1,
      "artifacts/M10-CANONICAL-04/perfect-overlay-390.png",
    );
    await captureCelebration(
      page,
      "streak",
      3,
      "artifacts/M10-CANONICAL-04/streak-overlay-390.png",
    );
  });
});

test.describe("M10-CANONICAL-04 Phase B editorial results", () => {
  test("renders authoritative score metrics, ordered tracks, and supported actions", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await mockResultsApi(page);
    await page.goto(`/results/${resultsChallengeId}`);

    await expect(page.getByText("FINAL RESULTS", { exact: true })).toBeVisible();
    await expect(page.locator(".ftl-results-score")).toContainText("72");
    await expect(page.locator(".ftl-results-score__scale")).toHaveText("/ 100");
    await expect(page.getByText("2 / 3", { exact: true })).toBeVisible();
    await expect(page.locator(".ftl-results-metrics")).toContainText("Perfect");
    await expect(page.locator(".ftl-results-metrics")).toContainText("Best streak");

    const tracks = page.locator(".ftl-results-track");
    await expect(tracks).toHaveCount(3);
    await expect(tracks.nth(0)).toContainText("Midnight Paper Stars");
    await expect(tracks.nth(0)).toContainText("100");
    await expect(tracks.nth(1)).toContainText("Glass Elevator");
    await expect(tracks.nth(1)).toContainText("45");
    await expect(tracks.nth(2)).toContainText("Static on the Line");
    await expect(tracks.nth(2)).toContainText("FAILED");
    await expect(tracks.nth(2)).toContainText("28");
    await expect(page.locator(".ftl-results-track__perfect")).toHaveCount(1);
    await expect(tracks.nth(0).locator(".ftl-results-track__perfect")).toBeVisible();

    await expect(page.getByRole("link", { name: "Play Again" })).toHaveAttribute(
      "href",
      /\/play\?kind=public-playlist&spotifyId=m10_playlist_01&displayName=Night\+Drive\+Sketches&canonicalUrl=/,
    );
    await expect(page.getByRole("link", { name: "Use Another Playlist" })).toHaveAttribute(
      "href",
      "/",
    );

    await page.screenshot({
      path: "artifacts/M10-CANONICAL-04/final-results-1440.png",
      fullPage: true,
    });
  });

  test("stacks the complete result and keeps actions reachable on mobile", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockResultsApi(page);
    await page.goto(`/results/${resultsChallengeId}`);

    await expect(page.getByText("FINAL RESULTS", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Play Again" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Use Another Playlist" })).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.innerWidth);

    await page.screenshot({
      path: "artifacts/M10-CANONICAL-04/final-results-390.png",
      fullPage: true,
    });
  });

  test("keeps incomplete recovery views score-free", async ({ page }) => {
    await mockResultsApi(page);
    await page.goto("/results/m10_incomplete_01");

    await expect(page.getByText("No score yet", { exact: false })).toBeVisible();
    await expect(page.locator(".ftl-results-score--pending")).toBeVisible();
    await expect(page.getByRole("link", { name: "Continue challenge" })).toHaveAttribute(
      "href",
      "/play/m10_incomplete_01",
    );
    await expect(page.locator(".ftl-results-track")).toHaveCount(3);
    await expect(page.locator(".ftl-results-track").nth(2)).toContainText("IN PROGRESS");
  });
});

test.describe("M10-CANONICAL-04 Phase C Motion Lab", () => {
  test("renders the repeatable synthetic motion benchmark", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/dev/motion");

    await expect(page.getByText("Motion Lab prototype", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Motion you can feel." })).toBeVisible();
    for (const label of [
      "Correct Word",
      "Incorrect Word",
      "System Hint Reveal",
      "Expert -> Hard",
      "Hard -> Medium",
      "Medium -> Easy",
      "PERFECT",
      "STREAK x2",
      "STREAK x3",
      "Round Complete Solved",
      "Round Complete Failed",
      "Next Song transition",
      "Reduced Motion Preview",
    ]) {
      await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
    }

    await page.screenshot({
      path: "artifacts/M10-CANONICAL-04/motion-lab-1440.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "STREAK x3" }).click();
    await expect(page.locator('[data-celebration-kind="streak"]')).toBeVisible();
  });

  test("honors reduced motion in the browser and keeps celebration readable", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/dev/motion");

    await expect(page.locator(".ftl-motion-lab-page")).toHaveAttribute(
      "data-motion-reduced",
      "true",
    );
    await page.getByRole("button", { name: "PERFECT" }).click();
    const celebration = page.locator('[data-celebration-kind="perfect"]');
    await expect(celebration).toBeVisible();
    await expect(celebration).toHaveClass(/ftl-celebration-layer--reduced/);
    await expect(celebration.locator(".ftl-celebration-bloom")).toHaveCSS(
      "animation-name",
      "none",
    );
    await expect(celebration.locator(".sr-only")).toHaveText(
      "Perfect. Solved on Expert.",
    );
  });

  test("keeps canonical surfaces inside the viewport without browser errors", async ({
    page,
  }) => {
    const browserErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        browserErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    await mockResultsApi(page);

    for (const width of [390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/results/${resultsChallengeId}`);
      const resultDimensions = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(resultDimensions.scrollWidth, `results overflow at ${width}px`).toBeLessThanOrEqual(
        resultDimensions.innerWidth,
      );

      await page.goto("/dev/motion");
      const labDimensions = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(labDimensions.scrollWidth, `motion lab overflow at ${width}px`).toBeLessThanOrEqual(
        labDimensions.innerWidth,
      );
    }

    expect(browserErrors).toEqual([]);
  });
});
