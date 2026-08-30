"use client";

import { motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { FormEvent } from "react";

import {
  canonicalizePublicPlaylistInput,
  createChallengeIntroUrl,
  type ChallengeSourceContext,
} from "../challenge/challenge-api";

type ImportPhase = "idle" | "invalid" | "navigating";

export const PUBLIC_PLAYLIST_URL_INPUT_ID = "public-playlist-url";
export const PUBLIC_PLAYLIST_STATUS_ID = "public-playlist-import-status";

const INVALID_URL_MESSAGE =
  "Paste a public Spotify playlist link to get started.";

export function PublicPlaylistForm() {
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();
  const reducedMotion = prefersReducedMotion ?? false;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const submittingRef = useRef(false);
  const [value, setValue] = useState("");
  const [phase, setPhase] = useState<ImportPhase>("idle");
  const [statusMessage, setStatusMessage] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (submittingRef.current || phase === "navigating") {
      return;
    }

    const canonicalUrl = canonicalizePublicPlaylistInput(value);

    if (canonicalUrl === null) {
      setPhase("invalid");
      setStatusMessage(INVALID_URL_MESSAGE);
      inputRef.current?.focus();
      return;
    }

    // Canonicalization guarantees that the final path segment is a validated
    // Spotify playlist ID. The provider is not contacted until the player
    // confirms this source on the setup screen.
    const spotifyId = canonicalUrl.slice(canonicalUrl.lastIndexOf("/") + 1);
    const source: ChallengeSourceContext = {
      kind: "public-playlist",
      spotifyId,
      canonicalUrl,
    };

    setValue(canonicalUrl);
    setPhase("navigating");
    setStatusMessage("Opening challenge setup...");
    submittingRef.current = true;

    try {
      router.replace(createChallengeIntroUrl(source));
    } catch {
      // The source is locally validated, but a navigation failure is still a
      // recoverable UI state rather than a provider or implementation error.
      setPhase("idle");
      setStatusMessage("We couldn't open setup. Please try again.");
    } finally {
      submittingRef.current = false;
    }
  };

  const hasError = phase === "invalid";
  const buttonLabel =
    phase === "navigating" ? "Opening setup..." : "Import playlist";

  return (
    <motion.div
      className="import-form-wrap"
      initial={{ opacity: 1, y: reducedMotion ? 0 : 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.32, ease: "easeOut" }}
    >
      <form
        className="hero-actions playlist-form"
        onSubmit={submit}
        aria-busy={phase === "navigating"}
      >
        <label
          className="playlist-label"
          htmlFor={PUBLIC_PLAYLIST_URL_INPUT_ID}
        >
          Public Spotify playlist link
        </label>
        <div className="playlist-input-row">
          <input
            ref={inputRef}
            className="playlist-input"
            id={PUBLIC_PLAYLIST_URL_INPUT_ID}
            name="playlist-url"
            type="url"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            placeholder="https://open.spotify.com/playlist/..."
            value={value}
            required
            onInvalid={(event) => {
              event.preventDefault();
              setPhase("invalid");
              setStatusMessage(INVALID_URL_MESSAGE);
              inputRef.current?.focus();
            }}
            onPaste={(event) => {
              const pasted = event.clipboardData.getData("text");
              const canonical = canonicalizePublicPlaylistInput(pasted);

              if (canonical !== null) {
                event.preventDefault();
                setValue(canonical);
                setPhase("idle");
                setStatusMessage("");
              }
            }}
            onChange={(event) => {
              setValue(event.target.value);
              if (phase !== "navigating") {
                setPhase("idle");
                setStatusMessage("");
              }
            }}
            aria-invalid={hasError}
            aria-describedby={`${PUBLIC_PLAYLIST_URL_INPUT_ID}-help ${PUBLIC_PLAYLIST_STATUS_ID}`}
            aria-errormessage={hasError ? PUBLIC_PLAYLIST_STATUS_ID : undefined}
            disabled={phase === "navigating"}
          />
          <button
            className="playlist-submit"
            type="submit"
            disabled={phase === "navigating"}
            aria-busy={phase === "navigating"}
          >
            {buttonLabel}
          </button>
        </div>
        <p
          id={`${PUBLIC_PLAYLIST_URL_INPUT_ID}-help`}
          className="cta-status text-left"
        >
          Public playlist URL only · no sign-in needed.
        </p>
      </form>

      <div
        id={PUBLIC_PLAYLIST_STATUS_ID}
        className="form-feedback"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {phase === "invalid" && (
          <p className="form-error" role="alert">
            {INVALID_URL_MESSAGE}
          </p>
        )}
        {statusMessage && phase !== "invalid" && (
          <p className="form-status">{statusMessage}</p>
        )}
      </div>
    </motion.div>
  );
}
