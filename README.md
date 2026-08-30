# FillTheLyrics— MVP

A web game that turns a public Spotify playlist URL (the primary flow), or a
user's authenticated saved albums and accessible playlists (legacy library
flow), into lyric reconstruction challenges.

## Product thesis

Purely random songs are often unfair because players may not know them. A single-song challenge becomes predictable too quickly. The MVP uses **bounded uncertainty**: the player explicitly supplies a public playlist they know, while the game randomly selects several eligible tracks from that source. The authenticated saved-album/playlist picker remains available as a compatibility path.

The core question is:

> How well do you really know the lyrics of the albums you love?

## Core loop

Primary anonymous flow:

1. Open FillTheLyrics.
2. Paste a canonical public Spotify playlist URL.
3. Import the playlist through the server-side resolver.
4. Generate a deterministic challenge from lyric-eligible tracks.

The existing authenticated library flow is an alternate compatibility path:

1. Sign in with Spotify.
2. Load the user's saved albums and accessible playlists.
3. Pick one album or playlist.
4. Generate a deterministic challenge from lyric-eligible tracks.

Both flows then continue:

5. For each song, select **4 consecutive synced lyric lines**.
6. Attempts use the approved mask curve: **70% / 50% / 30% / 20% masked**
   for Expert, Hard, Medium, and Easy.
7. The player fills the missing words.
8. Correct words are locked; unresolved words remain playable.
9. The player gets up to **4 attempts**. Each new attempt reveals more information;
   the active Easy attempt also shows the song title as a hint.
10. After solve or final failure, reveal the completed 4-line fragment.
11. When playback is available, let the player hear the matching section of the song.
12. Show a friendly non-blocking Perfect or Lyric Streak celebration after a
    completed song when earned.
13. Continue to the next song and finish the session.
14. After the final song, show the challenge score and per-song scores.

The player does **not** guess or submit the song title. It is only a late-game
hint on the active Easy attempt and part of the terminal reveal metadata.

## MVP scope

### Must have

- Public playlist URL import using the strict canonical Spotify URL shape.
- Anonymous public-playlist challenge creation without requiring Spotify OAuth,
  Premium, or a developer-dashboard user allowlist.
- Next.js App Router + TypeScript + Tailwind CSS.
- Spotify OAuth and library scopes remain supported for the legacy compatibility
  path: `user-library-read`, `playlist-read-private`, and
  `playlist-read-collaborative` when playlist access is enabled.
- Saved album and playlist browser for the legacy compatibility path.
- Album or playlist challenge with up to 5 lyric-eligible tracks.
- LRCLIB adapter.
- Synced lyric parsing.
- 4-consecutive-line lyric window selection.
- Deterministic challenge generation using a seed.
- 4 attempts per song.
- Progressive mask curve: 70%, 50%, 30%, and 20% masked across attempts 1–4.
- Length-aware hidden-word placeholders.
- Song-title hint on active attempt 4; title is never an answer field.
- Correct-word locking.
- Answer normalization and per-token comparison.
- Reveal after solve/fail.
- Word-based scoring with partial credit for failed songs.
- Bounded internal streak multiplier and complete-only results score.
- Per-song Perfect and consecutive Lyric Streak celebrations.
- Graceful fallback when a track has no usable synced lyrics.
- Local/ephemeral persistence of the active session.

### Product behavior intentionally left open

- Whether the approved mask curve should be tuned again after playtesting.
- Exact typo/fuzzy-match tolerance.
- Exact number of songs if fewer than 5 good lyric windows are available.

These should be discussed during implementation rather than hard-coded prematurely.

### Nice to have if cheap

- Spotify playback beginning near the first timestamp of the 4-line fragment.
- Shareable challenge seed.
- Small transitions for correct words becoming locked.

### Explicitly out of scope

- Global random-song mode.
- Artist-wide challenge mode.
- Liked-song challenges.
- Song-title guessing.
- Multiplayer rooms.
- Leaderboards.
- Daily global challenge.
- Payments.
- Admin dashboard.
- AI-generated or rewritten lyrics.
- Mandatory Spotify Premium.

