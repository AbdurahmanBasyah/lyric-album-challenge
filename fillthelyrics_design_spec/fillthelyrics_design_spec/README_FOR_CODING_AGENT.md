# FillTheLyrics Redesign — Coding Agent Entry Point

Read this file before editing UI code.

The full implementation source of truth is:

`FILLTHELYRICS_CANONICAL_DESIGN_AND_MOTION_SPEC.md`

Focused graffiti/handwritten quick reference:

`GRAFFITI_HANDWRITTEN_ACCENT_SYSTEM.md`

Reference images are under `assets/`.

## Required reading order

For a weaker/smaller coding model, do **not** try to redesign from the screenshots directly.

Read the main spec in this order:

1. Sections 0–3 — source-of-truth rules and gameplay logic
2. Sections 4–7 — visual identity and tokens, especially Section 6.3 graffiti rules
3. Sections 10–15 — gameplay shell, lyric states, input, difficulty
4. Sections 16–20 — PERFECT, STREAK, round complete, results
5. Sections 22–31 — motion
6. Sections 32–40 — component contracts and implementation order
7. Sections 41–46 — QA, anti-drift, definition of done

## Non-negotiable summary

- Canonical landing: `assets/canonical-landing.png`.
- Canonical remaining states: `assets/canonical-state-board.png`.
- One gameplay shell for Expert/Hard/Medium/Easy.
- Exactly 4 lyric lines.
- Difficulty = progressively reveal complete words only.
- Easy adds song-title hint.
- Solved user word = bright mint plain text.
- System hint = softer mint plain text.
- Only unresolved words remain input-like gaps.
- PERFECT and STREAK are overlays, not pages/routes.
- Solved and failed Round Complete use the same layout.
- YouTube is right-side on desktop Round Complete and only appears after the round.
- Do not introduce Home/Leaderboard/Community navigation during active gameplay.
- Do not invent new scoring or game rules.
- No monospace-heavy developer aesthetic.
- Graffiti/handwritten notes are a sparse decorative system; follow Section 6.3 and `GRAFFITI_HANDWRITTEN_ACCENT_SYSTEM.md`.
- Never use graffiti for required instructions, lyric answers, or clickable UI.
- Preserve purple-left / mint-right stage atmosphere.
- Support keyboard, reduced motion, and mobile layout.

## Implementation method

Work in small phases. After each phase, run the project and verify against the acceptance criteria before moving on.

Do not attempt a one-shot rewrite of the entire app.

Recommended order:

1. inspect/reuse existing domain logic
2. tokens + global stage atmosphere
3. canonical gameplay shell
4. lyric-state components
5. Expert/Hard/Medium/Easy behavior
6. RoundComplete shared component
7. PERFECT/STREAK overlays
8. landing/setup/results
9. motion lab + animation tuning
10. responsive/accessibility QA

## If a screenshot and the text spec disagree

Follow the text spec.

Example: some generated screenshots show revealed mint words inside capsules. The canonical implementation explicitly says solved/revealed words become plain lyric text. Implement the text rule, not the capsule.

## Do not guess missing product behavior

If a behavior is not defined here and not already implemented in the existing app, preserve existing behavior or mark a TODO. Do not silently invent product logic.
