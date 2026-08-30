import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const introSource = readFileSync(
  resolve(process.cwd(), "src/components/challenge/challenge-intro.tsx"),
  "utf8",
);

describe("challenge setup flow", () => {
  it("keeps public import behind the explicit setup action", () => {
    expect(introSource).toContain("createPublicPlaylistChallenge");
    expect(introSource).toContain("source.canonicalUrl");
    expect(introSource).toContain("router.replace(`/play/${encodeURIComponent(challenge.id)}`)");
    expect(introSource).toContain("Imported playlist");
    expect(introSource).toContain("Start challenge");
    expect(introSource).not.toContain("Import playlist");
    expect(introSource).toContain("Building your challenge…");
  });

  it("preserves the legacy source creation branch", () => {
    expect(introSource).toContain("createChallenge(source");
    expect(introSource).toContain('source.kind === "public-playlist"');
    expect(introSource).toContain('href={backHref}');
  });

  it("exposes truthful, recoverable, accessible states", () => {
    expect(introSource).toContain('role="status"');
    expect(introSource).toContain('aria-live="polite"');
    expect(introSource).toContain('role="alert"');
    expect(introSource).toContain("aria-busy={starting}");
    expect(introSource).toContain("Try again");
    expect(introSource).not.toContain("percent");
    expect(introSource).not.toContain("track list");
  });
});
