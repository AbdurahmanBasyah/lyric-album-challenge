# API_CONTRACTS.md

Internal application contracts. External Spotify/LRCLIB shapes must be mapped before reaching UI code.

## GET `/api/albums`

Returns the authenticated user's saved albums.

The optional `cursor` query parameter is an opaque offset cursor returned by a
previous response. The browser must send it back unchanged and must not depend
on Spotify's provider URL or pagination fields.

```json
{
  "items": [
    {
      "spotifyId": "album-id",
      "name": "Album Name",
      "artistNames": ["Artist"],
      "imageUrl": "https://...",
      "totalTracks": 12
    }
  ],
  "nextCursor": null
}
```

Possible error responses are intentionally provider-neutral:

```json
{ "error": "SPOTIFY_AUTH_REQUIRED" }
{ "error": "SPOTIFY_RATE_LIMITED" }
{ "error": "SPOTIFY_UNAVAILABLE" }
{ "error": "INVALID_CURSOR" }
```

Use HTTP 401 for `SPOTIFY_AUTH_REQUIRED`, 429 for
`SPOTIFY_RATE_LIMITED`, 502 for `SPOTIFY_UNAVAILABLE`, and 400 for
`INVALID_CURSOR`. Configuration failure remains HTTP 503 with
`AUTH_UNAVAILABLE`, consistent with the authentication routes.

## GET `/api/playlists`

Returns playlists exposed by the authenticated user's Spotify library. The
optional `cursor` is the same opaque decimal offset pattern used by albums; the
browser must not depend on Spotify's provider pagination URL.

```json
{
  "items": [
    {
      "spotifyId": "playlist-id",
      "name": "Playlist Name",
      "ownerName": "Owner",
      "imageUrl": "https://...",
      "totalItems": 24,
      "itemsAvailable": true,
      "isPublic": true,
      "spotifyUrl": "https://open.spotify.com/playlist/playlist-id"
    }
  ],
  "nextCursor": null
}
```

Possible error responses are provider-neutral:

```json
{ "error": "AUTH_UNAVAILABLE" }
{ "error": "SPOTIFY_AUTH_REQUIRED" }
{ "error": "SPOTIFY_SCOPE_REQUIRED" }
{ "error": "SPOTIFY_RATE_LIMITED" }
{ "error": "SPOTIFY_UNAVAILABLE" }
{ "error": "INVALID_CURSOR" }
```

Use HTTP 503 for `AUTH_UNAVAILABLE`, 401 for
`SPOTIFY_AUTH_REQUIRED`, 403 for `SPOTIFY_SCOPE_REQUIRED`, 429 for
`SPOTIFY_RATE_LIMITED`, 502 for `SPOTIFY_UNAVAILABLE`, and 400 for
`INVALID_CURSOR`.

For a playlist whose metadata is visible but whose item collection is not
available, `totalItems` is `null` and `itemsAvailable` is `false`. Such a
playlist remains visible for attribution but is not selectable as a challenge
source until item access is available.

## POST `/api/public-playlists/challenge`

Creates a short-lived challenge from a canonical public Spotify playlist URL.
This is the primary anonymous entry point; it does not read the Spotify session
cookie, refresh OAuth, or call Spotify from the browser.

```json
{
  "url": "https://open.spotify.com/playlist/playlist-id",
  "seed": "optional-printable-seed",
  "targetCount": 5
}
```

The server accepts only the canonical `open.spotify.com/playlist/{id}` shape
(with the documented trailing slash/query/hash normalization and optional
trivial locale prefix). It resolves the playlist through the server-only
Spotify Embed adapter, normalizes only the minimal track contract
(`spotifyId`, `name`, `artistNames`, and bounded `durationMs`), drops records
missing required fields, and runs the existing synced-LRCLIB candidate
pipeline. Album/track/disc-position metadata is not required and is never
fabricated or returned in challenge payloads. `targetCount` defaults to 5 and
is bounded to 1 through 5. A successful response is HTTP 201 and uses the
normal rendered challenge envelope, with a source discriminator such as:

