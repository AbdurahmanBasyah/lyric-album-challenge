type BrandWordmarkProps = Readonly<{
  href?: string;
  ariaLabel?: string;
  subtitle?: string;
  className?: string;
}>;

function Mark() {
  return (
    <span className="ftl-brand-wordmark__mark" aria-hidden="true">
      <svg
        viewBox="0 0 28 28"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <path
          d="M5 17.5V10.5M9.5 21V7M14 17.5V10.5M18.5 19V9M23 15V13"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

export function BrandWordmark({
  href,
  ariaLabel = "FillTheLyrics home",
  subtitle,
  className = "",
}: BrandWordmarkProps) {
  const classes = ["ftl-brand-wordmark", className]
    .filter(Boolean)
    .join(" ");
  const content = (
    <>
      <Mark />
      <span className="ftl-brand-wordmark__copy">
        <span className="ftl-brand-wordmark__name">FillTheLyrics</span>
        {subtitle ? (
          <span className="ftl-brand-wordmark__subtitle">{subtitle}</span>
        ) : null}
      </span>
    </>
  );

  if (href) {
    return (
      <a className={classes} href={href} aria-label={ariaLabel}>
        {content}
      </a>
    );
  }

  return <div className={classes}>{content}</div>;
}
