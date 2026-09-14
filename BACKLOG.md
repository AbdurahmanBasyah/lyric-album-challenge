# BACKLOG.md

## Milestone 0 — Project skeleton

- [x] Bootstrap Next.js + TypeScript + App Router + Tailwind.
- [x] Configure lint/typecheck/tests.
- [x] Add environment validation.
- [x] Add minimal app shell and error boundary.

**Exit:** app runs locally and checks pass.

## Milestone 1 — Pure game engine

- [x] LRC parser.
- [x] 4-line sliding-window generator.
- [x] Lyric-window quality heuristic.
- [x] Stable lyric tokenizer preserving line breaks/punctuation.
- [x] Seeded PRNG/shuffle.
- [x] Attempt-1 mask generation (initial ~80% baseline; superseded by the
  M6-GAMEPLAY-02 curve).
- [x] Configurable reveal progression for attempts 2–4.
- [x] Token answer normalization/comparison.
- [x] Correct-word locking.
- [x] Unit tests for deterministic behavior.

**Exit:** given mocked synced lyrics, the engine produces a deterministic 4-line puzzle and can progress through 4 attempts.

## Milestone 2 — Spotify authentication

- [x] Create Spotify developer app/local callback setup.
- [x] Implement OAuth flow appropriate to Next.js boundary.
- [x] Request `user-library-read` for saved-album access.
- [x] Implement token refresh/session handling.
- [x] Implement logout.

**Exit:** a real Spotify user can authenticate safely.

## Milestone 3 — Saved album and playlist picker

- [x] Spotify client adapter.
- [x] Fetch paginated saved albums.
- [x] Map to `AlbumSummary`.
- [x] Album grid UI.
- [x] Empty, loading, and failure states.
- [x] Request playlist-read scopes and provide explicit Spotify re-consent.
- [x] Fetch paginated accessible playlists.
- [x] Map to `PlaylistSummary`.
- [x] Playlist grid UI with Spotify attribution links.
- [x] Playlist empty, loading, scope, rate-limit, and failure states.
- [x] Handle valid metadata-only playlists without returning `502`.
- [x] Handle valid Spotify playlist metadata variants without returning `502` (including null/empty cover metadata and unavailable placeholders).
- [x] Diagnose playlist schema failures safely and support valid unnamed playlists with an accessible fallback label.

**Exit:** authenticated user can choose a saved album or accessible playlist.

Playlist-item filtering and challenge construction remain deferred to the later
track/lyrics pipeline; this milestone only discovers and selects the source.

## Milestone 4 — LRCLIB pipeline

- [x] LRCLIB adapter.
- [x] Runtime validation for external responses.
- [x] Track/artist matching.
- [x] Duration sanity check when useful.
- [x] Feed synced lyrics into pure game engine.

**Exit:** a Spotify track can produce good candidate 4-line windows or a typed miss.

## Milestone 5 — Challenge construction

- [x] Resolve eligible tracks from the selected album or playlist source.
  - [x] Add strict single-page album/playlist source-track adapters with
    eligibility filtering and application-owned pagination cursors.
- [x] Seed-shuffle selected source tracks.
- [x] Select up to 5 lyric-eligible tracks.
- [x] Deterministically select one quality window per selected track.
- [x] Create server-controlled challenge state.
- [x] Handle sources with too few eligible tracks gracefully.

The candidate boundary is now behind a server-side saved-album or playlist
membership check. `POST /api/challenges` creates only a bounded, process-local
challenge (30-minute TTL, 100 active-entry cap); the state is not durable
history and can be lost on process restart or multi-instance deployment.

**Exit:** an album or playlist source plus seed creates a playable challenge.

## Milestone 6 — Gameplay UI

- [x] Challenge intro.
- [x] 4-line puzzle renderer.
- [x] Hidden-word input UX.
- [x] Attempt indicator 1–4.
- [x] Partial correctness feedback.
- [x] Solved-word locking.
- [x] Progressive hint reveal.
- [x] Solve/fail reveal state.
- [x] Results screen without final scoring dependency (historical baseline;
  superseded by M8 scoring).