## Recommended stack

- Next.js latest stable with App Router
- TypeScript
- Tailwind CSS
- Spotify Web API
- LRCLIB API
- Zod for external API validation
- Vitest for unit tests
- Playwright for critical-flow smoke tests

Avoid adding a database to the first implementation unless a concrete requirement appears.

## Game rules

Each song uses one 4-line lyric window.

### Attempt progression

- Maximum attempts: **4**.
- Expert / attempt 1: **70% masked**.
- Hard / attempt 2: **50% masked**.
- Medium / attempt 3: **30% masked**.
- Easy / attempt 4: **20% masked**, plus the song title as a hint before submission.
- Words the player already solved correctly stay locked.
- The game distinguishes between:
    - `solved`: correctly supplied by the player,
    - `revealed`: given by the game as a hint,
    - `hidden`: still unresolved.
- After attempt 4, reveal the completed fragment.

Example:

```text
Attempt 1
Maybe __ ___ ____ __ ___________
_____ _ _____ ___ ___ ____
___ _____ this _____ ___ _ ___________
____ ___ ____ __ ___ __

Attempt 2
Maybe __ got ____ in translation
_____ I _____ for too much
But _____ this _____ was _ ___________
____ you ____ it ___ up

Attempt 3
Maybe we got ____ in translation
Maybe I _____ for too much
But maybe this _____ was a ___________
____ you tore it all up

Attempt 4
Maybe we got lost in translation
Maybe I _____ for too much
But maybe this thing was a ___________
'Til you tore it all up

Final clue · song title
Example Song Title
```

Underscores represent the original lexical word length. The approved reveal
curve is deterministic and may be tuned only through a later explicit product
decision informed by playtesting.

### Scoring and celebrations

Scoring is based on the answer words that were hidden after the standard
attempt-1 reveal. Words revealed by the system do not earn player credit, but
words solved before a failed song still contribute partial points. There is no
separate penalty for using attempts 2–4.

Solved songs in a row receive a small internal multiplier at streak positions
2 through 5. The multiplier is capped inside the scoring boundary and is not
shown in the UI. The final score is a bounded 0–100 average across the actual
number of songs and is shown only once the challenge is complete.

Each song solved on attempt 1 can trigger a non-modal `PERFECT` celebration.
Two or more consecutive solved songs can trigger `LYRIC STREAK ×N`, even when
the songs required later attempts. Perfect is evaluated independently from the
numeric score, and takes visual priority when both events happen together.

## Answer model

The user fills only the missing words, not the full four-line text. The title
hint shown on attempt 4 is metadata and is never submitted or matched.

For MVP, normalize answers by:

- lowercase,
- trimming whitespace,
- collapsing repeated whitespace,
- normalizing curly apostrophes,
- preserving meaningful internal punctuation and diacritics; formatting punctuation is rendered as a separate non-answer token.
- rendering each hidden lexical word as an underscore gap matching its original
  Unicode character length.

The architecture should support fuzzy matching later, but the exact tolerance is intentionally deferred.

### Correct-word locking

After each submission, compare the supplied hidden words positionally.

Example:

```text
Expected hidden words:
["lost", "asked", "thing", "masterpiece", "tore"]

User:
["lost", "ask", "thing", "masterpiece", "tore"]
```

Result:

```text
lost         solved
ask          unresolved
thing        solved
masterpiece  solved
tore         solved
```

The next attempt must not ask the user to re-enter solved words.

## Lyric window eligibility

Do not choose a random line and blindly take the next three lines.

Generate candidate **sliding windows of 4 consecutive synced lyric lines** and reject weak windows.

Prefer windows that:

- contain enough total words to be recognizable,
- have multiple content words,
- contain vocabulary diversity,
- are not mostly repeated interjections,
- are not dominated by repeated song-title phrases,
- contain valid timestamps,
- do not include obvious instrumental/non-lyric metadata.

Example weak window:

