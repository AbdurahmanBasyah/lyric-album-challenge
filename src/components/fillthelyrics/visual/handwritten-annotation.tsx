import type { CSSProperties } from "react";

export const APPROVED_HANDWRITTEN_COPY = [
  "Keep going",
  "Almost there",
  "You knew that one",
  "One word at a time",
  "Same song, closer",
  "Right on",
  "Good pick",
  "On a roll",
  "That’s the one",
  "Close one",
  "Still a good song",
] as const;

export type HandwrittenAnnotationProps = Readonly<{
  text: (typeof APPROVED_HANDWRITTEN_COPY)[number];
  tone?: "purple" | "mint" | "neutral";
  size?: "sm" | "md" | "lg";
  rotateDeg?: number;
  underline?: "none" | "single" | "double";
  className?: string;
}>;

const APPROVED_COPY = new Set<string>(APPROVED_HANDWRITTEN_COPY);

function clampRotation(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(8, Math.max(-8, value));
}

/**
 * Decorative marker text. The approved copy guard keeps future callers from
 * quietly turning the handwritten layer into a second source of UI copy.
 */
export function HandwrittenAnnotation({
  text,
  tone = "neutral",
  size = "md",
  rotateDeg = 0,
  underline = "none",
  className = "",
}: HandwrittenAnnotationProps) {
  if (!APPROVED_COPY.has(text)) {
    return null;
  }

  const style = {
    "--ftl-annotation-rotation": `${clampRotation(rotateDeg)}deg`,
  } as CSSProperties;
  const classes = [
    "ftl-handwritten-annotation",
    "pointer-events-none",
    `ftl-handwritten-annotation--${tone}`,
    `ftl-handwritten-annotation--${size}`,
    `ftl-handwritten-annotation--underline-${underline}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} style={style} aria-hidden="true">
      {text}
    </span>
  );
}
