"use client";

import { motion } from "motion/react";

import { PuzzlePreview } from "@/components/landing/puzzle-preview";
import { PublicPlaylistForm } from "@/components/public-playlist/public-playlist-form";

const entranceVariants = {
  // Keep server-rendered content visible if hydration or motion is delayed.
  hidden: { opacity: 1, y: 18 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: "easeOut" as const },
  },
};

const contentVariants = {
  hidden: {},
  visible: {
    transition: { delayChildren: 0.1, staggerChildren: 0.08 },
  },
};

export function LandingHero() {
  return (
    <div className="site-shell landing-shell">
      <div className="ambient-shader" aria-hidden="true" />

      <motion.header
        className="site-header"
        initial="hidden"
        animate="visible"
        variants={contentVariants}
      >
        <motion.a
          className="brand-lockup"
          href="#main-content"
          variants={entranceVariants}
        >
          <span className="brand-mark" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path
                d="M5 15.5V8.5M9.5 18V6M14 15.5V8.5M18.5 13V11"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span className="brand-name">
            <span>FillTheLyrics</span>
            <span>Music memory, one word at a time</span>
          </span>
        </motion.a>
        <motion.span className="header-pill" variants={entranceVariants}>
          Public playlist mode
        </motion.span>
      </motion.header>

      <main id="main-content" className="landing-main">
        <div className="hero-grid">
          <motion.section
            className="hero-copy"
            aria-labelledby="hero-title"
            initial="hidden"
            animate="visible"
            variants={contentVariants}
          >
            <motion.p className="eyebrow" variants={entranceVariants}>
              <span className="eyebrow-line" aria-hidden="true" />
              A challenge for close listeners
            </motion.p>
            <motion.h1
              id="hero-title"
              className="hero-heading"
              variants={entranceVariants}
            >
              How well do you know <span>the music you love?</span>
            </motion.h1>
            <motion.p className="hero-description" variants={entranceVariants}>
              Paste a public Spotify playlist, then rebuild four-line lyric
              fragments one word at a time. No account needed.
            </motion.p>

            <motion.div variants={entranceVariants}>
              <PublicPlaylistForm />
            </motion.div>

            <motion.div
              className="privacy-note"
              role="note"
              variants={entranceVariants}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                aria-hidden="true"
              >
                <rect x="5" y="10" width="14" height="10" rx="2" />
                <path
                  d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2"
                  strokeLinecap="round"
                />
              </svg>
              <p>
                <strong>Private by design.</strong> We only use the public
                playlist link to prepare your challenge.
              </p>
            </motion.div>

            <motion.ul
              className="challenge-stats"
              aria-label="Challenge details"
              variants={entranceVariants}
            >
              <li>
                <strong>4</strong> lyric lines
              </li>
              <li>
                <strong>4</strong> attempts
              </li>
              <li>
                <strong>5</strong> songs max
              </li>
            </motion.ul>
          </motion.section>

          <PuzzlePreview />
        </div>
      </main>

      <footer className="landing-footer">
        <p>Listen closely. Remember more.</p>
        <p>Built for the playlist you already chose.</p>
      </footer>
    </div>
  );
}
