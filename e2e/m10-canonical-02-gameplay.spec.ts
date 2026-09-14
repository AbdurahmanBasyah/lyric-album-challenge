import { mkdirSync, unlinkSync } from "node:fs";

import { expect, test, type Page, type Route } from "@playwright/test";

const challengeId = "challenge_m10_canonical_02";
const questionId = "question_m10_canonical_02";
const playlistUrl = "https://open.spotify.com/playlist/m10_correction_fixture";
const playlistTitle = "Synthetic Night Drive Set";
const artifactDirectory = "artifacts/M10-CANONICAL-02-CORRECTION";

type TokenState = "hidden" | "solved" | "revealed" | "static";

function token(id: string, text: string, state: TokenState) {
  return { id, text, state };
}

function line(timestampMs: number, tokens: ReturnType<typeof token>[]) {
  return { timestampMs, tokens };
}

const expertLines = [
  line(1_000, [
    token("lyric_l0_static_start", "Violet ", "static"),
    token("lyric_l0_gap", "_____", "hidden"),
    token("lyric_l0_static_end", " glows.", "static"),
  ]),
  line(2_000, [
    token("lyric_l1_static_start", "Paper ", "static"),
    token("lyric_l1_gap", "___", "hidden"),
    token("lyric_l1_static_end", " turns.", "static"),
  ]),
  line(3_000, [
    token("lyric_l2_static_start", "Small ", "static"),
    token("lyric_l2_gap", "______", "hidden"),
    token("lyric_l2_static_end", " echoes.", "static"),
  ]),
  line(4_000, [
    token("lyric_l3_static_start", "Quiet ", "static"),
    token("lyric_l3_gap", "____", "hidden"),
    token("lyric_l3_static_end", " stays.", "static"),
  ]),
];

const hardLines = [
  line(1_000, [
    token("lyric_l0_static_start", "Violet ", "static"),
    token("lyric_l0_gap", "bright", "solved"),
    token("lyric_l0_static_end", " glows.", "static"),
  ]),
  line(2_000, [
    token("lyric_l1_static_start", "Paper ", "static"),
    token("lyric_l1_gap", "night", "revealed"),
    token("lyric_l1_static_end", " turns.", "static"),
  ]),
  line(3_000, [
    token("lyric_l2_static_start", "Small ", "static"),
    token("lyric_l2_gap", "______", "hidden"),
    token("lyric_l2_static_end", " echoes.", "static"),
  ]),
  line(4_000, [
    token("lyric_l3_static_start", "Quiet ", "static"),
    token("lyric_l3_gap", "____", "hidden"),
    token("lyric_l3_static_end", " stays.", "static"),
  ]),
];

const mediumLines = [
  line(1_000, [
    token("lyric_l0_static_start", "Violet ", "static"),
    token("lyric_l0_gap", "bright", "solved"),
    token("lyric_l0_static_end", " glows.", "static"),
  ]),
  line(2_000, [
    token("lyric_l1_static_start", "Paper ", "static"),
    token("lyric_l1_gap", "night", "revealed"),
    token("lyric_l1_static_end", " turns.", "static"),
  ]),
  line(3_000, [
    token("lyric_l2_static_start", "Small ", "static"),
    token("lyric_l2_gap", "under", "revealed"),
    token("lyric_l2_static_end", " echoes.", "static"),
  ]),
  line(4_000, [
    token("lyric_l3_static_start", "Quiet ", "static"),
    token("lyric_l3_gap", "____", "hidden"),
    token("lyric_l3_static_end", " stays.", "static"),
  ]),
];

const easyLines = [
  line(1_000, [
    token("lyric_l0_static_start", "Violet ", "static"),
    token("lyric_l0_gap", "bright", "solved"),
    token("lyric_l0_static_end", " glows.", "static"),
  ]),
  line(2_000, [
    token("lyric_l1_static_start", "Paper ", "static"),
    token("lyric_l1_gap", "night", "revealed"),
    token("lyric_l1_static_end", " turns.", "static"),
  ]),
  line(3_000, [
    token("lyric_l2_static_start", "Small ", "static"),
    token("lyric_l2_gap", "under", "revealed"),
    token("lyric_l2_static_end", " echoes.", "static"),
  ]),
  line(4_000, [
    token("lyric_l3_static_start", "Quiet ", "static"),
    token("lyric_l3_gap", "____", "hidden"),
    token("lyric_l3_static_end", " stays.", "static"),
  ]),
];

