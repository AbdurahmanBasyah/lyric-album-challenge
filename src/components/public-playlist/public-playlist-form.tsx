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

    // The landing page only validates/canonicalizes the source. Provider work
    // begins in ChallengeIntro after the navigation completes.
    const spotifyId = canonicalUrl.slice(canonicalUrl.lastIndexOf("/") + 1);
    const source: ChallengeSourceContext = {
      kind: "public-playlist",
      spotifyId,
      canonicalUrl,
    };

    setValue(canonicalUrl);
    setPhase("navigating");
    setStatusMessage("Opening challenge setup…");
    submittingRef.current = true;

    try {
      router.replace(createChallengeIntroUrl(source));
    } catch {
      // A navigation failure is recoverable and is not a provider error.
      setPhase("idle");
      setStatusMessage("We couldn't open setup. Please try again.");
    } finally {
      submittingRef.current = false;
    }
  };

  const hasError = phase === "invalid";
  const isNavigating = phase === "navigating";
  const buttonLabel = isNavigating ? "Opening setup…" : "Play this playlist";

  return (
    <motion.div
      className="ftl-import-form-wrap import-form-wrap"
      initial={{ opacity: 1, y: prefersReducedMotion ? 0 : 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.32, ease: "easeOut" }}
    >
      <form
        id="public-playlist-form"
        className="ftl-import-form playlist-form"
        onSubmit={submit}
        aria-busy={isNavigating}
      >
        <label className="ftl-import-label playlist-label" htmlFor={PUBLIC_PLAYLIST_URL_INPUT_ID}>
          Public Spotify playlist link
        </label>
        <div className="ftl-import-input-row playlist-input-row">
          <input
            ref={inputRef}
            className="ftl-import-input playlist-input"
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
              if (!isNavigating) {
                setPhase("idle");
                setStatusMessage("");
              }
            }}
            aria-invalid={hasError}
            aria-describedby={`${PUBLIC_PLAYLIST_URL_INPUT_ID}-help ${PUBLIC_PLAYLIST_STATUS_ID}`}
            aria-errormessage={hasError ? PUBLIC_PLAYLIST_STATUS_ID : undefined}
            disabled={isNavigating}
          />
          <button
            className="ftl-import-submit playlist-submit"
            type="submit"
            disabled={isNavigating}
            aria-busy={isNavigating}
          >
            {buttonLabel}
            <span aria-hidden="true" className="ftl-import-submit__arrow">
              →
            </span>
          </button>
        </div>
        <p id={`${PUBLIC_PLAYLIST_URL_INPUT_ID}-help`} className="ftl-import-help cta-status">
          Canonical open.spotify.com playlist links only.
        </p>
      </form>

      <div
        id={PUBLIC_PLAYLIST_STATUS_ID}
        className="ftl-import-feedback form-feedback"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {phase === "invalid" && (
          <p className="ftl-import-error form-error" role="alert">
            {INVALID_URL_MESSAGE}
          </p>
        )}
        {statusMessage && phase !== "invalid" && (
          <p className="ftl-import-status form-status">{statusMessage}</p>
        )}
      </div>
    </motion.div>
  );
}
