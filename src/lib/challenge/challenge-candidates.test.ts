import { describe, expect, it, vi } from "vitest";

import type { FourLineLyricWindow, SyncedLyricLine } from "../../types/game";
import type { TrackSummary } from "../../types/tracks";
import { seededShuffle } from "../game/seeded-random";
import type {
  LrclibLyricsResult,
  LrclibPipelineOptions,
} from "../lrclib/pipeline";
import {
  buildChallengeCandidates,
  ChallengeCandidateError,
  DEFAULT_CHALLENGE_TARGET_COUNT,
  MAX_LYRIC_TRACKS_TO_SCAN,
  type ChallengeCandidateDependencies,
} from "./challenge-candidates";
import type {
  ChallengeSource,
  SourceTrackCollection,
} from "./source-tracks";

const source: ChallengeSource = {
  kind: "album",
  spotifyId: "album-id",
  name: "Fixture Album",
};

const lyricsOptions: LrclibPipelineOptions = {
  clientIdentifier: "fillthelyrics-test/1.0 (candidate-tests)",
};

function makeTrack(index: number): TrackSummary {
  return {
    spotifyId: `track-${index}`,
    name: `Track ${index}`,
    artistNames: [`Artist ${index}`],
    durationMs: 180_000 + index,
  };
}

function makeWindow(label: string, offset = 0): FourLineLyricWindow {
  return [0, 1, 2, 3].map((lineIndex) => ({
    timestampMs: offset + lineIndex * 1_000,
    text: `${label} lyric line ${lineIndex}`,
  })) as FourLineLyricWindow;
}

function eligible(
  windows: readonly FourLineLyricWindow[] = [makeWindow("selected")],
): LrclibLyricsResult {
  return {
    status: "eligible",
    lines: [
      { timestampMs: 0, text: "full source line one" },
      { timestampMs: 1_000, text: "full source line two" },
      { timestampMs: 2_000, text: "full source line three" },
      { timestampMs: 3_000, text: "full source line four" },
      { timestampMs: 4_000, text: "line outside selected window" },
    ],
    candidateWindows: windows,
  };
}

function miss(reason: "not_found" | "no_eligible_window" = "not_found"): LrclibLyricsResult {
  return { status: "miss", reason };
}

function collection(
  tracks: readonly TrackSummary[],
  sourceTruncated = false,
): SourceTrackCollection {
  return {
    tracks,
    pagesFetched: 1,
    sourceTruncated,
  };
}

function dependenciesFor(
  tracks: readonly TrackSummary[],
  resolve: ChallengeCandidateDependencies["resolveLrclibLyrics"] = async () => eligible(),
  sourceTruncated = false,
) {
  const collectSourceTracks = vi.fn(async () =>
    collection(tracks, sourceTruncated),
  );
  const resolveLrclibLyrics = vi.fn(resolve);

  return {
    dependencies: { collectSourceTracks, resolveLrclibLyrics },
    collectSourceTracks,
    resolveLrclibLyrics,
  };
}

function buildInput(
  dependencies: ChallengeCandidateDependencies,
  overrides: Record<string, unknown> = {},
) {
  return {
    source,
    accessToken: "server-token-that-must-not-leak",
    seed: "fixture-seed",
    lyricsOptions,
    dependencies,
    ...overrides,
  };
}

function candidateIds(result: Awaited<ReturnType<typeof buildChallengeCandidates>>): string[] {
  return result.candidates.map((candidate) => candidate.track.spotifyId);
}

