import { describe, expect, it } from "vitest";

import {
  evaluateLrclibMatch,
  LRCLIB_DURATION_TOLERANCE_MS,
  matchLrclibTrack,
  normalizeMatchMetadata,
  type LrclibMatchResult,
} from "./matching";
import type { LrclibTrackRecord } from "./client";
import type { TrackSummary } from "@/types/tracks";

const spotifyTrack: TrackSummary = {
  spotifyId: "spotify-track-id",
  name: "  We\u2019re Here  ",
  artistNames: [" Primary Artist ", "Featured Artist"],
  durationMs: 201_230,
};

const lrclibTrack: LrclibTrackRecord = {
  id: 123,
  trackName: "We're Here",
  artistName: "Primary Artist",
  albumName: "Album Edition",
  duration: 201.23,
  instrumental: false,
  syncedLyrics: null,
};

function result(overrides: Partial<LrclibTrackRecord> = {}) {
  return { ...lrclibTrack, ...overrides };
}

describe("normalizeMatchMetadata", () => {
  it("applies NFKC, apostrophe normalization, case normalization, and whitespace folding", () => {
    expect(
      normalizeMatchMetadata(
        "  \uFF37\uFF25\u2019\uFF32\uFF25\t  HERE\u00A0 ",
      ),
    ).toBe("we're here");
    expect(normalizeMatchMetadata("rock\u2019n\u02BCroll")).toBe(
      "rock'n'roll",
    );
  });

  it("preserves punctuation, diacritics, featured labels, and version labels", () => {
    expect(normalizeMatchMetadata("  Rock'n'R\u00F6ll!  ")).toBe(
      "rock'n'r\u00F6ll!",
    );
    expect(normalizeMatchMetadata("Artist feat. Guest (Remastered)")).toBe(
      "artist feat. guest (remastered)",
    );
    expect(normalizeMatchMetadata("cafe\u0301")).toBe("caf\u00E9");
  });

  it("rejects non-string values rather than coercing metadata", () => {
    expect(() => normalizeMatchMetadata(42 as unknown as string)).toThrow(
      /must be a string/i,
    );
  });
});

