import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const landingHeroSource = readFileSync(
    resolve(process.cwd(), "src/components/landing/landing-hero.tsx"),
    "utf8",
);
const puzzlePreviewSource = readFileSync(
    resolve(process.cwd(), "src/components/landing/puzzle-preview.tsx"),
    "utf8",
);

describe("landing motion visibility", () => {
    it("keeps critical landing content visible before motion hydration", () => {
        expect(landingHeroSource).toMatch(/hidden:\s*\{\s*opacity:\s*1\b/);
        expect(puzzlePreviewSource).toMatch(/initial=\{\{\s*opacity:\s*1\b/);
    });

    it("does not initialize landing or preview content at opacity zero", () => {
        const criticalSources = [landingHeroSource, puzzlePreviewSource];
        const hiddenOpacity = /opacity\s*:\s*0\b/;

        expect(criticalSources.some((source) => hiddenOpacity.test(source))).toBe(false);
    });
});
