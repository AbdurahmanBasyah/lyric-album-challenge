"use client";

import { motion } from "motion/react";

type PreviewTokenState = "hidden" | "solved" | "revealed" | "static";

type PreviewToken = {
  text: string;
  state: PreviewTokenState;
};

const previewLines: PreviewToken[][] = [
  [
    { text: "Keep", state: "static" },
    { text: "the", state: "solved" },
    { text: "signal", state: "static" },
    { text: "close", state: "revealed" },
    { text: "tonight", state: "hidden" },
  ],
  [
    { text: "Trace", state: "static" },
    { text: "the", state: "hidden" },
    { text: "echo", state: "static" },
    { text: "through", state: "solved" },
    { text: "the", state: "static" },
    { text: "room", state: "hidden" },
  ],
  [
    { text: "Hold", state: "solved" },
    { text: "one", state: "static" },
    { text: "bright", state: "hidden" },
    { text: "word", state: "static" },
    { text: "in", state: "revealed" },
    { text: "memory", state: "hidden" },
  ],
  [
    { text: "Hear", state: "static" },
    { text: "it", state: "hidden" },
    { text: "come", state: "static" },
    { text: "alive", state: "revealed" },
    { text: "again", state: "hidden" },
  ],
];

const tokenLabel: Record<PreviewTokenState, string> = {
  hidden: "hidden",
  solved: "solved",
  revealed: "hint",
  static: "",
};

export function PuzzlePreview() {
  return (
    <motion.section
      className="preview-wrap"
      aria-hidden="true"
      // Opacity must remain visible before Framer Motion hydrates.
      initial={{ opacity: 1, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.7, delay: 0.22, ease: "easeOut" }}
    >
      <div className="preview-ambient ambient-bloom" />
      <div className="puzzle-card glass-panel glass-panel-strong">
        <div className="puzzle-card-inner">
          <div className="preview-topline">
            <span className="preview-type">Lyric reconstruction</span>
            <span className="preview-attempt">
              Attempt <strong>01</strong> / 04
            </span>
          </div>

          <div className="preview-meter">
            <span />
          </div>

          <div className="preview-heading-row">
            <div className="preview-heading-copy">
              <p className="preview-kicker">Sample fragment</p>
              <h2>Fill the spaces</h2>
            </div>
            <div className="preview-art" />
          </div>

          <div className="preview-lines">
            {previewLines.map((line, lineIndex) => (
              <div className="preview-lyric-line" key={`preview-line-${lineIndex}`}>
                {line.map((token, tokenIndex) => (
                  <motion.span
                    className={`preview-token token-${token.state}`}
                    key={`${lineIndex}-${tokenIndex}-${token.text}`}
                    initial={{ opacity: 1, y: 5 }}
                    animate={{
                      opacity: 1,
                      y: 0,
                      scale: token.state === "solved" ? [0.96, 1] : 1,
                    }}
                    transition={{
                      duration: 0.42,
                      delay: 0.48 + lineIndex * 0.08 + tokenIndex * 0.025,
                      ease: "easeOut",
                    }}
                  >
                    <span>{token.state === "hidden" ? "••••••" : token.text}</span>
                    {token.state !== "static" && (
                      <span className="token-status">{token.state === "solved" ? "✓" : tokenLabel[token.state]}</span>
                    )}
                  </motion.span>
                ))}
              </div>
            ))}
          </div>

          <div className="preview-legend">
            <span className="legend-item">
              <span className="legend-mark legend-solved">✓</span>
              solved
            </span>
            <span className="legend-item">
              <span className="legend-mark legend-revealed">+</span>
              hint
            </span>
            <span className="legend-item">
              <span className="legend-mark legend-hidden">?</span>
              hidden
            </span>
          </div>
          <p className="preview-caption">Illustrative sample · one four-line window</p>
        </div>
      </div>
    </motion.section>
  );
}
