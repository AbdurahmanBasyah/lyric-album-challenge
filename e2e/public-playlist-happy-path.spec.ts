import { mkdirSync, unlinkSync } from "node:fs";

import { expect, test, type Page, type Route } from "@playwright/test";

const challengeId = "challenge_m10_1234";
const firstQuestionId = "question_m10_first";
const secondQuestionId = "question_m10_second";
const thirdQuestionId = "question_m10_third";
const playlistUrl = "https://open.spotify.com/playlist/m10_fixture_123";
const longPlaylistTitle = "Songs I Listen To While Driving Home At 2 AM";
const artifactDirectory = "artifacts/M10-CANONICAL-01";

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

type TokenState = "hidden" | "solved" | "revealed" | "static";

function token(id: string, text: string, state: TokenState) {
  return { id, text, state };
}

function line(timestampMs: number, tokens: ReturnType<typeof token>[]) {
  return { timestampMs, tokens };
}

const firstQuestionInitialLines = [
  line(1_000, [
    token("first_l0_static", "Synthetic ", "static"),
    token("first_l0_answer", "_____", "hidden"),
    token("first_l0_end", " words", "static"),
  ]),
  line(2_000, [
    token("first_l1_static", "Keep ", "static"),
    token("first_l1_answer", "____", "hidden"),
    token("first_l1_end", " nearby", "static"),
  ]),
  line(3_000, [
    token("first_l2_static", "A ", "static"),
    token("first_l2_answer", "_____", "hidden"),
    token("first_l2_end", " token", "static"),
  ]),
  line(4_000, [token("first_l3_static", "Four-line fixture", "static")]),
];

const firstQuestionContinueLines = [
  line(1_000, [
    token("first_l0_static", "Synthetic ", "static"),
    token("first_l0_answer", "alpha", "solved"),
    token("first_l0_end", " words", "static"),
  ]),
  line(2_000, [
    token("first_l1_static", "Keep ", "static"),
    token("first_l1_answer", "beta", "revealed"),
    token("first_l1_end", " nearby", "static"),
  ]),
  line(3_000, [
    token("first_l2_static", "A ", "static"),
    token("first_l2_answer", "_____", "hidden"),
    token("first_l2_end", " token", "static"),
  ]),
  line(4_000, [token("first_l3_static", "Four-line fixture", "static")]),
];

const firstQuestionTerminalLines = [
  line(1_000, [
    token("first_l0_static", "Synthetic ", "static"),
    token("first_l0_answer", "alpha", "solved"),
    token("first_l0_end", " words", "static"),
  ]),
  line(2_000, [
    token("first_l1_static", "Keep ", "static"),
    token("first_l1_answer", "beta", "revealed"),
    token("first_l1_end", " nearby", "static"),
  ]),
  line(3_000, [
    token("first_l2_static", "A ", "static"),
    token("first_l2_answer", "gamma", "solved"),
    token("first_l2_end", " token", "static"),
  ]),
  line(4_000, [token("first_l3_static", "Four-line fixture", "static")]),
];

const secondQuestionInitialLines = [
  line(5_000, [
    token("second_l0_static", "Another ", "static"),
    token("second_l0_answer", "_____", "hidden"),
    token("second_l0_end", " fixture", "static"),
  ]),
  line(6_000, [token("second_l1_static", "Second synthetic line", "static")]),
  line(7_000, [token("second_l2_static", "Third synthetic line", "static")]),
  line(8_000, [token("second_l3_static", "Fourth synthetic line", "static")]),
];

const secondQuestionTerminalLines = [
  line(5_000, [
    token("second_l0_static", "Another ", "static"),
    token("second_l0_answer", "delta", "solved"),
    token("second_l0_end", " fixture", "static"),
  ]),
  line(6_000, [token("second_l1_static", "Second synthetic line", "static")]),
  line(7_000, [token("second_l2_static", "Third synthetic line", "static")]),
  line(8_000, [token("second_l3_static", "Fourth synthetic line", "static")]),
];

