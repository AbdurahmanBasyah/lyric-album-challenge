# DESIGN.md

## Design goal

The game should feel like a focused music-memory challenge, not a Spotify dashboard.

Core flow:

```text
paste public playlist URL -> import -> reconstruct 4 lyric lines
-> reveal/hear section -> next song
```

The authenticated saved-album/playlist picker remains a secondary compatibility
flow and enters the same challenge screens after source selection.

## Visual direction

- Dark-first interface.
- Album art is the strongest supporting visual.
- Large readable lyric typography.
- Minimal navigation during gameplay.
- Strong distinction between hidden, solved, and revealed words.
- Motion should communicate progress, not decorate every interaction.

## Key screens

### 1. Landing

Primary message:

**How well do you know the albums you love?**

Content:

- one-sentence explanation,
- public Spotify playlist URL field,
- `Import playlist` CTA,
- small note that only a public playlist URL is sent to FillTheLyrics.

Do not present Login, Connect Spotify, or Choose Library as the primary landing
action. The existing authenticated library route may remain reachable through
legacy links.

### 2. Authenticated library picker (legacy)

```text
Choose an album

[ cover ]  [ cover ]
Album      Album
Artist     Artist
```

Behavior:

- responsive grid,
- paginate or infinite-load saved albums,
- search is optional until library size proves it necessary.

### 3. Challenge intro

```text
[album cover, when available]
HOW WELL DO YOU KNOW
Source Name
Artist or playlist owner

Up to 5 lyric challenges
4 attempts each

[Start]
```

For a public URL import, the intro uses the safe playlist display name when the
provider supplies one and otherwise a neutral fallback. It does not expose a
track preview before the challenge starts.

Do not reveal selected tracks before the challenge starts.

### 4. Gameplay

Top:

```text
Song 2 / 5
Attempt 1 / 4
```

Main lyric area:

```text
Maybe __ ___ ____ __ ___________
_____ _ _____ ___ ___ ____
___ _____ ____ _____ ___ _ ___________
'___ ___ ____ __ ___ __
```

The four lines should preserve natural line breaks. Each hidden lexical word
uses an underscore gap matching its original Unicode character length; static
punctuation and whitespace remain visible.

### Hidden-word interaction

Preferred UX: each hidden word behaves as an answer slot rather than requiring the player to retype the entire 4-line block.

Two acceptable implementations:

1. inline editable slots inside the lyric text, or
2. one compact answer area whose token inputs map positionally to hidden slots.

For MVP, choose the version that is most robust on mobile.

### After submission

Correct words become visibly locked and are not asked again.

Example:

```text
Maybe we got [lost ✓] in translation
Maybe I [_____] for too much
But maybe this [thing ✓] was a [masterpiece ✓]
'Til you [tore ✓] it all up
```

Do not rely on color alone. Use shape/icon/text treatment as well.

### Wrong / incomplete attempt

Do not frame a partially correct answer as a total failure.

Prefer feedback such as:

```text
7 of 10 missing words solved
Attempt 2 of 4
```

Then reveal additional hint tokens and preserve solved tokens.

When the fourth attempt becomes active, show the song title as a final metadata
hint. It is informational only and is never an answer input.

### Completed round

```text
You got it.

Maybe we got lost in translation
Maybe I asked for too much
But maybe this thing was a masterpiece
'Til you tore it all up

Song Title — Artist

[Play this part]
[Next]
```

The song title is revealed metadata, not a question. It may first appear as the
active fourth-attempt hint and is repeated in the terminal reveal.

Avoid displaying lyrics beyond the selected fragment.

### Final failure

After attempt 4, reveal the completed selected fragment and allow the player to continue without shame-oriented copy.

### 5. Results

When the challenge is complete, show a clear final score from the server and a
compact per-song score list. Do not show the internal streak multiplier or
recalculate scores in the browser. If the challenge is incomplete, explain
that the score appears after the remaining songs are finished.

Results screen should already support:

- album identity,
- songs completed,
- attempts used per song,
- percentage/number of words solved by the player,
- final score and per-song scores after completion,
- retry / choose another album.

The score is based on words solved by the player; system-revealed words do not
earn credit. A bounded internal streak multiplier may affect the final values,
but its numeric detail stays out of the visual design.

### 6. Achievement celebrations

After a song finishes, the game may show a short impact-style celebration
without interrupting the result card or navigation. A first-attempt solve uses
`PERFECT`; two or more consecutive solved songs use `LYRIC STREAK ×N`, even if
later attempts were needed. If both happen together, Perfect appears first.

The celebration should feel energetic and musical without copying another
game's assets: spring-scale type, soft glow, waveform/music accents, and
FillTheLyrics colors. It is a non-modal, pointer-transparent overlay that
auto-dismisses and respects reduced-motion preferences.

## Responsive behavior

Mobile is first-class.

- Keep 4 lyric lines readable without horizontal scrolling.
- Hidden slots must wrap naturally with text.
- Avoid input patterns that force excessive keyboard reopening.
- Make attempt/submit controls reachable near the bottom of the viewport.
- Album picker can use 2 columns on narrow screens.

## Accessibility

- Hidden, solved, and revealed states must be distinguishable without color alone.
- Buttons need visible focus styles.
- Album covers need descriptive alt text.
- Submission feedback should use an appropriate `aria-live` region.
- Achievement celebrations should use a polite live region without a dialog,
  focus trap, or interaction block.
- Do not require autoplay audio.

## Copy principles

Short and encouraging.

Prefer:

- `7 of 10 solved.`
- `Another clue unlocked.`
- `You got it.`
- `Last attempt.`
- `PERFECT`
- `LYRIC STREAK ×3`

Avoid:

- taunting failure messages,
- technical provider errors,
- excessive emoji.
