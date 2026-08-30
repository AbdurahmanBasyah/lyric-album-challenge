# PRODUCT_DECISIONS.md

## PD-001 — The MVP uses bounded Spotify library sources

**Decision:** The primary entry point accepts one canonical public Spotify
playlist URL. The existing authenticated source picker remains a compatibility
path for a user's saved album or accessible playlist.

**Why:** Both modes preserve bounded uncertainty: the player supplies context
they know while the game chooses the track and lyric section deterministically.

**Still rejected for MVP:** global random songs, artist-wide random songs, and
global Spotify search.

## PD-011 — Playlists are read-only and source-bounded

**Decision:** Authenticated playlist mode only discovers and selects playlists
exposed by the current user's Spotify library. The primary public mode accepts
only a pasted canonical public playlist URL. FillTheLyrics never edits, follows,
unfollows, or searches the global Spotify catalog.

The playlist picker is delivered before playlist-item challenge construction.
Later ingestion must consider that playlist items can be episodes, local tracks,
or unavailable tracks; only eligible Spotify tracks may enter the lyric pipeline.

**Why:** Playlist inclusion expands the user's personal context without turning
the MVP into an unrestricted catalog browser or assuming every playlist item can
produce synced lyrics.

---

## PD-002 — One challenge contains up to five different songs

**Decision:** Select up to five lyric-eligible tracks from the chosen bounded
source (public playlist, saved album, or accessible playlist).

**Why:** Multiple songs create replayability while the chosen bounded source
keeps the challenge fair.

---

## PD-003 — Each song uses four consecutive lyric lines

**Decision:** A question is based on a 4-line synced lyric window rather than a single lyric line.

**Why:** One heavily masked line can be ambiguous. Four consecutive lines provide rhythm, phrase structure, and enough contextual anchors for recognition.

---

## PD-004 — Four attempts with a fixed progressive mask curve

**Decision:** Each song allows 4 attempts. Eligible answer words are masked at 70% on Expert (attempt 1), 50% on Hard (attempt 2), 30% on Medium (attempt 3), and 20% on Easy (attempt 4). The fourth attempt also shows the song title as a metadata hint before submission.

The engine represents these as cumulative visible ratios of `0.30`, `0.50`,
`0.70`, and `0.80`. Rounding is deterministic, solved/revealed words remain
locked, and an active question does not expose every answer word before its
terminal result when a hidden word can remain.

**Why:** The revised curve keeps the first attempt challenging without making
the opening state unnecessarily frustrating, then gives predictable recovery
steps before the title-assisted final attempt.

---

## PD-005 — Correct words remain locked

**Decision:** When a submitted word is correct, it remains solved on subsequent attempts.

**Why:** Every attempt should create visible progress rather than force the player to re-enter answers already proven correct.

The game engine must distinguish `solved`, `revealed`, and `hidden` tokens.

---

## PD-006 — The player does not guess the song title

**Decision:** The primary task remains reconstructing missing lyric words. The
song title may appear as a metadata hint only on the active fourth attempt and
in the existing terminal reveal. It is never an answer field and is never sent
to the matcher.

**Why:** The title is a controlled late-game clue rather than a second trivia
task. Keeping it out of the answer map preserves the core lyric-reconstruction
objective while making the final attempt a reliable safety net.

---

## PD-007 — Scoring remained open during initial implementation (superseded)

**Historical decision:** Do not hard-code the final scoring model in product
documentation while the gameplay mask and correct-word locking behavior are
still being validated.

**Why:** Scoring should be discussed alongside real masking behavior,
correct-word locking, and playtesting. The engine can expose attempt/progress
data without prematurely locking a formula.

This decision was superseded by PD-020 after the M8 scoring discussion and
implementation.

---

## PD-008 — Synced lyrics are required for an eligible track

**Decision:** Prefer only tracks with timestamped lyrics.

**Why:** Synced lyrics are required for deterministic 4-line windows and the intended post-round playback near the exact section.

---

## PD-009 — Playback is a reward, not a dependency

**Decision:** The game must work even when Spotify playback at the desired timestamp is unavailable.

**Why:** Playback availability may depend on permissions, account/product restrictions, browser behavior, and Spotify platform policies.

---

## PD-010 — No database initially

**Decision:** Keep challenge/session state ephemeral for MVP.

**Why:** The main product hypothesis can be tested before adding persistence infrastructure.

Revisit when implementing global stats, cross-device history, accounts beyond Spotify, or leaderboards.

## PD-012 - Public playlist URLs are strict and canonical

**Decision:** Accept only `https://open.spotify.com/playlist/{id}`. A trailing
slash and query/hash are ignored; a trivial `/intl-*/playlist/{id}` locale
prefix may be accepted. Reject `spotify.link`, `spotify:playlist:*`, arbitrary
hosts, and arbitrary provider URLs.

**Why:** A narrow parser keeps the anonymous boundary predictable and prevents
the URL field from becoming an SSRF or catalog-search surface.

## PD-013 - Public import does not depend on OAuth