```json
{
  "challenge": {
    "id": "opaque-challenge-id",
    "seed": "resolved-seed",
    "source": {
      "kind": "public-playlist",
      "spotifyId": "playlist-id",
      "canonicalUrl": "https://open.spotify.com/playlist/playlist-id",
      "displayName": "Optional playlist name"
    },
    "questionCount": 1,
    "completedQuestionCount": 0,
    "complete": false
  }
}
```

Questions use the same masked four-line representation documented below; raw
provider records, full lyric payloads, and hidden answers are never returned.
The current cumulative visible targets are `0.30`, `0.50`, `0.70`, and `0.80`
for attempts 1 through 4, equivalent to 70%, 50%, 30%, and 20% masked.
All responses use `Cache-Control: no-store`.

Stable public-flow errors are:

```json
{ "error": "INVALID_INPUT" }
{ "error": "PUBLIC_PLAYLIST_PRIVATE" }
{ "error": "PUBLIC_PLAYLIST_NOT_FOUND" }
{ "error": "PUBLIC_PLAYLIST_RATE_LIMITED" }
{ "error": "PUBLIC_PLAYLIST_UNAVAILABLE" }
{ "error": "PUBLIC_PLAYLIST_INVALID_RESPONSE" }
{ "error": "LYRICS_RATE_LIMITED" }
{ "error": "LYRICS_PROVIDER_UNAVAILABLE" }
{ "error": "INSUFFICIENT_LYRICS" }
```

Statuses are 400 for invalid input, 403 for private, 404 for not found, 429
for rate limits, 502 for provider failures/invalid responses, and 422 when no
playable synced-lyric question survives. A valid playlist with zero eligible
tracks is distinct from an upstream failure and returns `INSUFFICIENT_LYRICS`.

## Internal YouTube resolver (M7C-YOUTUBE-01)

There is no browser-facing YouTube search/lookup endpoint. Server callers may
pass one canonical `TrackSummary` to the optional resolver. It calls
fixed official Data API v3 search/details endpoints, validates an embeddable
candidate, and returns either a reduced result containing `videoId`, confidence,
and duration derivations or a typed unavailable reason. Search/details work is
bounded and cached in process; API keys, raw provider envelopes, and candidate
metadata never cross this boundary. A missing key or unavailable candidate must
not block challenge creation.

## POST `/api/challenges/{challengeId}/questions/{questionId}/playback` (M7C-YOUTUBE-02/03/04)

This optional route resolves playback only after the referenced question is
`solved` or `failed`. The request body must be empty or `{}`; the server reads
the track from its opaque challenge/question handles. Active questions return
`QUESTION_NOT_ACTIVE`, and malformed/unknown handles use the existing stable
challenge errors. Public-playlist challenges use their opaque handle without
OAuth; legacy album and authenticated-playlist challenges retain the session
gate.

Successful and unavailable provider results share a reduced, no-store envelope:

```json
{ "playback": { "provider": "youtube", "status": "available", "videoId": "dQw4w9WgXcQ", "startAtMs": 8500 } }
{ "playback": { "provider": "youtube", "status": "unavailable", "reason": "low-confidence" } }
```

Only a validated 11-character YouTube video ID may be returned. The response
never contains API keys, provider URLs, raw response fields, descriptions,
thumbnails, licensing metadata, or resolver diagnostics. `startAtMs` is derived
from the server-owned first timestamp of the terminal question's four-line
window as `max(0, firstTimestampMs - 1500)`; request input cannot override it and
no end timestamp is returned. The client may use the ID and hint to render a
visible player after terminal reveal and make a best-effort play attempt only
when more than half of that player is visible. Playback is optional, has a
manual fallback when autoplay is blocked, and does not mutate or gate challenge
state or claim exact synchronization. The initial request is still same-origin
and server-owned; no client click payload or end boundary is accepted.

## POST `/api/challenges`

Creates a short-lived, server-controlled challenge from one source that is
already in the authenticated user's Spotify library. The server verifies
membership through Spotify before it performs bounded track and LRCLIB work.

```json
{
  "source": {
    "kind": "album",
    "spotifyId": "spotify-album-id",
    "displayName": "Album Name"
  },
  "seed": "optional-printable-seed",
  "targetCount": 5
}
```

