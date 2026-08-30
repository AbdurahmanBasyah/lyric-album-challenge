import { describe, expect, it, vi } from "vitest";

import type { FourLineLyricWindow, LyricWindowQualityConfig } from "@/types/game";
import type { TrackSummary } from "@/types/tracks";
import {
  LrclibError,
  type LrclibTrackRecord,
} from "./client";
import {
  getEligibleLrclibLyrics,
  resolveLrclibLyrics,
  type LrclibPipelineOptions,
} from "./pipeline";

const track: TrackSummary = {
  spotifyId: "spotify-track-id",
  name: "Pipeline Track",
  artistNames: ["Pipeline Artist"],
  durationMs: 200_000,
};

const syncedLyrics = [
  "[00:01.00] First line with enough words to recognize",
  "[00:05.00] Second line carries another useful phrase",
  "[00:09.00] Third line gives the memory a clear anchor",
  "[00:13.00] Fourth line completes this lyric fragment",
  "[00:17.00] Fifth line keeps a second window available",
].join("\n");

const record: LrclibTrackRecord = {
  id: 42,
  trackName: "Pipeline Track",
  artistName: "Pipeline Artist",
  albumName: "Pipeline Album",
  duration: 200,
  instrumental: false,
  syncedLyrics,
};

const options: LrclibPipelineOptions = {
  clientIdentifier: "fillthelyrics-test/1.0 (test)",
};

function lookupReturning(value: LrclibTrackRecord | null) {
  return vi.fn(async () => value);
}

function permissiveQualityConfig(): Partial<LyricWindowQualityConfig> {
  return {
    minTotalWordCount: 0,
    minUniqueWordCount: 0,
    minContentWordCount: 0,
    maxFillerRatio: 1,
    minLexicalDiversity: 0,
    minUniqueLineCount: 0,
  };
}

