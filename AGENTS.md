# AGENTS.md

Instructions for AI coding agents working in this repository.

## Primary objective

Build the smallest reliable version of the Spotify saved-album lyric reconstruction game described in `README.md`.

The product loop matters more than infrastructure sophistication.

## Read first

Before changing code, read:

1. `README.md`
2. `PRODUCT_DECISIONS.md`
3. `DESIGN.md`
4. `ARCHITECTURE.md`
5. `API_CONTRACTS.md`
6. `BACKLOG.md`
7. `SETUP.md`

If documents conflict, use this precedence:

1. explicit instruction from the current user/session,
2. `PRODUCT_DECISIONS.md`,
3. `README.md`,
4. `ARCHITECTURE.md`,
5. `DESIGN.md`,
6. `API_CONTRACTS.md`,
7. `BACKLOG.md`.

## Current non-negotiable product rules

- Content source: user's Spotify saved albums and playlists.
- One question = 4 consecutive synced lyric lines.
- Up to 5 songs per challenge.
- Maximum 4 attempts per song.
- Attempt 1 starts around 80% masked.
- Correctly solved words remain locked.
- Later attempts progressively reveal more hints.
- Song title is not a question.
- Final scoring formula was intentionally undecided before M8; the current locked scoring rules are documented in `PRODUCT_DECISIONS.md` (PD-020) and the M8 iteration log.
- Playback is optional/reward-only.

Do not silently change these rules.

## Working principles

- Prefer simple code over generalized frameworks.
- Do not add a database unless the active task genuinely requires one.
- Do not add an LLM dependency.
- Keep Spotify and lyric integrations behind adapters.
- Validate external API responses at boundaries.
- Preserve deterministic challenge generation when a seed is supplied.
- Never require playback to finish a game.
- Never log access tokens, refresh tokens, authorization codes, or full lyric payloads in production logs.
- Never commit secrets.
- Avoid rendering lyrics beyond the selected gameplay fragment.

## Coding conventions

- Strict TypeScript.
- Next.js App Router.
- Tailwind for styling unless explicitly changed.
- Prefer named domain types.
- Keep React components thin.
- Use pure functions for LRC parsing, window scoring, seeded selection, tokenization, masking, matching, and progress transitions.
- Give lyric word tokens stable IDs so solved state survives later attempts.
- Separate `solved`, `revealed`, `hidden`, and non-answer/static token states.
- Keep scoring behind a replaceable boundary; do not invent the final formula.

## Testing priorities

High-priority unit tests:

- LRC timestamp parser,
- 4-line sliding window generation,
- lyric-window quality heuristic,
- answer normalization,
- token identity stability,
- ~80% initial masking,
- 4-attempt progressive reveal,
- solved-word locking,
- deterministic seeded selection.

High-priority end-to-end path later:

```text
login mocked
-> albums
-> select album
-> load 4-line puzzle
-> partially solve
-> next attempt preserves solved words
-> finish round
-> finish challenge
```

## Product guardrails

Do not silently introduce:

- global song search,
- artist-wide challenge mode,
- song-title guessing,
- AI-generated lyric text,
- mandatory Spotify Premium,
- global leaderboard,
- monetization.

## Before finishing a coding session

- run the relevant tests,
- run typecheck,
- run lint when configured,
- inspect for leaked secrets,
- report actual checks only,
- identify the single best next task.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