`source.kind` is exactly `album` or `playlist` on this authenticated legacy
route; public URL imports use the separate endpoint above. IDs are trimmed
Spotify IDs, not URLs or URIs. An album requires a non-empty `displayName` because the
existing album-track adapter needs that lookup context. Playlist
`displayName` is optional and presentation-only. `targetCount` defaults to 5
and accepts integers from 1 through 5. If `seed` is omitted, the server
generates a cryptographically random seed and returns it.

Successful creation returns HTTP 201 and exposes rendered state, not raw
hidden answers:

```json
{
  "challenge": {
    "id": "opaque-challenge-id",
    "seed": "resolved-seed",
    "source": {
      "kind": "album",
      "spotifyId": "spotify-album-id",
      "displayName": "Album Name"
    },
    "questions": [
      {
        "id": "opaque-question-id",
        "attempt": 1,
        "maxAttempts": 4,
        "lines": [
          {
            "timestampMs": 87430,
            "tokens": [
              { "id": "l0t0", "text": "Maybe", "state": "revealed" },
              { "id": "l0t1", "text": "___", "state": "hidden" }
            ]
          }
        ],
        "hiddenTokenIds": ["l0t1"],
        "progress": {
          "solved": 0,
          "revealed": 1,
          "totalAnswerTokens": 10
        }
      }
    ],
    "questionCount": 1,
    "completedQuestionCount": 0,
    "complete": false
  }
}
```

One to five questions is valid; a source may produce fewer than the requested
target when only that many eligible tracks are available. A source with no eligible
lyrics returns HTTP 422 with `{ "error": "INSUFFICIENT_LYRICS" }` and is not
stored. Creation and guess responses use `Cache-Control: no-store`. Other
stable creation errors are `AUTH_UNAVAILABLE` (503),
`SPOTIFY_AUTH_REQUIRED` (401), `SPOTIFY_SCOPE_REQUIRED` (403),
`SPOTIFY_RATE_LIMITED` (429), `SPOTIFY_UNAVAILABLE` (502),
`SOURCE_NOT_IN_LIBRARY` (403), `SOURCE_INACCESSIBLE` (403),
`LYRICS_RATE_LIMITED` (429), `LYRICS_PROVIDER_UNAVAILABLE` (502), and
`INVALID_INPUT` (400).

Each question's `lines` array contains the selected four-line window; the
shortened examples above show one line shape for readability.

## GET `/api/challenges/:challengeId`

Recover the latest server-authoritative rendered state for an existing
challenge. Authenticated album/library challenges require the encrypted
`fillthelyrics_session` cookie. A challenge whose source is
`public-playlist` is intentionally recoverable anonymously by its opaque ID.
Both branches read only the process-local challenge store and do not call
Spotify or LRCLIB.

A successful response is HTTP 200 with the same masked `{ "challenge": ... }`
shape returned by creation. Active questions continue to hide track identity
and expected answers. Solved or failed questions include only their selected
four-line reveal and track metadata. The response uses `Cache-Control:
no-store`.

Malformed, expired, and unknown IDs return HTTP 404 with `{ "error":
"CHALLENGE_NOT_FOUND" }`. Authentication failures for legacy challenges
remain `AUTH_UNAVAILABLE` (503) or `SPOTIFY_AUTH_REQUIRED` (401). Recovery does
not make challenge state durable: process restart, expiry, or multi-instance
routing can still invalidate the ID.

## POST `/api/challenges/:challengeId/questions/:questionId/guess`

Submit unresolved answers by token ID:

```json
{
  "answers": {
    "l0t1": "lost",
    "l1t2": "ask"
  }
}
```

Partial/incomplete result:

```json
{
  "result": "continue",
  "questionId": "opaque-question-id",
  "attempt": 2,
  "maxAttempts": 4,
  "status": "active",
  "progress": {
    "solved": 7,
    "revealed": 2,
    "totalAnswerTokens": 10
  },
  "lines": [
    {
      "timestampMs": 87430,
      "tokens": [
        { "id": "l0t0", "text": "Maybe", "state": "revealed" },
        { "id": "l0t1", "text": "lost", "state": "solved" }
      ]
      }
    ],
  "hiddenTokenIds": ["l1t2"],
  "questionCount": 1,
  "completedQuestionCount": 0,
  "complete": false
}
```