```text
Oh
Yeah
Baby
Oh
```

Example stronger window:

```text
Maybe we got lost in translation
Maybe I asked for too much
But maybe this thing was a masterpiece
'Til you tore it all up
```

The first implementation should use deterministic heuristics, not an LLM.

## Playback behavior

Playback is optional and never a dependency for finishing a challenge.

The M7C-YOUTUBE-01 resolver is an optional server-only candidate lookup. M7C-
YOUTUBE-02 adds a visible, user-controlled YouTube player after a question is
solved or failed. M7C-YOUTUBE-03 adds best-effort positioning near the first
revealed lyric line, and M7C-YOUTUBE-04 automatically mounts that player on the
terminal reveal while gating its scripted play attempt on visibility. Unavailable
or low-confidence provider results remain safe optional states; browser autoplay
policy must leave the normal player controls usable.

Keep the first lyric timestamp for each selected window:

```text
startAtMs = firstLine.timestampMs
```

The server derives a bounded start hint slightly before the fragment:

```text
max(0, startAtMs - 1500)
```

The player has no fabricated end boundary and does not claim exact
lyric/audio synchronization. The initial request and player mount happen after
the terminal reveal; the scripted play attempt waits until more than half of the
player is visible. If the browser blocks it, the visible player remains
available for manual control.

## Suggested routes

```text
/                       Landing
/albums                 Saved album and playlist picker
/play/[albumId]         Challenge setup / game
/results/[challengeId]  Results
/api/auth/*              Spotify OAuth handlers
/api/albums              Saved album adapter
/api/playlists           Spotify playlist adapter
/api/challenges          Challenge creation
/api/public-playlists/challenge
                         Anonymous public-playlist challenge creation
/api/challenges/*        Guess/reveal state
```

## Suggested source layout

```text
src/
  app/
  components/
    album/
    game/
    ui/
  features/
    auth/
    albums/
    challenge/
    lyrics/
    playback/
  lib/
    spotify/
    lrclib/
    game/
  types/
  tests/
```

## Environment variables

```text
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/auth/spotify/callback
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000
AUTH_SESSION_SECRET=replace-with-at-least-32-random-characters
```

The public playlist flow does not require any Spotify credentials. The legacy
library flow handles OAuth and token exchange on the trusted Next.js server with
the Authorization Code flow. `SPOTIFY_CLIENT_SECRET` and `AUTH_SESSION_SECRET`
are server-only; never prefix either value with `NEXT_PUBLIC_`, commit
`.env.local`, or expose token values in browser state. Use the exact `127.0.0.1`
callback locally and HTTPS callback/app URLs in production. See `SETUP.md` for
Spotify Developer Dashboard setup.

## Hardening and deployment

Provider GET requests use one bounded server-side retry for transient network
and HTTP failures; permanent/auth failures are not retried. The retry boundary
never reads failed provider bodies and preserves the existing stable error
codes. Run `npm run audit:privacy` after a production build to scan source and
generated browser assets for accidental secret, token, lyric, or provider-data
exposure.

Deploy the full Node.js application with `npm run build` followed by
`npm run start`. Configure `NEXT_PUBLIC_APP_URL` and
`SPOTIFY_REDIRECT_URI` with HTTPS values in production, keep Spotify secrets,
the session secret, and the optional YouTube key server-only, and do not use a
static export. Challenges remain process-local and may expire on restart or
when routed to another instance; this is an accepted MVP limitation.

## Definition of done

A new user can:

1. open the app,
2. paste and import a canonical public playlist URL without signing in,
3. receive up to 5 lyric challenges,
4. solve 4-line fragments across up to 4 attempts,
5. keep correctly solved words between attempts,
6. see the completed lyric fragment after solve/fail,
7. receive a Perfect or Lyric Streak celebration when earned,
8. see the final score and per-song scores after completing the challenge,
9. finish the challenge without fatal errors even when playback is unavailable.

The legacy authenticated flow also remains able to browse saved albums and
accessible playlists and start the same challenge loop.
