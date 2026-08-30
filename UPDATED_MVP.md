# FillTheLyrics — Product Direction Update: Public Playlist Flow

## 1. Context

Implementasi FillTheLyrics saat ini sudah cukup jauh dan **tidak perlu dibangun ulang**.

Milestone sebelumnya sudah menghasilkan sebagian besar fondasi penting seperti:

- game/challenge flow;
- lyric retrieval melalui LRCLIB;
- lyric reconstruction gameplay;
- UI gameplay;
- state management;
- provider abstraction untuk playback;
- testing dan quality gates terkait implementasi yang sudah ada.

Status terakhir dari Manager:

> `M7-PLAYBACK-01` telah dijalankan ke dua worker Luna Max dan dinyatakan **BLOCKED oleh Spotify policy**, bukan karena kegagalan implementasi.

Setelah mengevaluasi policy Spotify terbaru, Project Owner memutuskan untuk **mengubah product direction secara terbatas pada Spotify integration layer**.

Ini **bukan rewrite** dan bukan perubahan arsitektur besar.

---

# 2. Product Decision

## Spotify OAuth tidak lagi menjadi bagian dari user flow

Target produk sekarang adalah:

> User dapat memainkan FillTheLyrics hanya dengan memasukkan URL playlist Spotify publik, tanpa login Spotify dan tanpa harus didaftarkan secara manual di Spotify Developer Dashboard.

Dengan demikian flow berikut sudah tidak menjadi target produk:

```text
User
→ Login with Spotify
→ Spotify OAuth
→ access token
→ playlist
→ game
```

Flow target sekarang:

```text
User
→ Paste public Spotify playlist URL
→ PublicPlaylistResolver
→ TrackSummary[]
→ existing lyrics/challenge pipeline
→ existing gameplay
```

Untuk playback/reveal, Spotify dapat tetap digunakan melalui **Spotify Embed** selama tidak membutuhkan user OAuth.

---

# 3. Primary Product Goal

Target utama milestone berikutnya adalah:

> Membuat FillTheLyrics dapat dimainkan oleh user lain tanpa Spotify login dan tanpa Spotify Developer allowlist.

User hanya perlu memiliki URL playlist Spotify yang bersifat **public**.

Contoh:

```text
https://open.spotify.com/playlist/xxxxxxxx
```

User kemudian dapat:

```text
Paste playlist
→ playlist diproses
→ lagu tersedia
→ challenge dibuat
→ game dimulai
```

Tidak boleh ada requirement bahwa user harus:

- login ke Spotify;
- memberikan username/email Spotify kepada Project Owner;
- dimasukkan ke Spotify Developer Dashboard;
- memiliki Spotify access token;
- memiliki Spotify refresh token.

---

# 4. Primary User Story

## US-PLAYLIST-01 — Play from Public Spotify Playlist

**As a player,**

I want to paste a public Spotify playlist URL,

so that I can play FillTheLyrics using songs from that playlist without connecting my Spotify account.

### Acceptance Criteria

Given:

```text
a valid public Spotify playlist URL
```

When user submits the URL,

Then:

1. system extracts the Spotify playlist ID;
2. system resolves playlist tracks through `PublicPlaylistResolver`;
3. playlist tracks are normalized into the application's existing track model;
4. eligible tracks continue through the existing lyrics pipeline;
5. lyrics are obtained using the existing LRCLIB integration;
6. challenge generation continues using the existing implementation;
7. user can start playing without Spotify authentication;
8. no Spotify user access token is required.

---

# 5. Secondary User Story

## US-PLAYLIST-02 — Invalid or Unsupported Playlist

**As a player,**

I want to receive a clear error when a playlist cannot be imported,

so that I understand why the game cannot start.

Possible cases:

```text
invalid URL
private playlist
playlist not found
playlist resolver unavailable
playlist contains no usable tracks
lyrics unavailable for all tracks
```

The application must fail gracefully.

Do not expose raw provider/network errors directly to the player.

Example UI message:

```text
We couldn't import this playlist.

Make sure the Spotify playlist is public and try again.
```

---

# 6. User Flow

Target user journey:

