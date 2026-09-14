"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";

import { FTL_MOTION, motionSeconds } from "../../lib/motion/motion-constants";
import type { ChallengeGuessFinishedView } from "../../types/challenge";
import {
  buildCelebrationQueue,
  ChallengeCelebration,
  type ChallengeCelebrationEvent,
} from "./challenge-celebration";
import { BrandWordmark } from "../fillthelyrics/visual/brand-wordmark";
import { StageAtmosphere } from "../fillthelyrics/visual/stage-atmosphere";

type LabSample =
  | "correct-word"
  | "incorrect-word"
  | "system-hint"
  | "expert-hard"
  | "hard-medium"
  | "medium-easy"
  | "round-solved"
  | "round-failed"
  | "next-song";

type LabSampleSpec = Readonly<{
  label: string;
  detail: string;
  tone: "mint" | "purple" | "neutral" | "danger";
  wordStates: readonly ("solved" | "revealed" | "hidden" | "static")[];
}>;

const SAMPLE_SPECS: Record<LabSample, LabSampleSpec> = {
  "correct-word": {
    label: "Correct Word",
    detail: "The answer locks in place and the next blank stays ready.",
    tone: "mint",
    wordStates: ["static", "solved", "hidden", "hidden"],
  },
  "incorrect-word": {
    label: "Incorrect Word",
    detail: "The miss stays quiet; no success motion or score credit fires.",
    tone: "danger",
    wordStates: ["static", "hidden", "hidden", "hidden"],
  },
  "system-hint": {
    label: "System Hint Reveal",
    detail: "One word is revealed by the system while solved words remain locked.",
    tone: "purple",
    wordStates: ["static", "solved", "revealed", "hidden"],
  },
  "expert-hard": {
    label: "Expert -> Hard",
    detail: "The difficulty rail eases one step after an unsuccessful attempt.",
    tone: "purple",
    wordStates: ["static", "revealed", "revealed", "hidden"],
  },
  "hard-medium": {
    label: "Hard -> Medium",
    detail: "More of the fragment opens without changing the answer surface.",
    tone: "purple",
    wordStates: ["static", "revealed", "revealed", "revealed"],
  },
  "medium-easy": {
    label: "Medium -> Easy",
    detail: "The final hint state may include the title; the lyric remains inline.",
    tone: "neutral",
    wordStates: ["static", "revealed", "revealed", "revealed"],
  },
  "round-solved": {
    label: "Round Complete Solved",
    detail: "The accepted Round Complete surface follows the terminal guess.",
    tone: "mint",
    wordStates: ["static", "solved", "solved", "solved"],
  },
  "round-failed": {
    label: "Round Complete Failed",
    detail: "The full bounded fragment is available without inventing a win.",
    tone: "danger",
    wordStates: ["static", "revealed", "revealed", "hidden"],
  },
  "next-song": {
    label: "Next Song transition",
    detail: "Motion Lab prototype: handoff timing only; production challenge state is untouched.",
    tone: "neutral",
    wordStates: ["static", "hidden", "hidden", "hidden"],
  },
};

const SYNTHETIC_LINES = [
  "Neon windows remember the shape of a melody.",
  "Paper stars keep time with the crowd.",
  "Quiet rooms carry every bright refrain.",
  "Small songs turn the night around.",
] as const;

const CELEBRATION_FIXTURE: Pick<
  ChallengeGuessFinishedView,
  "result" | "questionId" | "attemptsUsed" | "perfect" | "streak"
> = {
  result: "solved",
  questionId: "motion_lab_question",
  attemptsUsed: 1,
  perfect: true,
  streak: 1,
};

function celebrationFixture(
  kind: "perfect" | "streak",
  streak: number,
): Pick<
  ChallengeGuessFinishedView,
  "result" | "questionId" | "attemptsUsed" | "perfect" | "streak"
> {
  return {
    ...CELEBRATION_FIXTURE,
    attemptsUsed: kind === "perfect" ? 1 : 2,
    perfect: kind === "perfect",
    streak,
  };
}

