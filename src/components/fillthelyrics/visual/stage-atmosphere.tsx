import type { ReactNode } from "react";

export type StageAtmosphereProps = Readonly<{
  children: ReactNode;
  className?: string;
  intensity?:
    | "landing"
    | "setup"
    | "expert"
    | "hard"
    | "medium"
    | "easy"
    | "solved";
}>;

/**
 * A single, CSS-only stage layer shared by the canonical public surfaces.
 * The lighting and grain are decorative; the content remains a normal,
 * accessible child tree above the atmosphere.
 */
export function StageAtmosphere({
  children,
  className = "",
  intensity = "landing",
}: StageAtmosphereProps) {
  const classes = [
    "ftl-stage-atmosphere",
    `ftl-stage-atmosphere--${intensity}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <div className="ftl-stage-atmosphere__lights" aria-hidden="true" />
      <div className="ftl-stage-atmosphere__beams" aria-hidden="true" />
      <div className="ftl-stage-atmosphere__haze" aria-hidden="true" />
      <div className="ftl-stage-atmosphere__floor" aria-hidden="true" />
      <div className="ftl-stage-atmosphere__grain" aria-hidden="true" />
      <div className="ftl-stage-atmosphere__content">{children}</div>
    </div>
  );
}