**Decision:** Public playlist import resolves through a server-only provider
adapter and uses anonymous challenge/recovery/guess routes. The landing page's
primary action must not require or advertise Spotify Login/Connect/Choose
Library. OAuth remains only for the legacy library path.

## PD-014 - Public tracks use a minimal strict domain model

**Decision:** Normalize public provider records into `TrackSummary` only when
the required fields are valid: Spotify track ID, title, at least one artist,
and a bounded duration. Album name, track number, and disc number are not
required domain fields and must not be fabricated or serialized. The public
path uses synced LRCLIB lyrics only, keeps the existing 1-5 question bounds,
and treats zero playable questions as a safe empty/error result.

**Why:** Spotify Embed exposes a sparse but usable track shape. Keeping the
application contract to the identity and duration needed by the game lets that
source reuse the existing candidate and gameplay pipeline without weakening
required-field validation, inventing metadata, or falling back to unsynced
lyrics.

The unreliable wolfX provider attempt was replaced at the provider boundary
after its runtime response could not supply a stable usable contract; this did
not change the URL, gameplay, or lyric product rules.

## PD-015 - YouTube resolution is optional and server-only

**Decision:** The first YouTube iteration may resolve a `TrackSummary` to a
high-confidence embeddable video ID through the official Data API, but it must
not download/extract audio or make playback a challenge dependency. The API key
is optional, server-only, and never exposed through `NEXT_PUBLIC_*`, client
responses, or logs. Low-confidence and provider-failure results are typed
unavailability.

**Why:** A bounded resolver gives the later visible listening player a deterministic
candidate without weakening the lyric game or turning provider availability into
a correctness requirement. Manual playback and any segment timing/autoplay
behavior require separate browser, provider, and policy gates.

## PD-016 - Manual YouTube listening is post-reveal and optional

**Decision:** After a question is solved or failed, the user may explicitly load
a visible YouTube embed for the server-resolved track. The player is not shown
for active questions, does not autoplay or seek in M7C-YOUTUBE-02, and never
gates progress, awards an incentive, changes challenge state, or exposes raw
provider data. Public-playlist challenges keep their anonymous opaque-handle
flow; legacy library challenges keep their existing session gate.

**Why:** A visible, user-controlled embed is the smallest useful playback
surface while preserving the optional nature of audio and leaving timing/autoplay
to a separate browser-policy evaluation.

## PD-017 - Best-effort YouTube timing remains gesture-led

**Decision:** M7C-YOUTUBE-03 may derive `startAtMs` from the first timestamp of
the revealed four-line window with a 1.5-second lead and attempt playback after
the user's explicit click. Browser or provider autoplay blocks must preserve a
visible manual player. No end timestamp is fabricated, no exact
lyric/audio synchronization is claimed, and the hint never changes gameplay,
scoring, or completion.

**Why:** A small server-owned timing hint improves optional listening without
turning browser policy or provider timing accuracy into a correctness or
progress requirement.

## PD-018 - Terminal playback may auto-mount, never silently depend on autoplay

**Decision:** M7C-YOUTUBE-04 automatically requests and mounts the visible
YouTube player after a question is solved or failed. Scripted playback may be
attempted only when more than half of the player is visible; browser/provider
blocks preserve manual controls. The behavior remains optional, creates no end
boundary, and never changes gameplay, scoring, recovery, navigation, or
completion.

**Why:** Removing the extra load click improves the terminal reveal flow, while
the visibility gate and manual fallback respect platform behavior and keep
audio outside the game's correctness path.

## PD-019 - Hidden blanks reflect lexical word length

**Decision:** A hidden lexical token is rendered as one underscore per Unicode
code point in the original word. Whitespace and punctuation represented by
static tokenizer tokens remain visible; the raw answer and normalized token
are never sent to the browser.

**Why:** Word-length feedback makes the puzzle legible and predictable without
changing token identity, matching, or the server-side answer boundary.

## PD-020 - Word-based scoring with an internal streak multiplier

**Decision:** Score each terminal song from the number of answer words solved
by the player divided by the number of answer words hidden after the baseline
attempt-1 reveal. System-revealed words never earn player credit, and a failed
song keeps partial credit for words solved before failure. There is no separate
attempt-number penalty.

For a solved song, apply an internal per-song streak multiplier based on the
consecutive solved-song position: `1.00`, `1.05`, `1.10`, `1.15`, and `1.20`
for streak positions 1 through 5. Failed songs reset the streak and use no
streak multiplier. Per-song scores are capped at 100; the challenge score is
the rounded average across the actual number of questions.

The score is exposed only after the challenge is complete. The multiplier is
server-internal and is not returned or displayed. Perfect is a separate
achievement for a song solved on attempt 1. A non-modal `LYRIC STREAK ×N`
celebration begins at two consecutive solved songs; when it coincides with
Perfect, Perfect is shown first.

**Why:** The baseline denominator makes a first-attempt solve capable of
reaching 100 despite the standard opening hints. Hint reveals still have a
clear cost without adding an arbitrary attempt penalty, while the bounded
streak reward makes consecutive successes feel meaningful without replacing
the word-accuracy signal.