```text
Landing / Game Setup
        │
        ▼
Paste Spotify Playlist URL
        │
        ▼
Validate URL
        │
        ▼
Extract playlistId
        │
        ▼
PublicPlaylistResolver
        │
        ▼
Normalize tracks
        │
        ▼
existing TrackSummary / equivalent
        │
        ▼
existing LRCLIB pipeline
        │
        ▼
eligible tracks
        │
        ▼
existing challenge generation
        │
        ▼
existing gameplay
```

The critical requirement is that everything after:

```text
TrackSummary[]
```

should reuse the current implementation as much as possible.

---

# 7. Architecture Direction

Introduce a provider boundary approximately like:

```ts
interface PublicPlaylistResolver {
  resolvePlaylist(url: string): Promise<ResolvedPlaylist>;
}
```

Example normalized model:

```ts
interface ResolvedPlaylist {
  id: string;
  name?: string;
  tracks: ResolvedTrack[];
}

interface ResolvedTrack {
  spotifyId?: string;
  title: string;
  artists: string[];
}
```

The exact names may be adapted to existing conventions.

**Do not create duplicate models if compatible track models already exist.**

Prefer mapping directly into the application's existing:

```text
TrackSummary
Track
SongCandidate
```

or equivalent domain object.

---

# 8. Initial Resolver Provider

For the current personal-project scale, Project Owner approves using an **unofficial public Spotify playlist resolver**.

Current preferred provider:

```text
wolfXspotify-API
```

The implementation MUST be isolated behind the resolver abstraction.

Do not scatter calls such as:

```ts
fetch("https://spotify.xwolf.space/...")
```

throughout components or game services.

Instead:

```text
SpotifyPublicPlaylistResolver
              │
              ▼
        external provider
```

so that later we can replace:

```text
wolfX
```

with another resolver without modifying gameplay.

---

# 9. Provider Failure Must Not Affect Core Architecture

The system should approximately follow:

```text
                    ┌─────────────────────────┐
                    │ PublicPlaylistResolver  │
                    └────────────┬────────────┘
                                 │
                         wolfX implementation
                                 │
                                 ▼
                         normalized tracks
                                 │
                                 ▼
                    EXISTING GAME PIPELINE
```

If wolfX eventually stops working, only the resolver implementation should need replacement.

The following areas should **not** know which resolver provider is being used:

- gameplay;
- scoring;
- challenge generation;
- lyrics processing;
- answer validation;
- game state;
- reveal logic.

---

# 10. Spotify OAuth Decision

Spotify OAuth is now considered **legacy / unused for the primary player flow**.

### Important

Manager does **not** need to aggressively delete all OAuth-related code in this milestone.

The priority is:

```text
stop depending on OAuth
```

rather than:

```text
delete every OAuth file immediately
```

Existing code such as:

```text
Spotify login
OAuth callback
token management
refresh token
authenticated Spotify playlist picker
```

may remain temporarily if removing it would introduce unnecessary risk.

However:

> No new feature may depend on Spotify OAuth.

The primary user flow must function when the user has **no Spotify session whatsoever**.

Cleanup of dead OAuth code can be scheduled after the new public-playlist flow is verified.

---

# 11. M7 Playback Status

Do not reopen the previous Spotify Web API playback implementation.

Existing status remains:

```text
M7-PLAYBACK-01
STATUS: BLOCKED BY SPOTIFY POLICY
```

This status does not represent implementation failure.

The new playlist work is **not an attempt to bypass M7**.

It solves a different problem:

```text
How do users select their music without Spotify OAuth?
```

The answer is now:

```text
Public Spotify playlist URL
```

For playback/reveal, the preferred direction is:

```text
Spotify Embed
```

where possible.

Do not introduce another user OAuth dependency merely to enable playback.

If the current `PlaybackProvider` abstraction is already provider-neutral and stable, preserve it.

---

# 12. Existing Implementation Must Be Preserved

The primary engineering principle for this change is:

> Minimum necessary change.

Manager should assume existing working functionality is valuable.

Do not rewrite working components unless required by the new public-playlist flow.

In particular, preserve as much as possible from:

```text
lyrics pipeline
challenge generator
game engine
gameplay state
answer handling
reveal behavior
UI design
accessibility
tests
provider abstractions
```

The desired integration point is approximately:

```text
NEW
Public playlist URL
        ↓
PublicPlaylistResolver
        ↓

EXISTING
TrackSummary[]
        ↓
Lyrics
        ↓
Challenge
        ↓
Gameplay
```