const thirdQuestionInitialLines = [
  line(9_000, [
    token("third_l0_static", "One more ", "static"),
    token("third_l0_answer", "_______", "hidden"),
    token("third_l0_end", " fixture", "static"),
  ]),
  line(10_000, [token("third_l1_static", "Third synthetic line", "static")]),
  line(11_000, [token("third_l2_static", "A small closing line", "static")]),
  line(12_000, [token("third_l3_static", "Fourth synthetic line", "static")]),
];

const thirdQuestionTerminalLines = [
  line(9_000, [
    token("third_l0_static", "One more ", "static"),
    token("third_l0_answer", "epsilon", "solved"),
    token("third_l0_end", " fixture", "static"),
  ]),
  line(10_000, [token("third_l1_static", "Third synthetic line", "static")]),
  line(11_000, [token("third_l2_static", "A small closing line", "static")]),
  line(12_000, [token("third_l3_static", "Fourth synthetic line", "static")]),
];

const firstQuestionInitial = {
  id: firstQuestionId,
  attempt: 1,
  maxAttempts: 4,
  status: "active",
  lines: firstQuestionInitialLines,
  hiddenTokenIds: ["first_l0_answer", "first_l1_answer", "first_l2_answer"],
  progress: { solved: 0, revealed: 0, totalAnswerTokens: 3 },
};

const secondQuestionInitial = {
  id: secondQuestionId,
  attempt: 1,
  maxAttempts: 4,
  status: "active",
  lines: secondQuestionInitialLines,
  hiddenTokenIds: ["second_l0_answer"],
  progress: { solved: 0, revealed: 0, totalAnswerTokens: 1 },
};

const thirdQuestionInitial = {
  id: thirdQuestionId,
  attempt: 1,
  maxAttempts: 4,
  status: "active",
  lines: thirdQuestionInitialLines,
  hiddenTokenIds: ["third_l0_answer"],
  progress: { solved: 0, revealed: 0, totalAnswerTokens: 1 },
};

const firstQuestionTerminal = {
  ...firstQuestionInitial,
  attempt: 2,
  status: "solved",
  lines: firstQuestionTerminalLines,
  hiddenTokenIds: [],
  progress: { solved: 2, revealed: 1, totalAnswerTokens: 3 },
  reveal: {
    lines: [
      "Synthetic alpha words",
      "Keep beta nearby",
      "A gamma token",
      "Four-line fixture",
    ],
    trackName: "Synthetic First Track",
    artistNames: ["Synthetic Artist"],
    startTimestampMs: 1_000,
  },
};

const secondQuestionTerminal = {
  ...secondQuestionInitial,
  status: "solved",
  lines: secondQuestionTerminalLines,
  hiddenTokenIds: [],
  progress: { solved: 1, revealed: 0, totalAnswerTokens: 1 },
  reveal: {
    lines: [
      "Another delta fixture",
      "Second synthetic line",
      "Third synthetic line",
      "Fourth synthetic line",
    ],
    trackName: "Synthetic Second Track",
    artistNames: ["Synthetic Artist"],
    startTimestampMs: 5_000,
  },
};

const thirdQuestionTerminal = {
  ...thirdQuestionInitial,
  status: "solved",
  lines: thirdQuestionTerminalLines,
  hiddenTokenIds: [],
  progress: { solved: 1, revealed: 0, totalAnswerTokens: 1 },
  reveal: {
    lines: [
      "One more epsilon fixture",
      "Third synthetic line",
      "A small closing line",
      "Fourth synthetic line",
    ],
    trackName: "Synthetic Third Track",
    artistNames: ["Synthetic Artist"],
    startTimestampMs: 9_000,
  },
};