For a hidden lexical word, `tokens[].text` contains only underscores and its
length matches the original Unicode code-point length. Whitespace and
punctuation remain separate static tokens. Active attempt-4 questions include
an additional bounded `titleHint` string containing the song title; attempts
1-3 omit it, and terminal questions use the existing `reveal.trackName`
instead. `titleHint` is metadata only and cannot be submitted as an answer.

Solved:

```json
{
  "result": "solved",
  "questionId": "opaque-question-id",
  "attemptsUsed": 2,
  "progress": {
    "solved": 10,
    "revealed": 0,
    "totalAnswerTokens": 10
  },
  "reveal": {
    "lines": [
      "Maybe we got lost in translation",
      "Maybe I asked for too much",
      "But maybe this thing was a masterpiece",
      "'Til you tore it all up"
    ],
    "trackName": "Example",
    "artistNames": ["Artist"],
    "startTimestampMs": 87430
  },
  "perfect": false,
  "streak": 1,
  "questionCount": 1,
  "completedQuestionCount": 1,
  "complete": true
}
```

Final failure:

```json
{
  "result": "failed",
  "questionId": "opaque-question-id",
  "attemptsUsed": 4,
  "progress": {
    "solved": 0,
    "revealed": 7,
    "totalAnswerTokens": 10
  },
  "reveal": {
    "lines": ["...", "...", "...", "..."],
    "trackName": "Example",
    "artistNames": ["Artist"],
    "startTimestampMs": 87430
  },
  "perfect": false,
  "streak": 0,
  "questionCount": 1,
  "completedQuestionCount": 1,
  "complete": true
}
```

Only unresolved hidden token IDs may be submitted. Unknown IDs,
static/revealed/solved tokens, non-string values, oversized records,
malformed JSON, and guesses against a finished question receive stable errors
without echoing the expected answer. Guess requests for legacy challenges
require the encrypted `fillthelyrics_session` cookie; `public-playlist`
challenges may be guessed anonymously by their opaque ID.

Guess-specific errors are `INVALID_GUESS` (400), `CHALLENGE_NOT_FOUND` (404),
and `QUESTION_NOT_ACTIVE` (409).

Challenge state is intentionally ephemeral: it is process-local, expires 30
minutes after creation, and is bounded to 100 active entries. A process
restart or multi-instance deployment can therefore lose an active challenge;
this is not durable history. The opaque challenge ID is a bearer handle within
that boundary. A valid Spotify session remains required for legacy challenges;
public challenges deliberately use the opaque ID as their anonymous handle.

## Anti-cheat principle

Where reasonably possible, do not send original hidden answers to the browser before solve/fail. Keep enough challenge state server-side or inside a signed/encrypted server-controlled payload to validate guesses.

## Scoring

Scores are calculated server-side from safe progress counts. A completed
challenge response includes a `score` object; incomplete challenge responses
omit it.

The score shape is:

```json
{
  "score": {
    "total": 82,
    "songs": [
      { "questionId": "opaque-question-id", "score": 82 }
    ]
  }
}
```

The per-song base is the number of words solved by the player divided by the
number of words hidden after the baseline attempt-1 reveal. Words revealed by
the system earn no player credit; failed songs retain partial credit. There is
no separate attempt-number penalty. Consecutive solved songs can apply a
bounded internal multiplier, but that multiplier is never returned in an API
response or rendered by the client. Per-song scores and the challenge total
are bounded integers from 0 through 100, and the total is averaged over the
actual question count.

Terminal guess responses also include two presentation-safe celebration facts:

```json
{
  "perfect": true,
  "streak": 2
}
```

`perfect` is true only when that song is solved on attempt 1. `streak` is the
current consecutive solved-song count, is zero for a failed song, and is used
only for the non-modal Perfect/Lyric Streak celebration. These facts do not
change challenge completion or playback behavior.

API responses expose the neutral progress facts used by the scorer:

- attempts used,
- words solved by player,
- words revealed as hints,
- total answer words,
- completion/failure state.
