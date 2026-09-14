import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildChallengeResultTracks,
  deriveChallengeResultMetrics,
} from "./challenge-result";
import type { ChallengeView } from "../../types/challenge";

const source = readFileSync(
  resolve(process.cwd(), "src/components/challenge/challenge-result.tsx"),
  "utf8",
);

describe("challenge results UI contract", () => {
  it("keeps results factual and scoring independent", () => {
    expect(source).toContain("No score yet");
    expect(source).toContain("finish the challenge to see your score");
    expect(source).toContain("question.progress.solved");
    expect(source).toContain("question.progress.revealed");
    expect(source).not.toContain("leaderboard");
  });

  it("renders only server-owned total and per-song scores for complete views", () => {
    expect(source).toContain("const score = challenge.complete ? challenge.score : undefined");
    expect(source).toContain("score.total");
    expect(source).toContain("score.songs.map");
    expect(source).toContain("song.score");
    expect(source).not.toContain("multiplier");
    expect(source).not.toContain("calculateSongScore");
  });

  it("renders only the bounded reveal and keeps playback optional", () => {
    expect(source).toContain("result.reveal.lines.map");
    expect(source).toContain("result.reveal.trackName");
    expect(source).toContain("ftl-round-complete");
    expect(source).toContain("ftl-round-complete__media");
    expect(source).toContain("ftl-round-complete__stats");
    expect(source).toContain("<ChallengePlayback");
    expect(source).toContain("reveal={result.reveal}");
    expect(source).toContain("requestPlayback={onPlaybackRequest}");
    expect(source).toContain("onAdvance");
    expect(source).toContain('result.complete\n            ? "See results"');
    expect(source).toContain(': "Next song"');
    expect(source).toContain("advanceButtonRef.current?.focus()");
    expect(source).toContain('role="region"');
    expect(source).toContain("result-action");
    expect(source).not.toContain("SpotifyPlayer");
    expect(source).not.toContain("spotify.com");
  });

  it("uses authoritative totals and preserves question order for track scores", () => {
    const challenge = createResultsFixture();
    const metrics = deriveChallengeResultMetrics(challenge);
    const tracks = buildChallengeResultTracks(challenge);

    expect(metrics).toEqual({
      finalScore: 72,
      solvedCount: 2,
      perfectCount: 1,
      bestStreak: 2,
    });
    expect(tracks.map((track) => [track.title, track.score, track.status])).toEqual([
      ["Midnight Paper Stars", 100, "solved"],
      ["Glass Elevator", 45, "solved"],
      ["Static on the Line", 28, "failed"],
    ]);
    expect(tracks.map((track) => track.perfect)).toEqual([true, false, false]);
  });

  it("omits score and unrevealed metadata for incomplete recovery views", () => {
    const challenge = createResultsFixture({ complete: false });
    const metrics = deriveChallengeResultMetrics(challenge);
    const tracks = buildChallengeResultTracks(challenge);

    expect(metrics.finalScore).toBeNull();
    expect(tracks.every((track) => track.score === null)).toBe(true);
    expect(tracks[2]).toMatchObject({
      title: null,
      artist: null,
      status: "active",
      perfect: false,
    });
  });
});

function createResultsFixture(
  overrides: Partial<Pick<ChallengeView, "complete" | "score">> = {},
): ChallengeView {
  const questions: ChallengeView["questions"] = [
    createQuestion("m10_result_q1", 1, "solved", "Midnight Paper Stars", "The Synthetic Hours"),
    createQuestion("m10_result_q2", 2, "solved", "Glass Elevator", "The Synthetic Hours"),
    createQuestion("m10_result_q3", overrides.complete === false ? 1 : 4, overrides.complete === false ? "active" : "failed", "Static on the Line", "The Synthetic Hours"),
  ];

  return {
    id: "m10_results_01",
    seed: "m10-canonical-04-fixture",
    source: {
      kind: "public-playlist",
      spotifyId: "m10_playlist_01",
      displayName: "Night Drive Sketches",
      canonicalUrl: "https://open.spotify.com/playlist/m10_playlist_01",
    },
    questions,
    questionCount: 3,
    completedQuestionCount: overrides.complete === false ? 2 : 3,
    complete: overrides.complete ?? true,
    ...(overrides.complete === false
      ? {}
      : {
          score: overrides.score ?? {
            total: 72,
            songs: [
              { questionId: "m10_result_q3", score: 28 },
              { questionId: "m10_result_q1", score: 100 },
              { questionId: "m10_result_q2", score: 45 },
            ],
          },
        }),
  };
}

function createQuestion(
  id: string,
  attempt: 1 | 2 | 3 | 4,
  status: "active" | "solved" | "failed",
  trackName: string,
  artistName: string,
): ChallengeView["questions"][number] {
  return {
    id,
    attempt,
    maxAttempts: 4,
    status,
    lines: [1, 2, 3, 4].map((line) => ({
      timestampMs: line * 1000,
      tokens: [
        { id: `${id}_${line}_a`, text: "Neon", state: "static" as const },
        {
          id: `${id}_${line}_b`,
          text: status === "active" ? "____" : "windows",
          state: status === "active" ? ("hidden" as const) : ("solved" as const),
        },
      ],
    })),
    hiddenTokenIds: status === "active" ? [`${id}_1_b`] : [],
    progress: {
      solved: status === "active" ? 0 : 1,
      revealed: 0,
      totalAnswerTokens: 1,
    },
    ...(status === "active"
      ? {}
      : {
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
        }),
  };
}
