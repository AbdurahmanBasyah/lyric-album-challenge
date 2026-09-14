# FillTheLyrics — Graffiti / Handwritten Accent System

**Status:** Canonical quick reference  
**Version:** 1.0  
**Source of truth:** Section 6.3 of `FILLTHELYRICS_CANONICAL_DESIGN_AND_MOTION_SPEC.md`

This file exists so a smaller coding worker can implement the graffiti system without hunting through the full design spec. If this quick reference conflicts with the main spec, **the main spec wins**.

## Core rule

Graffiti is a **decorative signature accent**, not UI content. It must never carry information required to play the game. When uncertain, omit the note.

## Visual rules

- Use one handwritten/marker family only.
- Colors: lavender/purple, mint, or muted off-white only.
- Opacity: roughly 45–80%.
- Rotation: normally -8° to +8°.
- Desktop size: roughly 18–32px equivalent.
- No background card.
- No strong glow.
- Optional short underline/double stroke.
- Keep at least ~24px from controls and ~32px from active lyric gaps where practical.

## Density

| Screen/state | Max |
|---|---:|
| Landing | 3 |
| Pre-start | 2 |
| Gameplay | 2 |
| PERFECT | 1 |
| STREAK | 1 |
| Round Complete | 2 |
| Results | 3 |
| Mobile | 0–1 |

These are maxima. Zero is valid.

## Good copy tone

```text
Keep going
Almost there
You knew that one
One word at a time
Same song, closer
Right on
Good pick
On a roll
That’s the one
Close one
Still a good song
```

Use short, state-aware wording. 2–5 words is ideal.

## Avoid

Do not blindly copy old generated slogans such as:

```text
Music connects us
Good music better days
Same songs different people
Music lives in the details
Lyrics bring us closer
Better lyrics brighter days
```

Do not use:

- marketing slogans,
- mission statements,
- paragraphs,
- instructions already present in UI,
- fake quotes,
- failure-shaming copy.

## Placement

Good:

- outer margins,
- negative space beside lyric stage,
- beside stage light,
- around scenic background,
- one supporting note near PERFECT/STREAK.

Never:

- over lyrics/gaps,
- over buttons/input,
- over difficulty labels,
- over YouTube controls,
- inside the main reading path.

## Responsive

- Desktop: normal intended density.
- Tablet: reduce count.
- Mobile: max one; hide all if space is tight.
- Never shrink notes to unreadable size just to keep them.

## Accessibility

Decorative annotations should normally use:

```tsx
aria-hidden="true"
```

and CSS equivalent to:

```css
pointer-events: none;
```

They must not enter tab order or interfere with controls.

## Component contract

```ts
export interface HandwrittenAnnotationProps {
  text: string;
  tone?: 'purple' | 'mint' | 'neutral';
  size?: 'sm' | 'md' | 'lg';
  rotateDeg?: number;
  underline?: 'none' | 'single' | 'double';
  className?: string;
}
```

Example:

```tsx
<HandwrittenAnnotation
  text="Almost there"
  tone="mint"
  rotateDeg={-5}
  underline="single"
  className="hidden lg:block absolute right-8 top-1/3"
/>
```

## Review checklist

- [ ] Decorative only.
- [ ] Within maximum count.
- [ ] Does not overlap required content.
- [ ] Uses one handwriting family.
- [ ] Uses approved palette.
- [ ] Copy is short and state-aware.
- [ ] Old AI-slogan copy was not copied blindly.
- [ ] Mobile hides/deprioritizes graffiti first.
- [ ] Accessible as decoration.
