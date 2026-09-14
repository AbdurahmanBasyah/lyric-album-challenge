"use client";

import { motion } from "motion/react";

type PreviewTokenState = "hidden" | "solved" | "revealed" | "static";

type PreviewToken = Readonly<{
  text: string;
  state: PreviewTokenState;
}>;

/**
 * These lines are interface-only sample text. They are intentionally not
 * pulled from a song or from a challenge response.
 */
const previewLines: readonly (readonly PreviewToken[])[] = [
  [
    { text: "Count", state: "static" },
    { text: "the", state: "static" },
    { text: "quiet", state: "hidden" },
    { text: "beats", state: "solved" },
  ],
  [
    { text: "Follow", state: "static" },
    { text: "the", state: "revealed" },
    { text: "room", state: "static" },
    { text: "back", state: "hidden" },
    { text: "home", state: "static" },
  ],
  [
    { text: "Leave", state: "static" },
    { text: "one", state: "hidden" },
    { text: "bright", state: "revealed" },
    { text: "marker", state: "static" },
  ],
  [
    { text: "Let", state: "static" },
    { text: "the", state: "static" },
    { text: "chorus", state: "hidden" },
    { text: "wait", state: "solved" },
  ],
];

function PreviewToken({ token }: { token: PreviewToken }) {
  if (token.state === "hidden") {
    return (
      <span
        className="ftl-preview-token ftl-preview-token--hidden"
        aria-label="missing sample word"
      >
        {"_".repeat(Math.max(3, token.text.length))}
      </span>
    );
  }

  return (
    <span
      className={`ftl-preview-token ftl-preview-token--${token.state}`}
      {...(token.state === "solved"
        ? { "data-preview-state": "solved" }
        : token.state === "revealed"
          ? { "data-preview-state": "hint" }
          : {})}
    >
      {token.text}
    </span>
  );
}

export function PuzzlePreview() {
  return (
    <motion.section
      className="ftl-preview-wrap"
      aria-labelledby="preview-title"
      // Keep the illustrative stage visible before Framer Motion hydrates.
      initial={{ opacity: 1, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.7, delay: 0.22, ease: "easeOut" }}
    >
      <div className="ftl-preview-beam" aria-hidden="true" />
      <div className="ftl-preview-stage">
        <div className="ftl-preview-stage__edge" aria-hidden="true" />
        <div className="ftl-preview-stage__inner">
          <div className="ftl-preview-topline">
            <span className="ftl-preview-label">Lyric reconstruction</span>
            <span className="ftl-preview-attempt">
              Attempt <strong>1 / 4</strong>
            </span>
          </div>

          <div className="ftl-preview-heading-row">
            <div>
              <p className="ftl-preview-kicker">Sample fragment</p>
              <h2 id="preview-title">Fill the spaces</h2>
            </div>
            <div className="ftl-preview-signal" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
          </div>

          <div className="ftl-preview-lines">
            {previewLines.map((line, lineIndex) => (
              <div className="ftl-preview-line" key={`preview-line-${lineIndex}`}>
                {line.map((token, tokenIndex) => (
                  <motion.span
                    className="ftl-preview-token-motion"
                    key={`${lineIndex}-${tokenIndex}-${token.text}`}
                    initial={{ opacity: 1, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.42,
                      delay: 0.48 + lineIndex * 0.08 + tokenIndex * 0.025,
                      ease: "easeOut",
                    }}
                  >
                    <PreviewToken token={token} />
                  </motion.span>
                ))}
              </div>
            ))}
          </div>

          <div className="ftl-preview-footer">
            <span>
              <i className="ftl-preview-key ftl-preview-key--hidden" aria-hidden="true" />
              missing
            </span>
            <span>
              <i className="ftl-preview-key ftl-preview-key--solved" aria-hidden="true" />
              solved
            </span>
            <span>
              <i className="ftl-preview-key ftl-preview-key--hint" aria-hidden="true" />
              system hint
            </span>
          </div>
          <p className="ftl-preview-caption">Illustrative sample · one four-line window</p>
        </div>
      </div>
    </motion.section>
  );
}