function stageIntensity(sample: LabSample): "expert" | "hard" | "medium" | "easy" | "solved" {
  switch (sample) {
    case "expert-hard":
      return "hard";
    case "hard-medium":
      return "medium";
    case "medium-easy":
      return "easy";
    case "round-solved":
      return "solved";
    case "round-failed":
      return "easy";
    default:
      return "expert";
  }
}

function wordClass(state: LabSampleSpec["wordStates"][number]): string {
  return `ftl-motion-lab-word ftl-motion-lab-word--${state}`;
}

function LabWordRow({
  states,
  reducedMotion,
}: {
  states: LabSampleSpec["wordStates"];
  reducedMotion: boolean;
}) {
  const labels = ["Neon", "windows", "remember", "melody"] as const;

  return (
    <div className="ftl-motion-lab-word-row" aria-label="Synthetic lyric word states">
      {states.map((state, index) => (
        <motion.span
          className={wordClass(state)}
          key={`${labels[index]}-${state}`}
          initial={{ opacity: 0.35, y: reducedMotion ? 0 : 6 }}
          animate={{ opacity: state === "hidden" ? 0.38 : 1, y: 0 }}
          transition={{
            duration: motionSeconds(
              reducedMotion ? FTL_MOTION.reducedMotionMs : FTL_MOTION.microMs,
            ),
            ease: FTL_MOTION.ease,
          }}
        >
          {state === "hidden" ? "____" : labels[index]}
        </motion.span>
      ))}
    </div>
  );
}

