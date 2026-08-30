import type {
  FourLineLyricWindow,
  LyricWindowQualityConfig,
  SyncedLyricLine,
} from "@/types/game";
import { parseLrc } from "../game/lrc";
import { generateFourLineWindows } from "../game/lyric-window";
import {
  DEFAULT_LYRIC_WINDOW_QUALITY_CONFIG,
  evaluateLyricWindowQuality,
} from "../game/lyric-window-quality";
import type { TrackSummary } from "../../types/tracks";

import {
  getLrclibTrack,
  type LrclibClientOptions,
  type LrclibFetch,
  type LrclibTrackRecord,
} from "./client";
import { matchLrclibTrack } from "./matching";

export type LrclibLyricsMissReason =
  | "not_found"
  | "metadata_mismatch"
  | "instrumental"
  | "no_synced_lyrics"
  | "invalid_lrc"
  | "insufficient_lines"
  | "no_eligible_window";

export type LrclibLyricsResult =
  | Readonly<{
      status: "eligible";
      lines: readonly SyncedLyricLine[];
      candidateWindows: readonly FourLineLyricWindow[];
    }>
  | Readonly<{
      status: "miss";
      reason: LrclibLyricsMissReason;
    }>;

export type LrclibPipelineDependencies = Readonly<{
  lookup?: (
    track: TrackSummary,
    options: LrclibClientOptions,
  ) => Promise<LrclibTrackRecord | null>;
  evaluateQuality?: typeof evaluateLyricWindowQuality;
}>;

export type LrclibPipelineOptions = Readonly<
  LrclibClientOptions & {
    qualityConfig?: Partial<LyricWindowQualityConfig>;
  }
>;

const EMPTY_LINES = "";

function miss(reason: LrclibLyricsMissReason): LrclibLyricsResult {
  return Object.freeze({ status: "miss" as const, reason });
}

function freezeLine(line: SyncedLyricLine): SyncedLyricLine {
  return Object.freeze({
    timestampMs: line.timestampMs,
    text: line.text,
  });
}

function freezeWindow(window: FourLineLyricWindow): FourLineLyricWindow {
  return Object.freeze(window.map(freezeLine)) as unknown as FourLineLyricWindow;
}

function createEligibleResult(
  lines: readonly SyncedLyricLine[],
  windows: readonly FourLineLyricWindow[],
): LrclibLyricsResult {
  return Object.freeze({
    status: "eligible" as const,
    lines: Object.freeze(lines.map(freezeLine)),
    candidateWindows: Object.freeze(windows.map(freezeWindow)),
  });
}

/**
 * Resolves one track into parsed synced lyrics and quality-approved candidate
 * windows. Provider records and non-synced lyric fields never cross this
 * boundary; provider errors are deliberately allowed to retain their typed
 * category by propagating unchanged.
 */
export async function resolveLrclibLyrics(
  track: TrackSummary,
  options: LrclibPipelineOptions,
  dependencies: LrclibPipelineDependencies = {},
): Promise<LrclibLyricsResult> {
  const lookup = dependencies.lookup ?? getLrclibTrack;
  const record = await lookup(track, options);

  if (record === null) {
    return miss("not_found");
  }

  if (record.instrumental) {
    return miss("instrumental");
  }

  if (!matchLrclibTrack(track, record).matched) {
    return miss("metadata_mismatch");
  }

  const syncedLyrics = record.syncedLyrics;

  if (syncedLyrics === null || syncedLyrics.trim() === EMPTY_LINES) {
    return miss("no_synced_lyrics");
  }

  const lines = parseLrc(syncedLyrics);

  if (lines.length === 0) {
    return miss("invalid_lrc");
  }

  if (lines.length < 4) {
    return miss("insufficient_lines");
  }

  const windows = generateFourLineWindows(lines);
  const evaluateQuality =
    dependencies.evaluateQuality ?? evaluateLyricWindowQuality;
  const qualityConfig =
    options.qualityConfig ?? DEFAULT_LYRIC_WINDOW_QUALITY_CONFIG;
  const eligibleWindows = windows.filter(
    (window) => evaluateQuality(window, qualityConfig).eligible,
  );

  if (eligibleWindows.length === 0) {
    return miss("no_eligible_window");
  }

  return createEligibleResult(lines, eligibleWindows);
}

/** Descriptive alias for callers that prefer an eligibility-oriented name. */
export const getEligibleLrclibLyrics = resolveLrclibLyrics;

/** Type-only export keeps the client dependency visible to consumers/tests. */
export type { LrclibFetch };
