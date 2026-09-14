import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const introSource = readFileSync(
  resolve(process.cwd(), "src/components/challenge/challenge-intro.tsx"),
  "utf8",
);

describe("challenge setup flow", () => {
  it("automatically imports public playlists on setup entry", () => {
    expect(introSource).toContain("createPublicPlaylistChallenge(canonicalUrl)");
    expect(introSource).toContain("publicSourceUrl");
    expect(introSource).toContain("beginPublicImport(publicSourceUrl)");
    expect(introSource).toContain("queueMicrotask");
    expect(introSource).toContain("publicImportRef");
    expect(introSource).toContain("publicAttemptRef");
  });

  it("uses an explicit loading/ready/error union for public setup", () => {
    expect(introSource).toContain("export type PublicPreStartState");
    expect(introSource).toContain('phase: "loading"');
    expect(introSource).toContain('phase: "ready"; challenge: ChallengeView');
    expect(introSource).toContain('phase: "error"; error: unknown');
    expect(introSource).toContain('publicState.phase === "ready"');
    expect(introSource).toContain('publicState.phase === "error"');
    expect(introSource).toContain("publicChallenge.questionCount");
    expect(introSource).toContain("publicChallenge.source.displayName");
  });

  it("waits for explicit Start Challenge and never posts again on start", () => {
    expect(introSource).toContain("const startPublicChallenge = () =>");
    expect(introSource).toContain('publicState.phase !== "ready"');
    expect(introSource).toContain("saveChallengeRecovery(publicState.challenge.id)");
    expect(introSource).toContain(
      "router.replace(`/play/${encodeURIComponent(publicState.challenge.id)}`)",
    );
    expect(introSource).toContain('"Start Challenge"');
    expect(introSource).not.toContain("createPublicPlaylistChallenge(source.canonicalUrl");
  });

  it("preserves the authenticated legacy source creation branch", () => {
    expect(introSource).toContain("createChallenge(source");
    expect(introSource).toContain('source.kind === "public-playlist"');
    expect(introSource).toContain("href={backHref}");
  });

  it("exposes truthful, recoverable, accessible states", () => {
    expect(introSource).toContain('role="status"');
    expect(introSource).toContain('aria-live="polite"');
    expect(introSource).toContain('role="alert"');
    expect(introSource).toContain("aria-busy={starting}");
    expect(introSource).toContain("Try again");
    expect(introSource).toContain("Choose another playlist");
    expect(introSource).not.toContain("track list");
  });
});