export function MotionLab() {
  const prefersReducedMotion = useReducedMotion();
  const [sample, setSample] = useState<LabSample>("correct-word");
  const [revision, setRevision] = useState(0);
  const [celebrationQueue, setCelebrationQueue] = useState<
    readonly ChallengeCelebrationEvent[]
  >([]);
  const [reducedPreview, setReducedPreview] = useState(false);
  const reducedMotion = reducedPreview || prefersReducedMotion === true;
  const spec = SAMPLE_SPECS[sample];

  function showSample(nextSample: LabSample) {
    setSample(nextSample);
    setRevision((value) => value + 1);
    setCelebrationQueue([]);
  }

  function showCelebration(kind: "perfect" | "streak", streak: number) {
    const fixture = celebrationFixture(kind, streak);
    setSample(kind === "perfect" ? "round-solved" : "next-song");
    setRevision((value) => value + 1);
    setCelebrationQueue(buildCelebrationQueue(fixture));
  }

  function dismissCelebration() {
    setCelebrationQueue((events) => events.slice(1));
  }

  function toggleReducedPreview() {
    setReducedPreview((value) => !value);
    setRevision((value) => value + 1);
  }

  return (
    <StageAtmosphere
      intensity={stageIntensity(sample)}
      className="ftl-motion-lab-shell"
    >
      <div
        className="ftl-motion-lab-page"
        data-motion-reduced={reducedMotion ? "true" : "false"}
      >
        <header className="ftl-motion-lab-header">
          <BrandWordmark
            href="/"
            ariaLabel="FillTheLyrics home"
            subtitle="Motion Lab"
          />
          <span className="ftl-motion-lab-badge">DEV ONLY</span>
        </header>

        <main className="ftl-motion-lab-main">
          <div className="ftl-motion-lab-intro">
            <p className="ftl-motion-lab-kicker">
              <span aria-hidden="true" className="ftl-motion-lab-kicker__line" />
              Motion Lab prototype
            </p>
            <h1>Motion you can feel.</h1>
            <p>
              A repeatable benchmark for the lyric state changes, celebrations,
              and handoffs that shape the FillTheLyrics stage.
            </p>
          </div>

          <div className="ftl-motion-lab-layout">
            <aside
              className="ftl-motion-lab-controls"
              aria-labelledby="motion-lab-controls-heading"
            >
              <div className="ftl-motion-lab-controls__heading">
                <p className="ftl-motion-lab-label">REPEATABLE STATES</p>
                <h2 id="motion-lab-controls-heading">Trigger a moment</h2>
              </div>
              <div className="ftl-motion-lab-control-grid">
                <button type="button" onClick={() => showSample("correct-word")}>
                  Correct Word
                </button>
                <button type="button" onClick={() => showSample("incorrect-word")}>
                  Incorrect Word
                </button>
                <button type="button" onClick={() => showSample("system-hint")}>
                  System Hint Reveal
                </button>
                <button type="button" onClick={() => showSample("expert-hard")}>
                  Expert -&gt; Hard
                </button>
                <button type="button" onClick={() => showSample("hard-medium")}>
                  Hard -&gt; Medium
                </button>
                <button type="button" onClick={() => showSample("medium-easy")}>
                  Medium -&gt; Easy
                </button>
                <button
                  type="button"
                  className="ftl-motion-lab-control--celebration"
                  onClick={() => showCelebration("perfect", 1)}
                >
                  PERFECT
                </button>
                <button
                  type="button"
                  className="ftl-motion-lab-control--celebration"
                  onClick={() => showCelebration("streak", 2)}
                >
                  STREAK x2
                </button>
                <button
                  type="button"
                  className="ftl-motion-lab-control--celebration"
                  onClick={() => showCelebration("streak", 3)}
                >
                  STREAK x3
                </button>
                <button type="button" onClick={() => showSample("round-solved")}>
                  Round Complete Solved
                </button>
                <button type="button" onClick={() => showSample("round-failed")}>
                  Round Complete Failed
                </button>
                <button type="button" onClick={() => showSample("next-song")}>
                  Next Song transition
                </button>
              </div>
              <button
                type="button"
                className={`ftl-motion-lab-reduced ${reducedPreview ? "ftl-motion-lab-reduced--active" : ""}`}
                aria-pressed={reducedPreview}
                onClick={toggleReducedPreview}
              >
                Reduced Motion Preview
                <span aria-hidden="true">{reducedPreview ? "ON" : "OFF"}</span>
              </button>
            </aside>

            <section
              className="ftl-motion-lab-stage"
              aria-labelledby="motion-lab-stage-heading"
            >
              <div className="ftl-motion-lab-stage__header">
                <div>
                  <p className="ftl-motion-lab-label">CURRENT STATE</p>
                  <h2 id="motion-lab-stage-heading">{spec.label}</h2>
                </div>
                <span className={`ftl-motion-lab-state-dot ftl-motion-lab-state-dot--${spec.tone}`} />
              </div>

              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  className="ftl-motion-lab-sample"
                  key={`${sample}-${revision}`}
                  initial={{ opacity: 0, y: reducedMotion ? 0 : 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: reducedMotion ? 0 : -8 }}
                  transition={{
                    duration: motionSeconds(
                      reducedMotion ? FTL_MOTION.reducedMotionMs : FTL_MOTION.stateMs,
                    ),
                    ease: FTL_MOTION.ease,
                  }}
                >
                  <div className="ftl-motion-lab-lyric" aria-label="Synthetic lyric fragment">
                    {SYNTHETIC_LINES.map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                  </div>
                  <LabWordRow states={spec.wordStates} reducedMotion={reducedMotion} />
                  <p className={`ftl-motion-lab-detail ftl-motion-lab-detail--${spec.tone}`}>
                    {spec.detail}
                  </p>
                </motion.div>
              </AnimatePresence>

              <div className="ftl-motion-lab-stage__footer">
                <span>synthetic fixture / no live providers</span>
                <span>{reducedMotion ? "reduced motion" : "full motion"}</span>
              </div>
            </section>
          </div>
        </main>

        <p className="ftl-motion-lab-note">
          Development-only benchmark. Production challenge state and provider
          boundaries are never called from this surface.
        </p>

        <ChallengeCelebration
          queue={celebrationQueue}
          onDismiss={dismissCelebration}
          reducedMotionOverride={reducedMotion}
        />
      </div>
    </StageAtmosphere>
  );
}