describe("LRCLIB lyric pipeline", () => {
  it("returns parsed lines and eligible windows in source order", async () => {
    const lookup = lookupReturning(record);
    const result = await resolveLrclibLyrics(
      track,
      { ...options, qualityConfig: permissiveQualityConfig() },
      { lookup },
    );

    expect(result.status).toBe("eligible");
    if (result.status !== "eligible") {
      return;
    }

    expect(result.lines).toHaveLength(5);
    expect(result.lines[0]).toEqual({
      timestampMs: 1_000,
      text: "First line with enough words to recognize",
    });
    expect(result.candidateWindows).toHaveLength(2);
    expect(result.candidateWindows[0]?.[0]?.text).toContain("First line");
    expect(result.candidateWindows[1]?.[0]?.text).toContain("Second line");
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("returns a typed not-found miss for a null lookup", async () => {
    const result = await resolveLrclibLyrics(
      track,
      options,
      { lookup: lookupReturning(null) },
    );

    expect(result).toEqual({ status: "miss", reason: "not_found" });
  });

  it("short-circuits instrumental records before matching or parsing", async () => {
    const result = await resolveLrclibLyrics(
      track,
      options,
      {
        lookup: lookupReturning({ ...record, instrumental: true, syncedLyrics: "not LRC" }),
      },
    );

    expect(result).toEqual({ status: "miss", reason: "instrumental" });
  });

  it.each([null, "", "   "])(
    "returns no_synced_lyrics for %s",
    async (synced) => {
      const result = await resolveLrclibLyrics(
        track,
        options,
        { lookup: lookupReturning({ ...record, syncedLyrics: synced }) },
      );

      expect(result).toEqual({ status: "miss", reason: "no_synced_lyrics" });
    },
  );

  it("rejects metadata mismatches before touching malformed lyric text", async () => {
    const result = await resolveLrclibLyrics(
      track,
      options,
      {
        lookup: lookupReturning({
          ...record,
          trackName: "Other Track",
          syncedLyrics: "[not-a-timestamp] provider lyric detail",
        }),
      },
    );

    expect(result).toEqual({ status: "miss", reason: "metadata_mismatch" });
  });

  it("distinguishes invalid LRC from too few parsed lines", async () => {
    const invalid = await resolveLrclibLyrics(
      track,
      options,
      { lookup: lookupReturning({ ...record, syncedLyrics: "not LRC" }) },
    );
    const tooFew = await resolveLrclibLyrics(
      track,
      options,
      {
        lookup: lookupReturning({
          ...record,
          syncedLyrics: "[00:01.00] one\n[00:02.00] two\n[00:03.00] three",
        }),
      },
    );

    expect(invalid).toEqual({ status: "miss", reason: "invalid_lrc" });
    expect(tooFew).toEqual({ status: "miss", reason: "insufficient_lines" });
  });

  it("returns no_eligible_window when every generated window is weak", async () => {
    const weak = await resolveLrclibLyrics(
      track,
      options,
      {
        lookup: lookupReturning({
          ...record,
          syncedLyrics: [
            "[00:01.00] Oh",
            "[00:02.00] Yeah",
            "[00:03.00] Oh",
            "[00:04.00] Yeah",
          ].join("\n"),
        }),
      },
    );

    expect(weak).toEqual({ status: "miss", reason: "no_eligible_window" });
  });

  it("supports a caller quality config without changing the shared heuristic", async () => {
    const result = await resolveLrclibLyrics(
      track,
      { ...options, qualityConfig: permissiveQualityConfig() },
      {
        lookup: lookupReturning({
          ...record,
          syncedLyrics: [
            "[00:01.00] one",
            "[00:02.00] two",
            "[00:03.00] three",
            "[00:04.00] four",
          ].join("\n"),
        }),
      },
    );

    expect(result.status).toBe("eligible");
    if (result.status === "eligible") {
      expect(result.candidateWindows).toHaveLength(1);
    }
  });

  it("propagates typed provider errors without rewriting them", async () => {
    const providerError = new LrclibError("rate_limited", {
      retryAfterSeconds: 12,
    });
    const lookup = vi.fn(async () => {
      throw providerError;
    });

    await expect(
      resolveLrclibLyrics(track, options, { lookup }),
    ).rejects.toBe(providerError);
  });

  it("uses one lookup and remains deterministic across repeated calls", async () => {
    const lookup = lookupReturning(record);
    const first = await getEligibleLrclibLyrics(
      track,
      { ...options, qualityConfig: permissiveQualityConfig() },
      { lookup },
    );
    const second = await getEligibleLrclibLyrics(
      track,
      { ...options, qualityConfig: permissiveQualityConfig() },
      { lookup },
    );

    expect(first).toEqual(second);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("freezes result containers and does not mutate the input track", async () => {
    const input = {
      ...track,
      artistNames: [...track.artistNames],
    };
    const before = structuredClone(input);
    const result = await resolveLrclibLyrics(
      input,
      { ...options, qualityConfig: permissiveQualityConfig() },
      { lookup: lookupReturning(record) },
    );

    expect(input).toEqual(before);
    expect(Object.isFrozen(result)).toBe(true);
    if (result.status === "eligible") {
      expect(Object.isFrozen(result.lines)).toBe(true);
      expect(Object.isFrozen(result.candidateWindows)).toBe(true);
      expect(Object.isFrozen(result.candidateWindows[0])).toBe(true);
    }
  });

  it("keeps the result provider-neutral while retaining only synced lyric lines", async () => {
    const result = await resolveLrclibLyrics(
      track,
      { ...options, qualityConfig: permissiveQualityConfig() },
      { lookup: lookupReturning(record) },
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("Lyricsfile");
    expect(serialized).not.toContain("plainLyrics");
    expect(serialized).not.toContain('"id"');
    expect(serialized).not.toContain("spotify-track-id");
  });

  it("accepts a custom evaluator dependency for deterministic branch testing", async () => {
    const evaluateQuality = vi.fn(
      (
        window: FourLineLyricWindow,
        config?: Partial<LyricWindowQualityConfig>,
      ) => ({
        eligible: true,
        qualityScore: 100,
        metrics: {
          totalWordCount: 1,
          uniqueWordCount: 1,
          contentWordCount: 1,
          fillerWordCount: 0,
          fillerRatio: 0,
          lexicalDiversity: 1,
          uniqueLineCount: 4,
        },
        rejectionReasons: [],
        // Keep the injected function signature exercised without changing its
        // deterministic always-eligible behavior.
        ...(void window, void config, {}),
      }),
    );

    const result = await resolveLrclibLyrics(
      track,
      options,
      { lookup: lookupReturning(record), evaluateQuality },
    );

    expect(result.status).toBe("eligible");
    expect(evaluateQuality).toHaveBeenCalledTimes(2);
    expect(evaluateQuality.mock.calls[0]?.[0]).toHaveLength(4);
  });

  it("keeps candidate windows as four-line tuples", async () => {
    const result = await resolveLrclibLyrics(
      track,
      { ...options, qualityConfig: permissiveQualityConfig() },
      { lookup: lookupReturning(record) },
    );

    if (result.status !== "eligible") {
      throw new Error("Expected eligible result");
    }

    const firstWindow: FourLineLyricWindow | undefined =
      result.candidateWindows[0];
    expect(firstWindow).toHaveLength(4);
  });
});