---

# 13. UI Scope

Do not redesign the entire application.

Only introduce the minimum UI required for the new source flow.

Suggested interface:

```text
PLAY FROM PLAYLIST

Paste a public Spotify playlist

[ https://open.spotify.com/playlist/... ]

[ IMPORT PLAYLIST ]
```

Possible loading state:

```text
Importing playlist...
```

Success state may display:

```text
Playlist Name

42 tracks found
31 tracks available for FillTheLyrics

[ START GAME ]
```

Exact wording/design may follow the existing `DESIGN.md`.

The existing FillTheLyrics visual language should remain authoritative.

---

# 14. Lyrics Eligibility

Not every Spotify track will necessarily be playable.

Existing LRCLIB matching rules should remain authoritative unless a real blocker is discovered.

Expected flow:

```text
50 playlist tracks
        ↓
LRCLIB matching
        ↓
37 tracks with usable synced/plain lyrics
        ↓
37 eligible tracks
```

Do not fail the entire playlist just because some tracks have no lyrics.

The playlist should only fail when:

```text
0 playable tracks
```

or when the number of playable tracks is below an already-established game minimum.

---

# 15. Caching

Caching is recommended but should remain simple.

This is a small personal project.

Do not introduce:

```text
Redis
Kafka
RabbitMQ
distributed cache
background worker infrastructure
```

just for playlist importing.

If existing persistence/cache infrastructure exists, reuse it.

Otherwise a simple server-side cache or current database mechanism is enough.

Conceptually:

```text
playlistId
→ resolved tracks
→ fetchedAt
```

The goal is simply to avoid unnecessarily resolving the same playlist repeatedly.

Caching is secondary to getting the flow functional.

---

# 16. Explicit Non-Goals

The following are **NOT required** for this milestone:

- Spotify OAuth migration;
- Spotify Extended Quota application;
- private Spotify playlist support;
- Liked Songs import;
- Saved Albums import;
- personal Spotify Library import;
- Spotify user profile;
- synchronization with Spotify account;
- collaborative playlist ownership detection;
- multiplayer;
- social features;
- user account system;
- microservices;
- Redis;
- message queues;
- analytics overhaul;
- gameplay redesign;
- scoring redesign;
- major UI redesign;
- aggressive OAuth code deletion.

Avoid scope expansion unless necessary to make the primary user story work.

---

# 17. Manager Authority

Manager is explicitly authorized by Project Owner to modify project documentation so that repository documentation reflects the new product direction.

Manager may update files including, but not limited to:

```text
BACKLOG.md
ARCHITECTURE.md
API_CONTRACTS.md
PRODUCT_DECISIONS.md
ITERATION_LOG.md
WORKER_PLAN.md
WORKER_CONTRACT.md
README.md
DESIGN.md
AGENTS.md
CLAUDE.md
SETUP.md
SESSION_*.md
```

Manager should only edit files where the change is relevant.

Do not mechanically rewrite every Markdown file.

The objective is:

> repository documentation must no longer incorrectly imply that Spotify OAuth is required for the primary player experience.

---

# 18. Documentation Expectations

At minimum, Manager should inspect:

## `PRODUCT_DECISIONS.md`

Record the product decision:

```text
Spotify OAuth removed from primary player flow.

Public Spotify playlist URL becomes the primary music-source input.
```

---

## `ARCHITECTURE.md`

Update the source acquisition architecture from roughly:

```text
Spotify OAuth
→ Spotify Web API
→ tracks
```

to:

```text
Public Spotify URL
→ PublicPlaylistResolver
→ normalized tracks
→ existing challenge pipeline
```

---

## `BACKLOG.md`

Create/update the necessary work items.

Do not recreate completed milestones.

M0–M6 or other completed work should remain completed.

M7 Spotify Web API playback should remain documented as policy-blocked where appropriate.

Add only incremental work required by this pivot.

---

## `API_CONTRACTS.md`

If a new internal endpoint/service is introduced, document its request/response contract.

Example concept:

```http
POST /api/playlists/resolve
```

Request:

```json
{
  "url": "https://open.spotify.com/playlist/..."
}
```

Response concept:

```json
{
  "playlist": {
    "id": "...",
    "name": "...",
    "tracks": []
  }
}
```

