# SETUP.md — Next.js + Tailwind Project Setup

This guide assumes Node.js and npm are installed.

## 1. Create the Next.js project

From the parent directory where you want the project:

```bash
npx create-next-app@latest lyric-album-challenge --typescript --eslint --tailwind --app --src-dir --import-alias "@/*"
cd lyric-album-challenge
```

If `create-next-app` asks interactive questions, choose:

```text
TypeScript?          Yes
ESLint?              Yes
Tailwind CSS?        Yes
src/ directory?      Yes
App Router?          Yes
Import alias?        @/*
```

Current Next.js starter tooling can configure Tailwind automatically. If Tailwind was not selected or the generated setup is missing, install the current Tailwind/PostCSS packages manually:

```bash
npm install tailwindcss @tailwindcss/postcss postcss
```

`postcss.config.mjs`:

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

`src/app/globals.css`:

```css
@import "tailwindcss";
```

## 2. Run the starter

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

The public playlist landing flow can be exercised without Spotify credentials.
Do not proceed until the starter renders successfully.

## 3. Copy the planning docs into the repo root

Copy these files beside `package.json`:

```text
AGENTS.md
README.md
PRODUCT_DECISIONS.md
DESIGN.md
ARCHITECTURE.md
API_CONTRACTS.md
BACKLOG.md
SETUP.md
SESSION_01.md
SESSION_02.md
```

The AI coding agent should read these before modifying code.

## 4. Install initial dependencies

Keep the first dependency set small:

```bash
npm install zod
npm install -D vitest
```

Optional test UI/dom packages should be added only when a component test genuinely needs them.

Do not add a database, ORM, global state framework, or component library during the initial game-engine session.

## 5. Add useful npm scripts

Keep the generated scripts and add a typecheck/test command if missing.

Example `package.json` scripts:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

The exact generated lint script may differ with the current Next.js version; preserve the starter's working command when appropriate.

## 6. Suggested source structure

Create this gradually rather than generating empty files for everything at once:

```text
src/
  app/
    page.tsx
    albums/
    play/[albumId]/
    api/
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
    game/
      lrc.ts
      lyric-window.ts
      tokenize.ts
      mask.ts
      matching.ts
      seeded-random.ts
    spotify/
    lrclib/
  types/
  tests/
```

Session 01 should focus mostly on `lib/game/` and a minimal landing page.

## 7. Environment variables

Create `.env` or `.env.local` (both are loaded by the local Next.js setup):

```env
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/auth/spotify/callback
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000
AUTH_SESSION_SECRET=replace-with-at-least-32-random-characters
YOUTUBE_API_KEY=
```

Do not commit `.env` or `.env.local`.

Keep `.env.example` in the repository:

```env
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/auth/spotify/callback
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000
AUTH_SESSION_SECRET=replace-with-at-least-32-random-characters
YOUTUBE_API_KEY=
```

`SPOTIFY_CLIENT_SECRET` and `AUTH_SESSION_SECRET` are server-only. Never prefix
either value or the optional `YOUTUBE_API_KEY` with `NEXT_PUBLIC_`, commit an
environment file, or paste secret values
into issue reports or chat.

`YOUTUBE_API_KEY` is optional for the current resolver iteration. When set, it
is used only by the server-side YouTube adapter; a missing key leaves playback
resolution unavailable without blocking gameplay.

## 8. Spotify developer setup — required for browser auth verification

The primary public playlist URL flow does not require a Spotify developer app,
OAuth credentials, Premium, or manually allowlisted users. Follow this section
only when you need to exercise the compatibility `/albums` library flow.

Before testing the auth flow in a browser, open the [Spotify Developer
Dashboard](https://developer.spotify.com/dashboard) and:

1. Create an application.
2. Copy its Client ID and Client Secret into the matching server-only values in
   `.env.local`.
3. Add this exact redirect URI to the application's Redirect URIs list:

```text
http://127.0.0.1:3000/api/auth/spotify/callback
```

The URI must match `SPOTIFY_REDIRECT_URI` character-for-character. Spotify does
not accept the `http://localhost/...` variant for this setup; use
`http://127.0.0.1/...` consistently in both the browser URL and environment.

4. Request the library permissions used by the current MVP:

```text
user-library-read
playlist-read-private
playlist-read-collaborative
```

The saved-albums and playlist APIs are paginated, so the library picker must not
assume all items arrive in one request. Existing sessions created before playlist
support may need the app's explicit Spotify reconnect action to grant the new
playlist scopes.

Do not request playback scopes until the playback milestone actually needs them.

For a production deployment, use an HTTPS app URL and HTTPS callback URI, and
generate a fresh random `AUTH_SESSION_SECRET` of at least 32 characters. A real
Spotify login cannot be verified until the dashboard app is configured and
these local environment values are supplied.

## 9. Recommended implementation order

```text
Session 01
Next/Tailwind foundation
+ pure game engine

Session 02
Spotify auth
+ saved albums

Session 03
LRCLIB integration
+ challenge creation

Session 04
Gameplay UI

Session 05
Playback spike

M8 / M9
Scoring decision + MVP hardening
```

For the current public-first landing flow, a supplied canonical playlist URL
enters `POST /api/public-playlists/challenge`; no OAuth setup is needed for
that path. The existing session order above remains useful for maintaining and
testing the legacy library flow.

## 10. First verification checklist

Before starting Spotify work, these should pass:

```bash
npm run dev
npm run typecheck
npm run lint
npm test
npm run audit:privacy
```

The critical browser smoke test is also available after installing the local
Chromium binary once:

```bash
npx playwright install chromium
npm run test:e2e
```

The browser spec mocks all provider responses and must not contact Spotify,
LRCLIB, or YouTube.

## 11. Production deployment

This app uses Next.js server features (route handlers, OAuth, and the
process-local challenge store), so deploy it as a Node.js application rather
than a static export:

```bash
npm ci
npm run build
npm run start
```

Set `NEXT_PUBLIC_APP_URL` and `SPOTIFY_REDIRECT_URI` to the public HTTPS origin
and matching HTTPS callback registered in the Spotify dashboard. Supply
`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and a fresh
`AUTH_SESSION_SECRET` (at least 32 characters) as server environment variables.
`YOUTUBE_API_KEY` is optional and server-only. Never prefix secrets with
`NEXT_PUBLIC_` or commit an environment file.

The API routes send `Cache-Control: no-store`; `next.config.ts` also applies
basic production security headers. The challenge store is intentionally
process-local for this MVP, so restarts and multi-instance routing can expire
active challenge IDs. Run `npm run audit:privacy` against the built app before
publishing it.