function challengeView(
  questions: readonly Record<string, unknown>[],
  complete: boolean,
) {
  return {
    id: challengeId,
    seed: "m10-synthetic-seed",
    source: {
      kind: "public-playlist",
      spotifyId: "m10_fixture_123",
      canonicalUrl: playlistUrl,
      displayName: longPlaylistTitle,
    },
    questions,
    questionCount: questions.length,
    completedQuestionCount: questions.filter(
      (question) => question.status !== "active",
    ).length,
    complete,
    ...(complete
      ? {
          score: {
            total: 84,
            songs: [
              { questionId: firstQuestionId, score: 67 },
              { questionId: secondQuestionId, score: 100 },
              { questionId: thirdQuestionId, score: 100 },
            ],
          },
        }
      : {}),
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

async function expectNoHorizontalOverflow(page: Page, width: number) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      ),
    )
    .toBeLessThanOrEqual(width);
}

test("imports a public playlist, captures canonical setup states, and completes a mocked challenge", async ({
  page,
}) => {
  let created = 0;
  let recoveryReads = 0;
  let guesses = 0;
  let playbackRequests = 0;
  let phase: "initial" | "after-first" | "after-second" | "complete" = "initial";
  let pendingCreate = false;
  let failureMode = false;
  let releaseCreate!: () => void;
  const createGate = new Promise<void>((resolve) => {
    releaseCreate = resolve;
  });
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
    if (requestUrl.protocol === "http:" || requestUrl.protocol === "https:") {
      const isLocal =
        requestUrl.hostname === "127.0.0.1" ||
        requestUrl.hostname === "localhost";
      if (!isLocal) {
        externalRequests.add(requestUrl.origin);
      }
    }
  });

  await page.route("**/api/public-playlists/challenge", async (route) => {
    created += 1;
    const body = route.request().postDataJSON() as { url?: unknown };
    expect(body.url).toBe(playlistUrl);

    if (pendingCreate) {
      pendingCreate = false;
      await createGate;
    }

    if (failureMode) {
      failureMode = false;
      await fulfillJson(
        route,
        {
          error: "PUBLIC_PLAYLIST_UNAVAILABLE",
        },
        502,
      );
      return;
    }

    await fulfillJson(route, {
      challenge: challengeView(
        [firstQuestionInitial, secondQuestionInitial, thirdQuestionInitial],
        false,
      ),
    });
  });

  await page.route(`**/api/challenges/${challengeId}`, async (route) => {
    recoveryReads += 1;
    const questions =
      phase === "initial"
        ? [firstQuestionInitial, secondQuestionInitial, thirdQuestionInitial]
        : phase === "after-first"
          ? [firstQuestionTerminal, secondQuestionInitial, thirdQuestionInitial]
          : phase === "after-second"
            ? [firstQuestionTerminal, secondQuestionTerminal, thirdQuestionInitial]
            : [firstQuestionTerminal, secondQuestionTerminal, thirdQuestionTerminal];
    await fulfillJson(route, {
      challenge: challengeView(questions, phase === "complete"),
    });
  });

  await page.route(
    `**/api/challenges/${challengeId}/questions/${firstQuestionId}/guess`,
    async (route) => {
      guesses += 1;
      if (guesses === 1) {
        await fulfillJson(route, {
          result: "continue",
          questionId: firstQuestionId,
          attempt: 2,
          maxAttempts: 4,
          status: "active",
          progress: { solved: 1, revealed: 1, totalAnswerTokens: 3 },
          lines: firstQuestionContinueLines,
          hiddenTokenIds: ["first_l2_answer"],
          questionCount: 3,
          completedQuestionCount: 0,
          complete: false,
        });
        return;
      }

      phase = "after-first";
      await fulfillJson(route, {
        result: "solved",
        questionId: firstQuestionId,
        attemptsUsed: 2,
        progress: { solved: 2, revealed: 1, totalAnswerTokens: 3 },
        reveal: firstQuestionTerminal.reveal,
        perfect: false,
        streak: 1,
        questionCount: 3,
        completedQuestionCount: 1,
        complete: false,
      });
    },
  );

  await page.route(
    `**/api/challenges/${challengeId}/questions/${secondQuestionId}/guess`,
    async (route) => {
      guesses += 1;
      phase = "after-second";
      await fulfillJson(route, {
        result: "solved",
        questionId: secondQuestionId,
        attemptsUsed: 1,
        progress: { solved: 1, revealed: 0, totalAnswerTokens: 1 },
        reveal: secondQuestionTerminal.reveal,
        perfect: true,
        streak: 2,
        questionCount: 3,
        completedQuestionCount: 2,
        complete: false,
      });
    },
  );

  await page.route(
    `**/api/challenges/${challengeId}/questions/${thirdQuestionId}/guess`,
    async (route) => {
      guesses += 1;
      phase = "complete";
      await fulfillJson(route, {
        result: "solved",
        questionId: thirdQuestionId,
        attemptsUsed: 1,
        progress: { solved: 1, revealed: 0, totalAnswerTokens: 1 },
        reveal: thirdQuestionTerminal.reveal,
        perfect: true,
        streak: 3,
        questionCount: 3,
        completedQuestionCount: 3,
        complete: true,
      });
    },
  );

  await page.route(
    `**/api/challenges/${challengeId}/questions/*/playback`,
    async (route) => {
      playbackRequests += 1;
      await fulfillJson(route, {
        playback: {
          provider: "youtube",
          status: "unavailable",
          reason: "no-candidate",
        },
      });
    },
  );

  await page.route(
    `**/api/challenges/${challengeId}/questions/*/playback/warmup`,
    async (route) => {
      await fulfillJson(
        route,
        { warmup: { provider: "youtube", status: "accepted" } },
        202,
      );
    },
  );

  await page.setViewportSize({ width: 1_440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play this playlist" })).toBeVisible();
  await expectNoHorizontalOverflow(page, 1_440);
  await captureArtifact(page, "landing-desktop-1440.png");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectNoHorizontalOverflow(page, 390);
  await captureArtifact(page, "landing-mobile-390.png");

  await page.setViewportSize({ width: 1_440, height: 900 });
  await page.goto("/");
  const playlistInput = page.getByLabel("Public Spotify playlist link");
  await playlistInput.fill(playlistUrl);
  pendingCreate = true;
  await playlistInput.press("Enter");

  await expect(page).toHaveURL(/\/play\?kind=public-playlist/);
  await expect(
    page.getByRole("heading", { name: "Preparing your challenge" }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Importing playlist" }),
  ).toBeVisible();
  await expect(page.locator(".ftl-prestart-loading-signal")).toBeVisible();
  await expect(page.getByRole("button", { name: /Start Challenge/i })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Choose another playlist" }).first(),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page, 1_440);
  await captureArtifact(page, "prestart-loading-desktop-1440.png");

  releaseCreate();
  await expect(
    page.getByRole("heading", { name: longPlaylistTitle }),
  ).toBeVisible();
  await expect(page.getByText("3 songs", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start Challenge" })).toBeEnabled();
  await expect(page.locator(".ftl-prestart-loading-signal")).toHaveCount(0);
  expect(created).toBe(1);
  await expectNoHorizontalOverflow(page, 1_440);
  await captureArtifact(page, "prestart-ready-desktop-1440.png");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: longPlaylistTitle })).toBeVisible();
  await expect(page.getByText("3 songs", { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page, 390);
  await captureArtifact(page, "prestart-ready-mobile-390.png");

  for (const width of [320, 375, 414, 768, 1_280, 1_440]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page, width);
  }

  await page.setViewportSize({ width: 320, height: 900 });
  const startButton = page.getByRole("button", { name: "Start Challenge" });
  await startButton.click();
  await expect(page).toHaveURL(new RegExp(`/play/${challengeId}$`));
  await expect(
    page.getByRole("heading", { name: "FillTheLyrics lyric challenge" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(3);
  expect(created).toBe(1);
  await expectNoHorizontalOverflow(page, 320);
  expect(recoveryReads).toBeGreaterThanOrEqual(1);

  const firstGap = page.getByRole("textbox").first();
  await firstGap.fill("alpha");
  await page.getByRole("button", { name: "Check Words" }).click();

  await expect(page.getByText("Another clue unlocked.")).toBeVisible();
  await expect(
    page.locator(".difficulty-rail-mobile .ftl-difficulty-step--active").getByText("Hard"),
  ).toBeVisible();
  await expect(page.getByLabel("Player-solved lyric word, solved and locked")).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(1);
  await expectNoHorizontalOverflow(page, 320);

  await page.getByRole("textbox").fill("gamma");
  await page.getByRole("button", { name: "Check Words" }).click();
  await expect(page.getByRole("heading", { name: "You got it." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next song" })).toBeVisible();
  await expect(page.getByText("Final score")).toHaveCount(0);
  await expectNoHorizontalOverflow(page, 320);
  await expect.poll(() => playbackRequests).toBe(1);

  await page.getByRole("button", { name: "Next song" }).click();
  await expect(page.getByRole("textbox")).toHaveCount(1);
  await expect(page.getByText("Song 2 / 3")).toBeVisible();

  await page.getByRole("textbox").fill("delta");
  await page.getByRole("button", { name: "Check Words" }).click();
  await expect(page.getByRole("heading", { name: "You got it." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next song" })).toBeVisible();
  await expectNoHorizontalOverflow(page, 320);
  await expect.poll(() => playbackRequests).toBe(2);

  await page.getByRole("button", { name: "Next song" }).click();
  await expect(page.getByRole("textbox")).toHaveCount(1);
  await expect(page.getByText("Song 3 / 3")).toBeVisible();
  await page.getByRole("textbox").fill("epsilon");
  await page.getByRole("button", { name: "Check Words" }).click();
  await expect(page.getByRole("heading", { name: "You got it." })).toBeVisible();
  await expect(page.getByRole("button", { name: "See results" })).toBeVisible();
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  await expect(
    page.locator('[role="status"].pointer-events-none').filter({ hasText: "PERFECT" }),
  ).toBeVisible();
  await expect(page.getByText("Final score")).toHaveCount(0);
  await expectNoHorizontalOverflow(page, 320);
  await expect.poll(() => playbackRequests).toBe(3);

  await page.getByRole("button", { name: "See results" }).click();
  await expect(page).toHaveURL(new RegExp(`/results/${challengeId}$`));
  await expect(page.getByRole("heading", { name: longPlaylistTitle })).toBeVisible();
  await expect(page.getByText("Final score")).toBeVisible();
  await expect(page.getByText("Song scores")).toBeVisible();
  await expect(page.getByText("67 / 100")).toBeVisible();
  await expect(page.getByText("100 / 100")).toHaveCount(2);
  await expectNoHorizontalOverflow(page, 320);
  expect(guesses).toBe(4);
  expect(recoveryReads).toBeGreaterThanOrEqual(2);

  await page.setViewportSize({ width: 1_440, height: 900 });
  await page.goto("/");
  failureMode = true;
  await page.getByLabel("Public Spotify playlist link").fill(playlistUrl);
  await page.getByLabel("Public Spotify playlist link").press("Enter");
  await expect(page).toHaveURL(/\/play\?kind=public-playlist/);
  await expect(page.getByRole("heading", { name: "Challenge setup" })).toBeVisible();
  await expect(page.locator(".ftl-prestart-error")).toContainText("couldn't import");
  await expect(page.locator(".ftl-prestart-loading-signal")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Choose another playlist" }).first(),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page, 1_440);
  await captureArtifact(page, "prestart-error-desktop-1440.png");

  const requestsBeforeRetry = created;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: longPlaylistTitle })).toBeVisible();
  expect(created).toBe(requestsBeforeRetry + 1);
  await page.waitForTimeout(100);
  expect(created).toBe(requestsBeforeRetry + 1);
  await expect(page).toHaveURL(/\/play\?kind=public-playlist/);
  await expect(page.getByRole("button", { name: "Start Challenge" })).toBeVisible();

  expect([...externalRequests]).toEqual([]);
  expect(pageErrors).toEqual([]);
  const unexpectedConsoleErrors = consoleErrors.filter(
    (message) =>
      !message.includes("Failed to load resource: the server responded with a status of 502"),
  );
  expect(unexpectedConsoleErrors).toEqual([]);
});
