/**
 * The application-owned metadata required to look up one Spotify track's
 * lyrics.  Provider-specific track shapes are intentionally not represented
 * here.
 */
export type TrackSummary = Readonly<{
  spotifyId: string;
  name: string;
  artistNames: readonly string[];
  durationMs: number;
}>;
