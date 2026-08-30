import { expect, test, type Page, type Route } from "@playwright/test";

const challengeId = "challenge_m9_1234";
const firstQuestionId = "question_m9_first";
const secondQuestionId = "question_m9_second";
const playlistUrl = "https://open.spotify.com/playlist/m9_fixture_123";

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

function challengeView(
  questions: readonly Record<string, unknown>[],
  complete: boolean,
) {
  return {
    id: challengeId,
    seed: "m9-synthetic-seed",
    source: {
      kind: "public-playlist",
      spotifyId: "m9_fixture_123",
      canonicalUrl: playlistUrl,
      displayName: "Synthetic Playlist",
    },
    questions,
    questionCount: 2,
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
            ],
          },
        }
      : {}),
  };
}

async function fulfillJson(
  route: Route,
  payload: unknown,
) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "Cache-Control": "no-store" },
    body: JSON.stringify(payload),
  });
}

async function expectNoHorizontalOverflow(
  page: Page,
  width: number,
) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      ),
    )
    .toBeLessThanOrEqual(width);
}

test("imports a public playlist and completes a mocked challenge", async ({
  page,
}) => {
  let created = 0;
  let recoveryReads = 0;
  let guesses = 0;
  let playbackRequests = 0;
  let phase: "initial" | "after-first" | "complete" = "initial";
  const externalRequests = new Set<string>();

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
    await fulfillJson(route, {
      challenge: challengeView([firstQuestionInitial, secondQuestionInitial], false),
    });
  });

  await page.route(`**/api/challenges/${challengeId}`, async (route) => {
    recoveryReads += 1;
    const questions =
      phase === "initial"
        ? [firstQuestionInitial, secondQuestionInitial]
        : phase === "after-first"
          ? [firstQuestionTerminal, secondQuestionInitial]
          : [firstQuestionTerminal, secondQuestionTerminal];
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
          questionCount: 2,
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
        questionCount: 2,
        completedQuestionCount: 1,
        complete: false,
      });
    },
  );

  await page.route(
    `**/api/challenges/${challengeId}/questions/${secondQuestionId}/guess`,
    async (route) => {
      guesses += 1;
      phase = "complete";
      await fulfillJson(route, {
        result: "solved",
        questionId: secondQuestionId,
        attemptsUsed: 1,
        progress: { solved: 1, revealed: 0, totalAnswerTokens: 1 },
        reveal: secondQuestionTerminal.reveal,
        perfect: true,
        streak: 2,
        questionCount: 2,
        completedQuestionCount: 2,
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

  for (const width of [320, 375, 414, 768, 1_280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page, width);
  }

  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/");
  const playlistInput = page.getByLabel("Public Spotify playlist link");
  await expect(playlistInput).toBeVisible();
  await playlistInput.fill(playlistUrl);
  await playlistInput.press("Enter");

  await expect(page).toHaveURL(/\/play\?kind=public-playlist/);
  await expect(
    page.getByRole("heading", { name: "Imported playlist" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Start challenge" })).toBeVisible();
  await expectNoHorizontalOverflow(page, 320);
  expect(created).toBe(0);

  await page.getByRole("button", { name: "Start challenge" }).click();
  await expect(page).toHaveURL(new RegExp(`/play/${challengeId}$`));
  await expect(page.getByRole("heading", { name: "Rebuild the missing words" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /hidden answer/i })).toHaveCount(3);
  for (const width of [320, 375, 414, 768, 1_280]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page, width);
  }
  await page.setViewportSize({ width: 320, height: 900 });
  expect(created).toBe(1);
  expect(recoveryReads).toBeGreaterThanOrEqual(1);

  const firstBlank = page.getByRole("textbox", {
    name: "Line 1, blank 1, hidden answer",
  });
  await firstBlank.fill("alpha");
  await page.getByRole("button", { name: "Check words" }).click();

  await expect(page.getByText("Another clue unlocked.")).toBeVisible();
  await expect(
    page.locator(".difficulty-rail-mobile").getByText("Attempt 2 · current"),
  ).toBeVisible();
  await expect(page.getByLabel("alpha, solved and locked")).toBeVisible();
  await expect(page.getByRole("textbox", { name: /hidden answer/i })).toHaveCount(1);
  await expectNoHorizontalOverflow(page, 320);

  await page.getByRole("textbox", { name: /hidden answer/i }).fill("gamma");
  await page.getByRole("button", { name: "Check words" }).click();
  await expect(page.getByRole("heading", { name: "You got it." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next song" })).toBeVisible();
  await expect(page.getByText("Final score")).toHaveCount(0);
  await expectNoHorizontalOverflow(page, 320);
  await expect.poll(() => playbackRequests).toBe(1);

  await page.getByRole("button", { name: "Next song" }).click();
  await expect(page.getByRole("textbox", { name: /hidden answer/i })).toHaveCount(1);
  await expect(page.getByText("Song 2 / 2")).toBeVisible();

  await page.getByRole("textbox", { name: /hidden answer/i }).fill("delta");
  await page.getByRole("button", { name: "Check words" }).click();
  await expect(page.getByRole("heading", { name: "You got it." })).toBeVisible();
  await expect(page.getByRole("button", { name: "See results" })).toBeVisible();
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  await expect(page.locator('[role="status"].pointer-events-none').filter({ hasText: "PERFECT" })).toBeVisible();
  await expect(page.getByText("Final score")).toHaveCount(0);
  await expectNoHorizontalOverflow(page, 320);
  await expect.poll(() => playbackRequests).toBe(2);

  await page.getByRole("button", { name: "See results" }).click();
  await expect(page).toHaveURL(new RegExp(`/results/${challengeId}$`));
  await expect(page.getByRole("heading", { name: "Synthetic Playlist" })).toBeVisible();
  await expect(page.getByText("Final score")).toBeVisible();
  await expect(page.getByText("Song scores")).toBeVisible();
  await expect(page.getByText("67 / 100")).toBeVisible();
  await expect(page.getByText("100 / 100")).toBeVisible();
  await expectNoHorizontalOverflow(page, 320);
  expect(guesses).toBe(3);
  expect(recoveryReads).toBeGreaterThanOrEqual(2);

  expect([...externalRequests]).toEqual([]);
});
