import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const annotationSource = readFileSync(
  resolve(
    process.cwd(),
    "src/components/fillthelyrics/visual/handwritten-annotation.tsx",
  ),
  "utf8",
);
const atmosphereSource = readFileSync(
  resolve(
    process.cwd(),
    "src/components/fillthelyrics/visual/stage-atmosphere.tsx",
  ),
  "utf8",
);
const stylesSource = readFileSync(
  resolve(process.cwd(), "src/app/globals.css"),
  "utf8",
);
const wordmarkSource = readFileSync(
  resolve(
    process.cwd(),
    "src/components/fillthelyrics/visual/brand-wordmark.tsx",
  ),
  "utf8",
);

describe("canonical visual primitives", () => {
  it("keeps handwritten accents decorative and bounded", () => {
    expect(annotationSource).toContain('aria-hidden="true"');
    expect(annotationSource).toContain("pointer-events");
    expect(annotationSource).toContain("Math.min(8");
    expect(annotationSource).toContain("Math.max(-8");
    expect(annotationSource).toContain("APPROVED_HANDWRITTEN_COPY");
    expect(annotationSource).toContain('"That’s the one"');
    expect(annotationSource).not.toContain("â€™");
    expect(annotationSource).not.toContain('"Try the next line"');
  });

  it("uses one CSS-only atmosphere wrapper with non-semantic layers", () => {
    expect(atmosphereSource).toContain("ftl-stage-atmosphere__lights");
    expect(atmosphereSource).toContain("ftl-stage-atmosphere__beams");
    expect(atmosphereSource).toContain("ftl-stage-atmosphere__haze");
    expect(atmosphereSource).toContain("ftl-stage-atmosphere__floor");
    expect(atmosphereSource).toContain("ftl-stage-atmosphere__grain");
    expect(atmosphereSource).not.toContain("canvas");
    expect(atmosphereSource).not.toContain("WebGL");
  });

  it("keeps stage lighting directional, feathered, and long playlist titles wrappable", () => {
    expect(stylesSource).toContain("mask-image: conic-gradient(");
    expect(stylesSource).toContain("from 117deg at 10% 4%");
    expect(stylesSource).toContain("from 207deg at 90% 4%");
    expect(stylesSource).toContain("filter: blur(5px)");
    expect(stylesSource).toContain("radial-gradient(ellipse at 50% 50%, #d4b5ff");
    expect(stylesSource).toContain(".ftl-preview-stage::after");
    expect(stylesSource).toContain("height: 32%;");
    expect(stylesSource).toContain("ftl-stage-atmosphere__floor::before");
    expect(stylesSource).toContain("overflow-wrap: break-word");
    expect(stylesSource).toContain("word-break: normal");
  });

  it("provides a calm, indeterminate setup signal with stable terminal states", () => {
    expect(stylesSource).toContain(".ftl-prestart-loading-signal");
    expect(stylesSource).toContain("@keyframes ftl-prestart-loading-bars");
    expect(stylesSource).toContain(".ftl-prestart-stage--ready");
    expect(stylesSource).toContain(".ftl-prestart-stage--error");
    expect(stylesSource).toContain(".ftl-prestart-loading-signal span");
  });

  it("shares a reusable FillTheLyrics wordmark", () => {
    expect(wordmarkSource).toContain("FillTheLyrics");
    expect(wordmarkSource).toContain("BrandWordmarkProps");
    expect(wordmarkSource).toContain("aria-hidden");
  });
});