describe("matchLrclibTrack", () => {
  it("matches normalized exact title, primary artist, and duration", () => {
    const evaluated = matchLrclibTrack(spotifyTrack, lrclibTrack);

    expect(evaluated).toEqual({
      matched: true,
      reason: "match",
      durationDifferenceMs: 0,
    });
    expect(Object.isFrozen(evaluated)).toBe(true);
  });

  it("uses only the first Spotify artist for identity", () => {
    expect(
      matchLrclibTrack(
        spotifyTrack,
        result({ artistName: "Featured Artist" }),
      ),
    ).toMatchObject({ matched: false, reason: "artist_mismatch" });
  });

  it("keeps punctuation and version labels exact", () => {
    expect(
      matchLrclibTrack(
        { ...spotifyTrack, name: "Track (Remastered)" },
        result({ trackName: "Track" }),
      ),
    ).toMatchObject({ matched: false, reason: "track_mismatch" });

    expect(
      matchLrclibTrack(
        { ...spotifyTrack, artistNames: ["Artist feat. Guest"] },
        result({ artistName: "Artist" }),
      ),
    ).toMatchObject({ matched: false, reason: "artist_mismatch" });
  });

  it("accepts the inclusive two-second duration boundary", () => {
    const under = matchLrclibTrack(
      spotifyTrack,
      result({ duration: (spotifyTrack.durationMs - LRCLIB_DURATION_TOLERANCE_MS) / 1000 }),
    );
    const over = matchLrclibTrack(
      spotifyTrack,
      result({ duration: (spotifyTrack.durationMs + LRCLIB_DURATION_TOLERANCE_MS) / 1000 }),
    );

    expect(under).toMatchObject({
      matched: true,
      reason: "match",
      durationDifferenceMs: LRCLIB_DURATION_TOLERANCE_MS,
    });
    expect(over).toMatchObject({
      matched: true,
      reason: "match",
      durationDifferenceMs: LRCLIB_DURATION_TOLERANCE_MS,
    });
  });

  it("rejects durations outside tolerance", () => {
    const evaluated = matchLrclibTrack(
      spotifyTrack,
      result({ duration: (spotifyTrack.durationMs + 2_001) / 1000 }),
    );

    expect(evaluated).toEqual({
      matched: false,
      reason: "duration_mismatch",
      durationDifferenceMs: 2_001,
    });
  });

  it.each([
    [Number.NaN, "not-a-number"],
    [Number.POSITIVE_INFINITY, "infinite"],
    [0, "zero"],
    [-1, "negative"],
  ])("rejects invalid Spotify duration (%s: %s)", (durationMs) => {
    const evaluated = matchLrclibTrack(
      { ...spotifyTrack, durationMs },
      lrclibTrack,
    );

    expect(evaluated).toEqual({
      matched: false,
      reason: "duration_mismatch",
      durationDifferenceMs: null,
    });
  });

  it.each([
    [Number.NaN, "not-a-number"],
    [Number.POSITIVE_INFINITY, "infinite"],
    [0, "zero"],
    [-1, "negative"],
  ])("rejects invalid LRCLIB duration (%s: %s)", (duration) => {
    const evaluated = matchLrclibTrack(
      spotifyTrack,
      result({ duration }),
    );

    expect(evaluated).toEqual({
      matched: false,
      reason: "duration_mismatch",
      durationDifferenceMs: null,
    });
  });

  it("ignores private LRCLIB album metadata", () => {
    expect(
      matchLrclibTrack(
        spotifyTrack,
        result({ albumName: "Album Edition (Deluxe)" }),
      ),
    ).toEqual({
      matched: true,
      reason: "match",
      durationDifferenceMs: 0,
    });

    expect(
      matchLrclibTrack(
        spotifyTrack,
        result({ albumName: "  aLbUm eDiTiOn  " }),
      ),
    ).toEqual({
      matched: true,
      reason: "match",
      durationDifferenceMs: 0,
    });
  });

  it("rejects a missing or blank primary artist", () => {
    for (const artistNames of [[], ["   "], [undefined]]) {
      const evaluated = matchLrclibTrack(
        { ...spotifyTrack, artistNames: artistNames as readonly string[] },
        lrclibTrack,
      );

      expect(evaluated).toMatchObject({
        matched: false,
        reason: "artist_mismatch",
      });
    }
  });

  it("uses title, artist, then duration mismatch precedence", () => {
    const allMismatch = matchLrclibTrack(
      { ...spotifyTrack, name: "Different", artistNames: ["Other"] , durationMs: 1 },
      result({ trackName: "Another", artistName: "Yet Another", duration: 2 }),
    );
    expect(allMismatch.reason).toBe("track_mismatch");

    const artistAndDurationMismatch = matchLrclibTrack(
      { ...spotifyTrack, artistNames: ["Other"], durationMs: 1 },
      result({ artistName: "Yet Another", duration: 2 }),
    );
    expect(artistAndDurationMismatch.reason).toBe("artist_mismatch");

    const durationMismatch = matchLrclibTrack(
      { ...spotifyTrack, durationMs: 1 },
      result({ duration: 3 }),
    );
    expect(durationMismatch.reason).toBe("duration_mismatch");
  });

  it("does not mutate either input, including the Spotify artist array", () => {
    const track = {
      ...spotifyTrack,
      artistNames: [...spotifyTrack.artistNames],
    };
    const record = { ...lrclibTrack };
    const trackBefore = structuredClone(track);
    const recordBefore = structuredClone(record);

    matchLrclibTrack(track, record);

    expect(track).toEqual(trackBefore);
    expect(record).toEqual(recordBefore);
  });

  it("is deterministic across repeated evaluations and aliases", () => {
    const evaluations = Array.from({ length: 10 }, () =>
      matchLrclibTrack(spotifyTrack, lrclibTrack),
    );

    expect(evaluations).toEqual(Array.from({ length: 10 }, () => evaluations[0]));
    expect(evaluateLrclibMatch(spotifyTrack, lrclibTrack)).toEqual(evaluations[0]);
  });
});

describe("LrclibMatchResult", () => {
  it("contains only provider-neutral match facts", () => {
    const evaluated: LrclibMatchResult = matchLrclibTrack(
      spotifyTrack,
      lrclibTrack,
    );

    expect(Object.keys(evaluated)).toEqual([
      "matched",
      "reason",
      "durationDifferenceMs",
    ]);
    expect(JSON.stringify(evaluated)).not.toContain("syncedLyrics");
  });
});