describe("challenge candidate construction", () => {
  it("supports an anonymous public-playlist collector without an access token", async () => {
    const publicSource = {
      kind: "public-playlist" as const,
      spotifyId: "playlist-1",
      canonicalUrl: "https://open.spotify.com/playlist/playlist-1",
    };
    const track = makeTrack(1);
    const collectPublicPlaylistTracks = vi.fn(async ({ source }: { source: typeof publicSource }) => {
      expect(source).toEqual(publicSource);
      return collection([track]);
    });
    const resolveLrclibLyrics = vi.fn(async () => eligible());

    const result = await buildChallengeCandidates({
      source: publicSource,
      seed: "public-seed",
      targetCount: 1,
      lyricsOptions,
      dependencies: {
        collectPublicPlaylistTracks,
        resolveLrclibLyrics,
      },
    });

    expect(result.status).toBe("ready");
    expect(result.candidates).toHaveLength(1);
    expect(collectPublicPlaylistTracks).toHaveBeenCalledTimes(1);
    expect(collectPublicPlaylistTracks.mock.calls[0]?.[0]).toEqual({
      source: publicSource,
    });
    expect(resolveLrclibLyrics).toHaveBeenCalledWith(track, lyricsOptions);
  });

  it("collects through the injected source boundary and returns a reduced candidate", async () => {
    const track = makeTrack(1);
    const { dependencies, collectSourceTracks, resolveLrclibLyrics } = dependenciesFor(
      [track],
    );

    const result = await buildChallengeCandidates(buildInput(dependencies));

    expect(result.status).toBe("ready");
    expect(collectSourceTracks).toHaveBeenCalledWith({
      source,
      accessToken: "server-token-that-must-not-leak",
    });
    expect(resolveLrclibLyrics).toHaveBeenCalledWith(track, lyricsOptions);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toEqual({
      track,
      window: makeWindow("selected"),
    });
    expect(result.candidates[0]).not.toHaveProperty("lines");
    expect(result.candidates[0]).not.toHaveProperty("candidateWindows");
  });

  it("uses the exact track and per-track window seed namespaces", async () => {
    const tracks = [makeTrack(1), makeTrack(2), makeTrack(3)];
    const windows = [makeWindow("first"), makeWindow("second"), makeWindow("third")];
    const { dependencies, resolveLrclibLyrics } = dependenciesFor(
      tracks,
      async () => eligible(windows),
    );

    const result = await buildChallengeCandidates({
      ...buildInput(dependencies),
      seed: "namespace-seed",
      targetCount: 1,
    });

    const expectedTrack = seededShuffle(tracks, "namespace-seed:tracks")[0];
    const expectedWindow = seededShuffle(
      windows,
      `namespace-seed:track:${expectedTrack?.spotifyId}:window`,
    )[0];

    expect(resolveLrclibLyrics).toHaveBeenCalledTimes(1);
    expect(resolveLrclibLyrics.mock.calls[0]?.[0]).toEqual(expectedTrack);
    expect(result.candidates[0]?.window).toEqual(expectedWindow);
  });

  it("is deterministic for the same source and seed while allowing seed variation", async () => {
    const tracks = [makeTrack(1), makeTrack(2), makeTrack(3), makeTrack(4)];
    const firstDependencies = dependenciesFor(tracks);
    const secondDependencies = dependenciesFor(tracks);
    const differentSeedDependencies = dependenciesFor(tracks);

    const first = await buildChallengeCandidates(buildInput(firstDependencies.dependencies));
    const second = await buildChallengeCandidates(buildInput(secondDependencies.dependencies));
    const different = await buildChallengeCandidates({
      ...buildInput(differentSeedDependencies.dependencies),
      seed: "different-fixture-seed",
    });

    expect(first).toEqual(second);
    expect(candidateIds(first)).toEqual(
      seededShuffle(tracks, "fixture-seed:tracks").map((track) => track.spotifyId),
    );
    expect(candidateIds(different)).toEqual(
      seededShuffle(tracks, "different-fixture-seed:tracks").map(
        (track) => track.spotifyId,
      ),
    );
    expect(candidateIds(first)).not.toEqual(candidateIds(different));
  });

  it("deduplicates track IDs defensively while retaining the first occurrence", async () => {
    const first = makeTrack(1);
    const duplicate = { ...first, name: "duplicate metadata" };
    const second = makeTrack(2);
    const { dependencies, resolveLrclibLyrics } = dependenciesFor([
      first,
      duplicate,
      second,
    ]);

    const result = await buildChallengeCandidates({
      ...buildInput(dependencies),
      targetCount: 5,
    });

    expect(resolveLrclibLyrics).toHaveBeenCalledTimes(2);
    expect(candidateIds(result)).toHaveLength(2);
    expect(result.candidates).toContainEqual(
      expect.objectContaining({ track: first }),
    );
    expect(result.candidates).not.toContainEqual(
      expect.objectContaining({ track: duplicate }),
    );
  });

  it("skips typed lyric misses and retains later eligible tracks", async () => {
    const tracks = [makeTrack(1), makeTrack(2), makeTrack(3)];
    const { dependencies, resolveLrclibLyrics } = dependenciesFor(
      tracks,
      async (track) =>
        track.spotifyId === "track-2" ? miss("no_eligible_window") : eligible(),
    );

    const result = await buildChallengeCandidates({
      ...buildInput(dependencies),
      targetCount: 2,
    });

    expect(result.status).toBe("ready");
    expect(result.candidates).toHaveLength(2);
    expect(resolveLrclibLyrics).toHaveBeenCalledTimes(3);
    expect(candidateIds(result)).not.toContain("track-2");
  });

  it("defaults to five candidates and never scans past the requested target", async () => {
    const tracks = Array.from({ length: 8 }, (_, index) => makeTrack(index + 1));
    const { dependencies, resolveLrclibLyrics } = dependenciesFor(tracks);

    const result = await buildChallengeCandidates(buildInput(dependencies));

    expect(DEFAULT_CHALLENGE_TARGET_COUNT).toBe(5);
    expect(result.status).toBe("ready");
    expect(result.candidates).toHaveLength(5);
    expect(resolveLrclibLyrics).toHaveBeenCalledTimes(5);
    expect(result.tracksScanned).toBe(5);
  });

  it("supports a target from one through five and rejects larger targets", async () => {
    const tracks = Array.from({ length: 6 }, (_, index) => makeTrack(index + 1));
    const { dependencies } = dependenciesFor(tracks);

    const result = await buildChallengeCandidates({
      ...buildInput(dependencies),
      targetCount: 1,
    });
    expect(result.status).toBe("ready");
    expect(result.candidates).toHaveLength(1);

    await expect(
      buildChallengeCandidates(buildInput(dependencies, { targetCount: 6 })),
    ).rejects.toMatchObject({
      name: "ChallengeCandidateError",
      kind: "invalid_target",
    });
  });

  it("enforces the exact twenty-five-track lyric lookup cap", async () => {
    const tracks = Array.from({ length: 30 }, (_, index) => makeTrack(index + 1));
    const { dependencies, resolveLrclibLyrics } = dependenciesFor(
      tracks,
      async () => miss(),
    );

    const result = await buildChallengeCandidates({
      ...buildInput(dependencies),
      targetCount: 5,
    });

    expect(result).toMatchObject({
      status: "insufficient_lyrics",
      tracksScanned: MAX_LYRIC_TRACKS_TO_SCAN,
      lyricScanLimitReached: true,
    });
    expect(resolveLrclibLyrics).toHaveBeenCalledTimes(MAX_LYRIC_TRACKS_TO_SCAN);
  });

  it("does not claim scan truncation when exactly twenty-five tracks exhaust the source", async () => {
    const tracks = Array.from({ length: MAX_LYRIC_TRACKS_TO_SCAN }, (_, index) =>
      makeTrack(index + 1),
    );
    const { dependencies } = dependenciesFor(tracks, async () => miss());

    const result = await buildChallengeCandidates(buildInput(dependencies));

    expect(result.status).toBe("insufficient_lyrics");
    expect(result.lyricScanLimitReached).toBe(false);
  });

  it("returns a shorter ready result for one to four eligible tracks", async () => {
    const tracks = [makeTrack(1), makeTrack(2), makeTrack(3), makeTrack(4)];
    const { dependencies } = dependenciesFor(tracks);

    const result = await buildChallengeCandidates(buildInput(dependencies));

    expect(result.status).toBe("ready");
    expect(result.candidates).toHaveLength(4);
    expect(result.lyricScanLimitReached).toBe(false);
  });

  it("returns insufficient_lyrics only when no track is eligible", async () => {
    const tracks = [makeTrack(1), makeTrack(2)];
    const { dependencies } = dependenciesFor(tracks, async () => miss());

    const result = await buildChallengeCandidates(buildInput(dependencies));

    expect(result).toEqual({
      status: "insufficient_lyrics",
      candidates: [],
      tracksScanned: 2,
      sourceTruncated: false,
      lyricScanLimitReached: false,
    });
  });

  it("preserves source truncation metadata", async () => {
    const { dependencies } = dependenciesFor([makeTrack(1)], async () => miss(), true);

    const result = await buildChallengeCandidates(buildInput(dependencies));

    expect(result.sourceTruncated).toBe(true);
  });

  it("propagates source and lyric provider errors by identity", async () => {
    const sourceError = new Error("provider body must not be surfaced");
    const sourceDependencies = {
      collectSourceTracks: vi.fn(async () => {
        throw sourceError;
      }),
      resolveLrclibLyrics: vi.fn(async () => eligible()),
    };
    await expect(
      buildChallengeCandidates(buildInput(sourceDependencies)),
    ).rejects.toBe(sourceError);

    const lyricError = new Error("provider response must not be surfaced");
    const lyricDependencies = dependenciesFor([makeTrack(1)], async () => {
      throw lyricError;
    });
    await expect(
      buildChallengeCandidates(buildInput(lyricDependencies.dependencies)),
    ).rejects.toBe(lyricError);
  });

  it("validates seed, target, source, token, and options before dependency calls", async () => {
    const dependencies = dependenciesFor([makeTrack(1)]);
    const cases = [
      { seed: "   " },
      { targetCount: 0 },
      { targetCount: 1.5 },
      { source: { kind: "artist", spotifyId: "artist-id" } },
      { accessToken: "\nsecret" },
      { lyricsOptions: { clientIdentifier: "" } },
    ];

    for (const overrides of cases) {
      await expect(
        buildChallengeCandidates(buildInput(dependencies.dependencies, overrides)),
      ).rejects.toBeInstanceOf(ChallengeCandidateError);
    }

    expect(dependencies.collectSourceTracks).not.toHaveBeenCalled();
    expect(dependencies.resolveLrclibLyrics).not.toHaveBeenCalled();
  });

  it("does not mutate injected source or lyrics results and recursively freezes output", async () => {
    const track = makeTrack(1);
    const inputTrack = { ...track, artistNames: [...track.artistNames] };
    const inputCollection = collection([inputTrack]);
    const lyricResult = eligible([makeWindow("one"), makeWindow("two", 4_000)]);
    const beforeTrack = structuredClone(inputTrack);
    const beforeLyrics = structuredClone(lyricResult);
    const collectSourceTracks = vi.fn(async () => inputCollection);
    const resolveLrclibLyrics = vi.fn(async () => lyricResult);

    const result = await buildChallengeCandidates(
      buildInput({ collectSourceTracks, resolveLrclibLyrics }),
    );

    expect(inputTrack).toEqual(beforeTrack);
    expect(lyricResult).toEqual(beforeLyrics);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.candidates)).toBe(true);
    expect(Object.isFrozen(result.candidates[0])).toBe(true);
    expect(Object.isFrozen(result.candidates[0]?.track)).toBe(true);
    expect(Object.isFrozen(result.candidates[0]?.track.artistNames)).toBe(true);
    expect(Object.isFrozen(result.candidates[0]?.window)).toBe(true);
    expect(Object.isFrozen(result.candidates[0]?.window[0])).toBe(true);
  });

  it("does not expose credentials, provider records, all lines, or all windows", async () => {
    const track = makeTrack(1);
    const providerRecord = {
      id: 999,
      trackName: "Track 1",
      artistName: "Artist 1",
      albumName: "Fixture Album",
      duration: 180,
      instrumental: false,
      syncedLyrics: "provider full lyric payload",
      plainLyrics: "must not cross boundary",
    };
    const { dependencies } = dependenciesFor([track], async () => ({
      ...eligible([makeWindow("selected"), makeWindow("other", 4_000)]),
      providerRecord,
    }) as unknown as LrclibLyricsResult);

    const result = await buildChallengeCandidates(buildInput(dependencies));
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("server-token-that-must-not-leak");
    expect(serialized).not.toContain("provider full lyric payload");
    expect(serialized).not.toContain("must not cross boundary");
    expect(serialized).not.toContain("full source line one");
    expect(
      serialized.includes("selected lyric line") !==
        serialized.includes("other lyric line"),
    ).toBe(true);
    expect(serialized).not.toContain("candidateWindows");
    expect(serialized).not.toContain("providerRecord");
  });

  it("keeps the selected window as exactly four synced lines", async () => {
    const lines: SyncedLyricLine[] = [
      { timestampMs: 1_000, text: "one" },
      { timestampMs: 2_000, text: "two" },
      { timestampMs: 3_000, text: "three" },
      { timestampMs: 4_000, text: "four" },
    ];
    const { dependencies } = dependenciesFor([makeTrack(1)], async () =>
      eligible([lines as FourLineLyricWindow]),
    );

    const result = await buildChallengeCandidates(buildInput(dependencies));

    expect(result.candidates[0]?.window).toHaveLength(4);
    expect(result.candidates[0]?.window.map((line) => line.text)).toEqual([
      "one",
      "two",
      "three",
      "four",
    ]);
  });
});
