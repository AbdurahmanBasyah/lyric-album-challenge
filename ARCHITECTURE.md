# ARCHITECTURE.md

## System overview

```text
Browser
  |
  +--> public playlist URL
  |       (same-origin application route)
  |
  +--> Spotify OAuth (legacy library flow)
  v
Next.js application
  |
  +--> PublicPlaylistResolver (server-only)
  |      - strict Spotify playlist URL parser
  |      - fixed Spotify Embed (__NEXT_DATA__) resolver
  |      - minimal TrackSummary normalization
  |
  +--> Spotify Web API
  |      - current user authorization
  |      - saved albums
  |      - accessible playlists
  |      - album tracks / metadata
  |
  +--> LyricsProvider
         |
          +--> LRCLIB adapter
                - track/artist/duration matching
                - synced lyrics

Game engine
  - parse synced lyrics
  - build 4-line sliding windows
  - score lyric-window eligibility
  - select tracks/windows deterministically
  - tokenize lyric windows
  - create 4-attempt masking progression
  - compare hidden answer tokens
  - lock solved tokens
  - calculate bounded word/streak scores after challenge completion
```

## Architectural rule

Provider-specific response shapes must not leak into game components.

## Domain models

```ts
export type AlbumSummary = {
  spotifyId: string;
  name: string;
  artistNames: string[];
  imageUrl: string | null;
  totalTracks: number;
};

export type PlaylistSummary = {
  spotifyId: string;
  name: string;
  ownerName: string | null;
  imageUrl: string | null;
  totalItems: number;
  isPublic: boolean | null;
  spotifyUrl: string;
};

export type TrackSummary = {
  spotifyId: string;
  name: string;
  artistNames: string[];
  durationMs: number;
};

export type SyncedLyricLine = {
  timestampMs: number;
  text: string;
};

export type TokenState = 'hidden' | 'solved' | 'revealed' | 'static';

export type LyricToken = {
  id: string;
  lineIndex: number;
  tokenIndex: number;
  raw: string;
  normalized: string;
  isWord: boolean;
  state: TokenState;
};

export type LyricWindow = {
  lines: [SyncedLyricLine, SyncedLyricLine, SyncedLyricLine, SyncedLyricLine];
  startTimestampMs: number;
  tokens: LyricToken[];
  qualityScore: number;
};

export type AttemptNumber = 1 | 2 | 3 | 4;

export type QuestionProgress = {
  attempt: AttemptNumber;
  solvedTokenIds: string[];
  revealedTokenIds: string[];
  unresolvedTokenIds: string[];
};

export type ChallengeQuestion = {
  id: string;
  track: TrackSummary;
  window: LyricWindow;
  progress: QuestionProgress;
};

export type Challenge = {
  id: string;
  source:
    | { kind: 'album'; spotifyId: string; displayName: string }
    | { kind: 'playlist'; spotifyId: string; displayName?: string }
    | { kind: 'public-playlist'; spotifyId: string; canonicalUrl: string; displayName?: string };
  seed: string;
  questions: ChallengeQuestion[];
};
```

## Spotify authentication

Minimum permissions:

```text
user-library-read
playlist-read-private
playlist-read-collaborative
```

Spotify's saved-albums endpoint is `GET /me/albums` and is paginated. Keep provider pagination details inside the Spotify adapter.
Spotify's current-user playlist endpoint is `GET /me/playlists` and is also
paginated. Playlist discovery remains read-only; playlist item eligibility is
resolved by the later challenge pipeline.

Use an OAuth flow appropriate to the implementation boundary:

- PKCE for browser/public-client authorization where a secret cannot be protected.
- Authorization Code when the application has a trusted server that can safely hold the client secret.

Security requirements:

- verify OAuth `state`,
- protect PKCE verifier when PKCE is used,
- never log tokens or authorization codes,
- keep provider tokens out of arbitrary client state.

## Spotify integration boundaries

```ts
getSavedAlbums(cursor?: string): Promise<Page<AlbumSummary>>
getSavedPlaylists(cursor?: string): Promise<Page<PlaylistSummary>>
getAlbumTracks(albumId: string): Promise<TrackSummary[]>
```

UI components must not call Spotify endpoints directly.

The primary anonymous source is isolated behind a provider-neutral resolver:

```ts
type PublicPlaylistIdentity = {
  playlistId: string;
  canonicalUrl: string;
};

interface PublicPlaylistResolver {
  resolvePlaylist(
    input: string | PublicPlaylistIdentity,
  ): Promise<{
    spotifyId: string;
    canonicalUrl: string;
    name?: string;
    tracks: readonly TrackSummary[];
  }>;
}
```

The current server implementation fetches a fixed, allowlisted Spotify Embed
playlist document and extracts its server-rendered `__NEXT_DATA__` track data.
The browser never calls Spotify or the Embed origin directly, and the provider
DTO is not part of the UI contract. Normalization keeps only the fields the game
needs: `spotifyId`, `name`, `artistNames`, and bounded `durationMs`. Album and
track/disc-position metadata are intentionally not domain requirements. The
resolver drops entries missing required fields, duplicate, local, restricted,
unplayable, or otherwise unavailable records instead of fabricating values.