- [x] Local recovery of active session.
- [x] M6-GAMEPLAY-02 difficulty curve: 70%, 50%, 30%, and 20% masked across
  Expert, Hard, Medium, and Easy attempts.
- [x] Length-aware hidden-word placeholders with stable token IDs and
  punctuation preservation.
- [x] Active attempt-4 song-title hint kept outside answer submission and
  matching.

**Exit:** full game works without playback.

Gameplay now consumes the server-controlled masked challenge state from source
selection through results. The responsive difficulty rail maps Expert, Hard,
Medium, and Easy to attempts 1, 2, 3, and 4; the current curve is 70%, 50%,
30%, and 20% masked, with length-aware blanks and a title hint on active
attempt 4. Recovery persists only the active challenge pointer and rehydrates
authoritative state through the GET challenge route. At this milestone,
playback and final scoring remained deferred; they are addressed by later
milestones.

## Milestone 7 — Timestamp playback spike

- [x] Introduce `PlaybackProvider` interface.
- [x] Verify current Spotify playback/embed constraints.
- [ ] Attempt start near `window.startTimestampMs - 1500`.
- [ ] Provide explicit Play fallback.
- [x] Keep gameplay independent of playback availability.

**Exit:** when supported, the completed lyric section can be heard near its timestamp.

The policy-gated spike confirms the timing contract and ships a disabled-by-
default provider plus reveal-only unavailable UI. Live Spotify playback and a
real Play fallback remain open because current Spotify terms prohibit using
Spotify content in game/trivia functionality and synchronizing recordings with
visual media without written approval. No new playback scope or provider call
was added.

## Milestone 7B - Public playlist URL flow

- [x] Strictly parse and canonicalize public `open.spotify.com/playlist/{id}` URLs.
- [x] Record the wolfX runtime failure as `REPLACED / PROVIDER FAILURE`.
- [x] Resolve public playlist data through a fixed server-only Spotify Embed
  (`__NEXT_DATA__`) adapter.
- [x] Normalize tracks to the minimal `TrackSummary` contract
  (`spotifyId`, `name`, `artistNames`, `durationMs`); drop malformed,
  duplicate, local, restricted, unplayable, and unavailable entries without
  fabricating album or track/disc-position metadata.
- [x] Reuse the existing synced-LRCLIB candidate, masking, challenge, recovery,
  guessing, and results pipeline with 1-5 question bounds.
- [x] Add anonymous `POST /api/public-playlists/challenge` with bounded input,
  provider work, duplicate protection, stable errors, and no-store responses.
- [x] Allow anonymous recovery and guessing for `public-playlist` challenge
  sources while preserving OAuth gates for legacy library challenges.
- [x] Replace the primary landing CTA with the accessible Framer Motion URL-first
  import form; keep OAuth/library UI out of the primary path.
- [x] Add focused backend, frontend, privacy, bound, and legacy-regression tests.
- [x] Verify the supplied public playlist reaches Spotify Embed, LRCLIB, and a
  playable challenge without OAuth.

**Exit:** the public URL-to-challenge path is implemented and quality-gated;
the strict minimal track contract accepts real sparse Embed metadata, zero
playable tracks fail safely with `INSUFFICIENT_LYRICS`, and the supplied live
URL produces a challenge question without OAuth. Provider-specific metadata
and the replaced wolfX implementation do not cross the application boundary.

## Milestone 7C - YouTube playback resolver

- [x] M7C-YOUTUBE-01: add a server-only YouTube Data API adapter with fixed
  official endpoints, strict response/duration validation, and bounded search
  and details requests.
- [x] Add deterministic title/artist/version/duration/source scoring with a
  high-confidence threshold and typed unavailable results.
- [x] Add bounded process-local positive/negative TTL cache with true-LRU
  eviction and in-flight request deduplication.
- [x] Add sanitized fixtures, provider-error regressions, cache tests, and
  client-bundle/privacy scans without exposing API keys or raw provider data.
- [x] M7C-YOUTUBE-02: integrate a visible, user-controlled manual player only
  after reveal.
- [x] M7C-YOUTUBE-03: add best-effort segment timing/autoplay only after
  the visible-player and browser-policy gates pass.