const question = (attempt: 1 | 2 | 3 | 4) => {
  const lines =
    attempt === 1
      ? expertLines
      : attempt === 2
        ? hardLines
        : attempt === 3
          ? mediumLines
          : easyLines;
  const hiddenTokenIds =
    attempt === 1
      ? ["lyric_l0_gap", "lyric_l1_gap", "lyric_l2_gap", "lyric_l3_gap"]
      : attempt === 2
        ? ["lyric_l2_gap", "lyric_l3_gap"]
        : ["lyric_l3_gap"];

  return {
    id: questionId,
    attempt,
    maxAttempts: 4,
    status: "active" as const,
    ...(attempt === 4 ? { titleHint: "Midnight Signal" } : {}),
    lines,
    hiddenTokenIds,
    progress: {
      solved: attempt === 1 ? 0 : 1,
      revealed: attempt === 1 ? 0 : attempt === 2 ? 1 : 2,
      totalAnswerTokens: 4,
    },
  };
};

function challengeView(attempt: 1 | 2 | 3 | 4) {
  return {
    id: challengeId,
    seed: "m10-correction-synthetic-seed",
    source: {
      kind: "public-playlist" as const,
      spotifyId: "m10_correction_fixture",
      canonicalUrl: playlistUrl,
      displayName: playlistTitle,
    },
    questions: [question(attempt)],
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

async function waitForGameplaySettle(
  page: Page,
  attempt: 2 | 3 | 4,
) {
  const form = page.locator(`.ftl-gameplay-form[data-attempt="${attempt}"]`);
  await expect(form).toHaveCount(1);
  await expect
    .poll(() => form.evaluate((element) => Number(getComputedStyle(element).opacity)))
    .toBeGreaterThan(0.98);
}

test("captures the inline-input correction states and keyboard behavior", async ({
  page,
}) => {
  let guessCount = 0;
  let failureMode = false;
  let pendingCreate = false;
  let releaseCreate!: () => void;
  const createGate = new Promise<void>((resolve) => {
    releaseCreate = resolve;
  });
  const unexpectedExternalRequests = new Set<string>();
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
    if (
      (requestUrl.protocol === "http:" || requestUrl.protocol === "https:") &&
      requestUrl.hostname !== "127.0.0.1" &&
      requestUrl.hostname !== "localhost"
    ) {
      unexpectedExternalRequests.add(requestUrl.origin);
    }
  });

  await page.route("**/api/public-playlists/challenge", async (route) => {
    const body = route.request().postDataJSON() as { url?: unknown };
    expect(body.url).toBe(playlistUrl);

    if (pendingCreate) {
      pendingCreate = false;
      await createGate;
    }

    if (failureMode) {
      failureMode = false;
      await fulfillJson(route, { error: "PUBLIC_PLAYLIST_UNAVAILABLE" }, 502);
      return;
    }

    await fulfillJson(route, { challenge: challengeView(1) });
  });

  await page.route(`**/api/challenges/${challengeId}`, async (route) => {
    await fulfillJson(route, { challenge: challengeView(Math.min(guessCount + 1, 4) as 1 | 2 | 3 | 4) });
  });

  await page.route(
    `**/api/challenges/${challengeId}/questions/${questionId}/guess`,
    async (route) => {
      guessCount += 1;
      const attempt = Math.min(guessCount + 1, 4) as 2 | 3 | 4;
      await fulfillJson(route, {
        result: "continue",
        questionId,
        attempt,
        maxAttempts: 4,
        status: "active",
        ...(attempt === 4 ? { titleHint: "Midnight Signal" } : {}),
        progress: question(attempt).progress,
        lines: question(attempt).lines,
        hiddenTokenIds: question(attempt).hiddenTokenIds,
        questionCount: 1,
        completedQuestionCount: 0,
        complete: false,
      });
    },
  );

  await page.route(
    `**/api/challenges/${challengeId}/questions/${questionId}/playback/warmup`,
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
  await expectNoHorizontalOverflow(page, 1_440);
  await captureArtifact(page, "prestart-importing-1440.png");

  releaseCreate();
  await expect(page.getByRole("heading", { name: playlistTitle })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start Challenge" })).toBeEnabled();
  await expect(page.locator(".ftl-prestart-loading-signal")).toHaveCount(0);
  await expectNoHorizontalOverflow(page, 1_440);
  await captureArtifact(page, "prestart-ready-1440.png");

  await page.goto("/");
  failureMode = true;
  await page.getByLabel("Public Spotify playlist link").fill(playlistUrl);
  await page.getByLabel("Public Spotify playlist link").press("Enter");
  await expect(page).toHaveURL(/\/play\?kind=public-playlist/);
  await expect(page.getByRole("heading", { name: "Challenge setup" })).toBeVisible();
  await expect(page.locator(".ftl-prestart-error")).toContainText("couldn't import");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expectNoHorizontalOverflow(page, 1_440);
  await captureArtifact(page, "prestart-error-1440.png");

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: playlistTitle })).toBeVisible();
  await page.getByRole("button", { name: "Start Challenge" }).click();
  await expect(page).toHaveURL(new RegExp(`/play/${challengeId}$`));
  await expect(
    page.getByRole("heading", { name: "FillTheLyrics lyric challenge" }),
  ).toBeVisible();

  const gaps = page.locator(".ftl-lyric-gap");
  await expect(gaps).toHaveCount(4);
  await expect(page.locator(".ftl-gameplay-lyric-line")).toHaveCount(4);
  await expect(page.locator(".ftl-lyric-gap-wrap--focused")).toHaveCount(1);
  await expect(gaps.first()).toBeFocused();
  await expect(gaps.nth(0)).toHaveAttribute("placeholder", "_____");
  await expect(gaps.nth(1)).toHaveAttribute("placeholder", "___");
  await expect(page.getByRole("textbox", { name: "Shared lyric answer" })).toHaveCount(0);
  await expect(page.getByText("Midnight Signal", { exact: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page, 1_440);
  await captureArtifact(page, "gameplay-expert-1440.png");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(gaps).toHaveCount(4);
  await expectNoHorizontalOverflow(page, 390);
  await captureArtifact(page, "gameplay-expert-390.png");

  // Native Tab/Shift+Tab follows the lyric reading order. Drafts stay in the
  // input where they were entered when another gap becomes active.
  await gaps.nth(0).focus();
  await gaps.nth(0).fill("bright");
  await gaps.nth(0).press("Tab");
  await expect(gaps.nth(1)).toBeFocused();
  await gaps.nth(1).fill("draft-only");
  await gaps.nth(1).press("Tab");
  await expect(gaps.nth(2)).toBeFocused();
  await gaps.nth(2).press("Shift+Tab");
  await expect(gaps.nth(1)).toBeFocused();
  await expect(gaps.nth(1)).toHaveValue("draft-only");

  // Enter is suppressed locally, including the IME composition variant; it
  // must not advance a gap or issue a guess request.
  await gaps.nth(1).press("Enter");
  await expect(gaps.nth(1)).toBeFocused();
  expect(guessCount).toBe(0);
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>(".ftl-lyric-gap");
    if (!input) throw new Error("inline gap input not found");
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
        isComposing: true,
      }),
    );
  });
  expect(guessCount).toBe(0);

  await page.getByRole("button", { name: "Check Words" }).click();
  await expect(page.getByText("Attempt 2 / 4")).toBeVisible();
  await waitForGameplaySettle(page, 2);
  await expect(page.locator(".ftl-stage-atmosphere--hard")).toBeVisible();
  await expect(page.getByLabel("Player-solved lyric word, solved and locked")).toBeVisible();
  await expect(page.getByLabel("System-revealed lyric word, revealed hint").first()).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(2);
  await expect(page.getByRole("textbox").first()).toBeFocused();
  await expectNoHorizontalOverflow(page, 390);
  await page.setViewportSize({ width: 1_440, height: 900 });
  await captureArtifact(page, "gameplay-hard-1440.png");

  await page.getByRole("textbox").last().fill("still");
  await page.getByRole("button", { name: "Check Words" }).click();
  await expect(page.getByText("Attempt 3 / 4")).toBeVisible();
  await waitForGameplaySettle(page, 3);
  await expect(page.locator(".ftl-stage-atmosphere--medium")).toBeVisible();
  await expect(page.getByLabel("System-revealed lyric word, revealed hint").first()).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(1);
  await expectNoHorizontalOverflow(page, 1_440);
  await captureArtifact(page, "gameplay-medium-1440.png");

  await page.getByRole("textbox").fill("still");
  await page.getByRole("button", { name: "Check Words" }).click();
  await expect(page.getByText("Attempt 4 / 4")).toBeVisible();
  await waitForGameplaySettle(page, 4);
  await expect(page.locator(".ftl-stage-atmosphere--easy")).toBeVisible();
  await expect(page.getByText("Midnight Signal", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(1);
  await expectNoHorizontalOverflow(page, 1_440);
  await captureArtifact(page, "gameplay-easy-1440.png");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("Midnight Signal", { exact: true })).toBeVisible();
  await expect(page.locator(".ftl-gameplay-lyric-line")).toHaveCount(4);
  await expectNoHorizontalOverflow(page, 390);
  await captureArtifact(page, "gameplay-easy-390.png");

  expect(unexpectedExternalRequests).toEqual(new Set());
  expect(pageErrors).toEqual([]);
  const unexpectedConsoleErrors = consoleErrors.filter(
    (message) =>
      !message.includes("Failed to load resource: the server responded with a status of 502"),
  );
  expect(unexpectedConsoleErrors).toEqual([]);
  await expect(page.locator("[data-playback]")).toHaveCount(0);
});