## Provider transport resilience and deployment

All idempotent provider GET adapters pass through the shared server-only retry
boundary in `src/lib/http/retry.ts`. It permits at most two total attempts,
retries only transient network/408/425/429/5xx responses, honors a bounded
`Retry-After`, and supports injected sleep/clock dependencies for deterministic
tests. Token exchange POSTs, aborts, permanent responses, and schema-invalid
success bodies are never retried. Final failures retain the adapter's existing
stable error categories and never include provider bodies.

`npm run audit:privacy` scans production source and generated client assets for
server-only credentials, raw lyrics/answers, provider response data, and
provider API URLs. The application is deployed as a Node.js server with
`npm run build`/`npm run start`; API responses remain `no-store`, environment
secrets stay server-only, and the process-local challenge store remains an
explicit MVP limitation.

## Lyrics provider

```ts
export interface LyricsProvider {
  getSyncedLyrics(track: TrackSummary): Promise<SyncedLyricLine[] | null>;
}
```

LRCLIB is the first adapter, not a permanent architectural assumption.

Matching priority:

1. track name,
2. primary artist,
3. duration sanity check.

Album metadata may remain inside a provider-private LRCLIB response record, but
it is not requested from the public Spotify Embed source and is not a
`TrackSummary` match gate.

## YouTube candidate resolver

The optional M7C resolver is a server-only preparation seam for post-reveal
listening; it is not part of challenge creation or gameplay. It accepts the existing
`TrackSummary`, calls only fixed official YouTube Data API v3 endpoints, and
returns a reduced provider-neutral result:

```ts
type YouTubeResolution =
  | {
      status: "resolved";
      videoId: string;
      confidence: number;
      durationMs: number;
      durationDifferenceMs: number;
    }
  | { status: "unavailable"; reason: string };
```

Search is bounded to two queries of five results per track, followed by one
details lookup of at most ten IDs. The adapter validates duration, privacy,
upload status, and `status.embeddable` before deterministic title/artist/version,
duration, and source scoring. A score below 80 becomes typed unavailability;
raw provider envelopes, descriptions, thumbnails, `licensedContent`, and API
keys remain inside the server boundary. The optional `YOUTUBE_API_KEY` is never
read from a `NEXT_PUBLIC_*` variable.

Results use a process-local cache with positive 24-hour and negative 10-minute
TTLs, true-LRU capacity of 500, and concurrent request deduplication. No audio
is downloaded, and a missing key or provider failure never prevents a challenge
from completing. M7C-YOUTUBE-02 consumes this boundary with a visible manual
player. M7C-YOUTUBE-03 adds a server-derived, non-negative start hint with a
1.5-second lead, and M7C-YOUTUBE-04 mounts the player automatically on terminal
reveal while attempting scripted playback only when more than half is visible.
Autoplay failures fall back to the same visible controls, with no end boundary
or exact synchronization guarantee.

## Challenge generation

Input:

```ts
{
  source:
    | { kind: "album"; spotifyId: string; displayName: string }
    | { kind: "playlist"; spotifyId: string; displayName?: string }
    | { kind: "public-playlist"; spotifyId: string; canonicalUrl: string; displayName?: string };
  seed: string;
  targetCount: 5;
}
```

Algorithm:

1. Resolve source tracks through the source-specific adapter. The public route
   parses/canonicalizes the URL and uses the server-only `PublicPlaylistResolver`;
   the legacy route verifies authenticated library membership.
2. Seed-shuffle candidate tracks.
3. For each candidate track:
   - request synced lyrics,
   - parse and normalize lines,
   - generate all 4-consecutive-line sliding windows,
   - reject low-quality windows,
   - deterministic-select one remaining window.
4. Stop when target count is reached.
5. If fewer valid tracks exist, return a shorter challenge.
6. If none exist, fail with `INSUFFICIENT_LYRICS`.

The public and authenticated source collectors converge before lyric lookup, so
masking, progressive reveal, recovery, guessing, and results do not need a
source-specific gameplay implementation. Public work remains bounded to the
existing source-position, lyric-scan, and 1-5-question limits.

## LRC parsing

Support common timestamps such as:

```text
[01:23.45]
[01:23.450]
```

Ignore metadata rows, invalid lines, and blank lyric rows.

## Four-line window selection

Given N synced lyric lines, generate windows:

```text
lines 0..3
lines 1..4
lines 2..5
...
```

Reject a window when it is too weak for gameplay.

Initial quality signals can include:

- total word count,
- unique normalized word count,
- content-word count,
- filler/interjection penalty,
- repetition penalty,
- repeated-song-title penalty when detectable cheaply.

Keep the heuristic pure, deterministic, and unit-tested.

Do not use an LLM for MVP window selection.

## Tokenization

Preserve line breaks, punctuation, and whitespace for rendering, while assigning stable IDs to lexical word tokens.

Example source:

```text
Maybe I asked for too much
```

Possible lexical representation:

```ts
[
  { raw: 'Maybe', normalized: 'maybe', isWord: true },
  { raw: ' ', isWord: false },
  { raw: 'I', normalized: 'i', isWord: true },
  ...
]
```

Stable token IDs are important because solved words must remain locked across attempts.

## Mask progression

Maximum attempts: **4**.

The approved curve masks 70%, 50%, 30%, and 20% of eligible lexical answer
tokens on attempts 1 through 4 (Expert through Easy). The engine stores the
cumulative visible equivalents `0.30`, `0.50`, `0.70`, and `0.80`.

The curve is configurable behind the pure masking boundary, but these values
are the current product defaults:

```ts
const revealConfig = {
  1: 0.30, // 30% visible / 70% masked (Expert)
  2: 0.50, // 50% visible / 50% masked (Hard)
  3: 0.70, // 70% visible / 30% masked (Medium)
  4: 0.80, // 80% visible / 20% masked (Easy + title hint)
};
```

Rounding is deterministic. For a multi-word window, at least one lexical word
is visible even when the configured ratio rounds down to zero; a one-word
window remains hidden until terminal state so the answer is not fully exposed.

Rules:

- never mask punctuation or formatting tokens,
- do not reveal all answer words before the final result,
- prefer lower-information/common words as initial visible anchors,
- preserve all player-solved tokens,
- newly revealed hint tokens use state `revealed`, not `solved`,
- unresolved answer tokens remain `hidden`.

The server renders a hidden lexical token as underscore-only text whose length
matches the original Unicode code-point count. The raw word and normalized
answer never cross the browser boundary. On active attempt 4, the server may
also expose a bounded `titleHint`; this metadata is not part of answer
matching or submission.

## Guess comparison and solved-word locking

The client submits answers for unresolved hidden tokens only.

For each token position:

```text
normalized user token == normalized expected token
```

means it becomes `solved`.

Incorrect tokens remain unresolved.

The answer matcher should be implemented behind a function boundary that can later add fuzzy tolerance without rewriting gameplay state.

Example:

```ts
compareToken(expected, actual): MatchResult
```

Possible future results:

```ts
'true' | 'close' | 'false'
```

MVP may begin with normalized exact matching.

## State ownership

Client-visible state:

- current question index,
- current attempt,
- rendered token states,
- current unresolved inputs,
- progress counts.

Sensitive challenge source data should remain server-side where reasonable so original hidden answers are not trivially exposed before completion.

No database is required for the first version. Use short-lived signed/encrypted session state or another simple ephemeral strategy.

Public URL challenges are the deliberate exception to the authenticated
library-session requirement: their opaque challenge ID is recoverable by the
anonymous holder of that ID through the public-source GET/guess routes. The
same process-local TTL and active-entry cap apply, and public state still never
contains raw provider responses or hidden answers.

## Scoring and celebrations

Scoring is a pure, replaceable boundary over safe progress counts. Each
question retains a server-only count of answer words hidden after the baseline
attempt-1 reveal; this denominator is not sent to the browser. A song score
uses only player-solved words against that denominator. Revealed hint words do
not earn credit, failed songs retain partial credit, and attempt number has no
separate penalty.

Solved-song streak positions apply internal multipliers of `1.00`, `1.05`,
`1.10`, `1.15`, and `1.20` for positions 1 through 5. A failed question resets
the streak. The multiplier is deliberately absent from every client DTO. Each
song score is capped at 100, and a completed challenge score is the rounded
average across its actual questions.

The completed challenge view exposes only this presentation-safe shape:

```ts
type ChallengeScoreView = {
  total: number;
  songs: { questionId: string; score: number }[];
};
```

Incomplete challenge views omit `score`. Terminal guess responses expose only
the celebration facts `perfect` and `streak`. Perfect means a song solved on
attempt 1 and is independent of whether a numeric score happens to reach 100.
The browser renders Perfect and Lyric Streak as short, non-modal celebration
events; these events never mutate challenge state or gate navigation.

## API/error types

```ts
type ChallengeErrorCode =
  | 'INVALID_INPUT'
  | 'PUBLIC_PLAYLIST_PRIVATE'
  | 'PUBLIC_PLAYLIST_NOT_FOUND'
  | 'PUBLIC_PLAYLIST_RATE_LIMITED'
  | 'PUBLIC_PLAYLIST_UNAVAILABLE'
  | 'PUBLIC_PLAYLIST_INVALID_RESPONSE'
  | 'SPOTIFY_AUTH_REQUIRED'
  | 'SPOTIFY_RATE_LIMITED'
  | 'LYRICS_PROVIDER_UNAVAILABLE'
  | 'INSUFFICIENT_LYRICS'
  | 'INVALID_ALBUM';
```

## Observability

Log events, not lyric content:

- auth success/failure category,
- album challenge requested,
- eligible-track count,
- provider failure category,
- challenge completed.

Never log full lyric payloads or user tokens.

## Future-compatible seams

Keep replaceable:

- `LyricsProvider`,
- `PlaybackProvider`,
- answer matcher,
- scoring strategy,
- persistence layer,
- challenge source strategy.
