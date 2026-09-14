"use client";

import { motion } from "motion/react";

import { BrandWordmark } from "@/components/fillthelyrics/visual/brand-wordmark";
import { HandwrittenAnnotation } from "@/components/fillthelyrics/visual/handwritten-annotation";
import { StageAtmosphere } from "@/components/fillthelyrics/visual/stage-atmosphere";
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

const ruleItems = [
  { value: "4", label: "lyric lines" },
  { value: "4", label: "attempts" },
  { value: "up to 5", label: "songs" },
  { value: "Perfect", label: "on Expert" },
  { value: "Build", label: "your streak" },
] as const;

export function LandingHero() {
  return (
    <StageAtmosphere intensity="landing" className="ftl-landing-stage">
      <div className="ftl-landing-page">
        <motion.header
          className="ftl-landing-header"
          initial="hidden"
          animate="visible"
          variants={contentVariants}
        >
          <motion.div variants={entranceVariants}>
            <BrandWordmark href="/" />
          </motion.div>
          <motion.nav
            className="ftl-landing-nav"
            aria-label="Landing page navigation"
            variants={entranceVariants}
          >
            <a className="ftl-landing-nav__active" href="#playlist-import">
              Play
            </a>
            <a href="#how-it-works">About</a>
          </motion.nav>
        </motion.header>

        <main id="main-content" className="ftl-landing-main">
          <div className="ftl-landing-hero-grid">
            <motion.section
              className="ftl-landing-copy"
              aria-labelledby="hero-title"
              initial="hidden"
              animate="visible"
              variants={contentVariants}
            >
              <motion.p className="ftl-eyebrow" variants={entranceVariants}>
                <span className="ftl-eyebrow__line" aria-hidden="true" />
                A challenge for close listeners
              </motion.p>
              <motion.h1
                id="hero-title"
                className="ftl-landing-heading"
                variants={entranceVariants}
              >
                How well
                <br />
                do you know
                <br />
                <span className="ftl-landing-heading__purple">the songs</span>
                <br />
                <span className="ftl-landing-heading__mint">you love?</span>
              </motion.h1>
              <motion.p
                className="ftl-landing-description"
                variants={entranceVariants}
              >
                Paste a public Spotify playlist. Rebuild four-line lyric
                fragments one word at a time.
              </motion.p>

              <motion.div id="playlist-import" variants={entranceVariants}>
                <PublicPlaylistForm />
              </motion.div>

              <motion.p className="ftl-no-signin-note" variants={entranceVariants}>
                <span className="ftl-no-signin-note__dot" aria-hidden="true" />
                No Spotify sign-in required.
              </motion.p>
            </motion.section>

            <PuzzlePreview />
          </div>
        </main>

        <footer id="how-it-works" className="ftl-rule-strip">
          <ul aria-label="Challenge rules">
            {ruleItems.map((item) => (
              <li key={item.label}>
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
        </footer>

        <HandwrittenAnnotation
          text="One word at a time"
          tone="neutral"
          size="sm"
          rotateDeg={5}
          underline="single"
          className="ftl-landing-note ftl-landing-note--preview"
        />
        <HandwrittenAnnotation
          text="Still a good song"
          tone="mint"
          size="sm"
          rotateDeg={-4}
          underline="double"
          className="ftl-landing-note ftl-landing-note--bottom"
        />
      </div>
    </StageAtmosphere>
  );
}
