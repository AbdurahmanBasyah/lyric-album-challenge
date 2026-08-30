import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

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
});