- [x] M7C-YOUTUBE-04: auto-mount the visible terminal player and gate the
  best-effort autoplay attempt on player visibility, while retaining manual
  fallback and omitting an unverified end boundary.

**Exit for M7C-YOUTUBE-01:** a canonical `TrackSummary` can resolve to a
high-confidence embeddable YouTube video ID through a server-only boundary;
medium/low/no matches fail safely. No player, autoplay, timing, challenge
integration, or gameplay dependency is shipped by this iteration.

**Exit for M7C-YOUTUBE-02/03:** terminal questions can optionally render a
visible, user-controlled YouTube player after an explicit click. The server
derives a bounded non-negative start hint with a 1.5-second lead; the client
attempts playback only from that gesture and keeps manual controls when browser
autoplay is blocked. No end boundary, audio extraction, exact synchronization,
or gameplay dependency is introduced.

**Exit for M7C-YOUTUBE-04:** terminal reveals automatically request and mount a
visible player. Scripted playback waits for `intersectionRatio > 0.5`, retries
and unmounts are guarded, and manual controls remain available after policy or
provider failure. No client-selected playback target, end boundary, raw
provider data, or gameplay dependency is introduced.

## Milestone 8 — Scoring discussion + implementation

- [x] Decide scoring dimensions with the coding AI/user.
- [x] Define scoring strategy interface.
- [x] Add scoring tests.
- [x] Integrate results UI.

Scoring uses player-solved words divided by the words hidden after the baseline
attempt-1 reveal. Revealed words receive no credit, failed songs retain partial
credit, and there is no separate attempt penalty. Consecutive solved songs use
a capped internal multiplier (`1.00` through `1.20` at streak positions 1–5),
which is not exposed in the UI. The final score is a 0–100 average across the
actual question count and is shown only after the challenge is complete.
Each first-attempt song can trigger a non-modal `PERFECT` celebration; streaks
of two or more can trigger `LYRIC STREAK ×N`, with Perfect taking priority.

**Exit:** completed challenges expose bounded server-owned total and per-song
scores; incomplete challenges expose no score. Terminal responses expose only
safe Perfect/streak facts for the animated, non-blocking celebration layer.

## Milestone 9 — MVP hardening

- [x] Mobile pass.
- [x] Keyboard/focus accessibility pass.
- [x] Provider rate-limit/backoff behavior.
- [x] Token/lyric log leakage audit.
- [x] Playwright happy-path smoke test with mocked providers.
- [x] Deployment configuration.

**Exit:** deployable MVP. The responsive public-playlist flow was checked at
320, 375, 414, 768, and 1280px with no horizontal overflow; keyboard/focus,
semantic status regions, and reduced-motion behavior are covered by the
frontend changes and mocked browser path. Provider GETs use one bounded,
injectable retry with stable final error categories, while token/lyric/provider
payload leakage is guarded by `npm run audit:privacy`. The production build
and `next start` smoke check pass with security headers, no-store API behavior,
documented HTTPS environment requirements, and the accepted process-local
challenge-store limitation.

## Milestone 10 — Canonical experience completion

- [x] M10-CANONICAL-01: canonical landing and public-playlist pre-start
  visual system.
- [x] M10-CANONICAL-02: canonical gameplay interaction, secure playback
  warmup, and Round Complete architecture.
- [x] M10-CANONICAL-03: masking fairness, anchor coverage, and responsive
  gameplay correction.
- [x] M10-CANONICAL-03-POLISH-01: remove duplicate solved feedback and fix
  one/two-letter inline input clipping.
- [ ] M10-CANONICAL-04-A: Perfect/Streak celebration overlays and sequencing.
- [ ] M10-CANONICAL-04-B: canonical Final Results metrics, track list, and
  replay/source actions.
- [ ] M10-CANONICAL-04-C: Motion Lab, reduced-motion validation, and final
  responsive/accessibility QA.

**Exit:** the canonical FillTheLyrics experience is implemented and audited
across celebrations, Final Results, motion validation, responsive behavior,
accessibility, and the existing gameplay/security boundaries.