The exact endpoint is not mandatory.

Prefer existing architectural patterns when available.

---

## `ITERATION_LOG.md`

Record:

- why Spotify OAuth approach was changed;
- that the previous M7 block was caused by Spotify policy;
- that Project Owner selected public playlist URL as the new player-facing source mechanism;
- that this is an incremental pivot rather than a rewrite.

---

# 19. Suggested Backlog Structure

Manager may adapt naming to existing conventions.

Suggested items:

### PUBLIC-PLAYLIST-01 — Resolver abstraction

Implement a provider-neutral public playlist resolver contract.

---

### PUBLIC-PLAYLIST-02 — wolfX adapter

Implement the initial resolver using wolfXspotify-API.

Normalize provider response into existing track domain models.

---

### PUBLIC-PLAYLIST-03 — Public playlist import API/service

Accept Spotify playlist URL and return usable track candidates.

---

### PUBLIC-PLAYLIST-04 — Challenge pipeline integration

Connect resolved tracks into the existing LRCLIB/challenge pipeline.

No Spotify user session may be required.

---

### PUBLIC-PLAYLIST-05 — Playlist URL UI

Replace or bypass Spotify login as the primary entry point with public playlist URL input.

---

### PUBLIC-PLAYLIST-06 — Error and empty states

Handle:

```text
invalid URL
private/unavailable playlist
provider failure
zero tracks
zero lyric-compatible tracks
```

---

### PUBLIC-PLAYLIST-07 — Tests and regression

Verify that existing gameplay remains unchanged.

---

### PUBLIC-PLAYLIST-08 — Legacy OAuth cleanup

Optional / later.

Only perform after the new flow is stable.

Remove unused OAuth code where safe and worthwhile.

This item should not block the MVP.

---

# 20. Definition of Done

This product-direction change is considered successful when:

### Player Experience

A person who has never been added to the Spotify Developer Dashboard can:

```text
open FillTheLyrics
→ paste a public Spotify playlist
→ import tracks
→ start a challenge
→ play the game
```

without Spotify login.

### Technical

The flow works with:

```text
no Spotify user token
no refresh token
no Spotify session
```

and resolved tracks enter the existing game pipeline.

### Regression

Existing:

```text
gameplay
lyrics logic
answer validation
scoring/state
reveal behavior
```

continue passing existing tests.

### Architecture

The external playlist provider is isolated behind a resolver abstraction.

### Documentation

Relevant repository Markdown files reflect the new product direction.

---

# 21. Constraints for Workers

When delegating this work to workers, Manager should emphasize:

1. Inspect existing implementation before writing new architecture.
2. Reuse existing models and services whenever possible.
3. Do not rewrite working game systems.
4. Do not reintroduce Spotify OAuth.
5. Do not attempt to defeat Spotify policy restrictions.
6. Keep provider-specific logic isolated.
7. Prefer small, reviewable changes.
8. Run existing quality gates after integration.
9. Update tests alongside behavior changes.
10. Report architectural blockers to Manager before broad refactors.

---

# 22. Instruction to Manager

You have authority to plan and execute this change through the existing workers.

You may:

- inspect the current repository;
- revise the backlog;
- modify architecture documentation;
- modify product decisions;
- update API contracts;
- update worker plans/contracts if required;
- create new incremental tasks;
- delegate implementation sequentially to workers;
- adjust implementation details where the existing codebase suggests a simpler integration.

You do **not** need Project Owner approval for small implementation-level decisions that preserve the product direction described here.

Escalate only if implementation would require changing one of these fundamental decisions:

```text
1. Requiring Spotify OAuth again.
2. Removing public playlist URL as the primary input.
3. Rewriting major parts of M0–M6.
4. Replacing the existing gameplay model.
5. Introducing major infrastructure.
6. Expanding the product beyond the current small personal-game scope.
```

---

# 23. Final Product Direction

The intended MVP experience is now simply:

```text
OPEN FILLTHELYRICS

        ↓

PASTE PUBLIC SPOTIFY PLAYLIST

        ↓

IMPORT SONGS

        ↓

PLAY
```

No Spotify account connection should be required.

The priority is not to create the most scalable Spotify integration.

The priority is to make FillTheLyrics easy to play with friends while preserving the working application that already exists.

Proceed incrementally.