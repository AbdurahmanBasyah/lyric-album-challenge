# FillTheLyrics / Lyric Link — Design System Base

## 1. Design Direction

This product uses a **dark neo-modern interface** with **glassmorphism surfaces**, **purple-to-mint neon accents**, and **soft volumetric lighting**.

The intended visual identity is:

- futuristic, but still clean
- game-like, but not overly flashy
- minimal, but visually rich
- modern, immersive, and premium

A suitable style label for this system is:

> **Neon Prism Glass**

---

## 2. Core Visual Principles

### Primary aesthetic pillars

1. **Dark neutral foundation**  
   Use a deep near-black background with subtle blue/green tint.

2. **Smoked glass surfaces**  
   Cards and panels should feel translucent, layered, and softly blurred.

3. **Restrained neon accents**  
   Use purple and mint primarily for:
   - active states
   - progress
   - successful actions
   - highlights
   - achievement moments

4. **Volumetric background lighting**  
   Use soft blurred colored lighting and shader-like light rays in the background.

5. **Minimal editorial layout**  
   Keep the layout clean, spacious, and readable. Avoid over-decorating every section.

---

## 3. Color System

### Background Colors

```css
--bg-base: #11141B;
--bg-elevated: #181C24;
--bg-soft: #20242D;
```

### Glass Surface Colors

```css
--glass-soft: rgba(34, 38, 47, 0.48);
--glass-default: rgba(38, 42, 52, 0.62);
--glass-strong: rgba(45, 49, 59, 0.78);
```

### Border Colors

```css
--glass-border: rgba(255, 255, 255, 0.14);
--glass-border-hover: rgba(255, 255, 255, 0.24);
--border-subtle: rgba(255, 255, 255, 0.08);
```

### Brand Accent Colors

```css
--purple-400: #D767FF;
--purple-500: #C354F5;
--purple-600: #A940D3;

--mint-300: #9BFFD0;
--mint-400: #7CF5BC;
--mint-500: #61DFA5;
```

### Brand Gradient

```css
--brand-gradient: linear-gradient(
  90deg,
  #D767FF 0%,
  #B68BFF 45%,
  #7CF5BC 100%
);
```

### Text Colors

```css
--text-primary: #F4F5F7;
--text-secondary: #B8BDC7;
--text-muted: #858C98;
--text-disabled: #606672;
```

### Semantic Colors

```css
--success: #7CF5BC;
--warning: #FFD166;
--danger: #FF647C;
--info: #67B7FF;
```

---

## 4. Usage Rules for Color

### Purple and mint should be used for:

- active navigation
- primary actions
- success states
- progress bars
- streak / score highlights
- completed puzzle moments
- key gameplay feedback

### Purple and mint should **not** be overused for:

- body text
- large blocks of UI
- every card border
- every icon
- all headings

### Recommended visual balance

> **80% dark neutral + 15% glass surface + 5% neon accent**

This is important to keep the design premium and not visually noisy.

---

## 5. Background Style

The background should not be flat. It should use:

- deep dark base
- large blurred colored light blooms
- subtle neon fog/glow
- optional shader/ray-light overlays

### Example background concept

```css
background:
  radial-gradient(circle at 15% 85%, rgba(194, 76, 255, .22), transparent 30%),
  radial-gradient(circle at 85% 5%, rgba(108, 242, 178, .17), transparent 30%),
  #11141B;
```

### Background lighting principles

- keep the center readable
- let light effects stay mostly behind main panels
- use lighting to create atmosphere, not clutter
- background effects should support gameplay UI, not compete with it

---

## 6. Glassmorphism System

### Glass Level 1 — Subtle Glass

Use for:
- navbar
- side panels
- small info boxes
- secondary UI

```css
background: rgba(30, 34, 42, .42);
backdrop-filter: blur(14px);
border: 1px solid rgba(255,255,255,.08);
```

### Glass Level 2 — Standard Glass

Use for:
- main cards
- gameplay panels
- containers
- stat cards

```css
background: rgba(38,42,52,.60);
backdrop-filter: blur(18px);
border: 1px solid rgba(255,255,255,.14);
```

### Glass Level 3 — Focus Glass

Use for:
- active panels
- modal windows
- key interaction sections
- success / focus states

```css
background: rgba(43,46,57,.72);
backdrop-filter: blur(24px);
border: 1px solid rgba(211,105,255,.40);
box-shadow:
  0 20px 60px rgba(0,0,0,.35),
  inset 0 1px 0 rgba(255,255,255,.08);
```

---

## 7. Border Radius

The UI should feel modern, but not overly soft.

```css
--radius-sm: 6px;
--radius-md: 10px;
--radius-lg: 16px;
--radius-xl: 22px;
```

### Suggested usage

- inputs: `8px – 10px`
- buttons: `8px – 10px`
- small cards: `12px`
- primary cards: `16px`
- modals / hero panels: `20px+`

---

## 8. Typography

### Recommended fonts

**Primary recommendation:**  
- **Space Grotesk**

**Good alternatives:**  
- Inter
- Geist
- Sora
- General Sans
- Manrope

### Typography strategy

- **Display / large feedback text:** Space Grotesk, bold
- **Headings:** Space Grotesk, semibold
- **Body text:** Inter or Space Grotesk, regular/medium

### Typography scale

```text
Display XL   64px
Display      48px
H1           40px
H2           32px
H3           24px
Body Large   18px
Body         16px
Small        14px
Caption      12px
```

### Typography tone

Text should feel:

- clean
- high-contrast
- calm
- slightly futuristic
- very readable

---

## 9. Glow System

Glow must be used with hierarchy, not everywhere.

### Glow Level 0 — No glow
Use for:
- most text
- most cards
- default UI surfaces

### Glow Level 1 — Small glow
Use for:
- input focus
- active nav
- icon hover
- selected chips

```css
0 0 12px rgba(..., .12)
```

### Glow Level 2 — Medium glow
Use for:
- primary button
- progress bar
- current selection
- important active elements

```css
0 0 24px rgba(..., .22)
```

### Glow Level 3 — Strong glow
Use for:
- “Perfect!” state
- streak badge
- achievement unlock
- success celebration

```css
0 0 40px rgba(..., .35)
```

### Important rule

Glow should indicate:
- interaction
- completion
- reward
- importance

Glow should **not** be used as decoration on every component.

---

## 10. Button System

### Primary Button

Use:
- dark fill
- gradient border
- subtle neon glow
- strong text contrast

Example visual logic:

```css
background:
  linear-gradient(#181C24, #181C24) padding-box,
  linear-gradient(90deg,#D767FF,#7CF5BC) border-box;
border: 2px solid transparent;
```

Hover:

```css
box-shadow:
  0 0 20px rgba(124,245,188,.20),
  0 0 26px rgba(215,103,255,.15);
```

### Secondary Button

```css
background: rgba(255,255,255,.05);
border: 1px solid rgba(255,255,255,.12);
```

### Destructive Button

```css
--danger: #FF647C;
```

Do not use the purple/mint brand palette for destructive actions.

---

## 11. Input System

Inputs should feel sleek and futuristic, but still readable.

### Base input

```css
background: rgba(19,22,29,.65);
border: 1px solid rgba(200,90,255,.65);
box-shadow: 0 0 18px rgba(198,80,255,.10);
```

### Focus state

```css
border-color: #D767FF;
box-shadow:
  0 0 0 3px rgba(215,103,255,.12),
  0 0 24px rgba(215,103,255,.16);
```

### Input guidelines

- text must remain highly readable
- placeholder should be muted
- focus state should feel alive, not aggressive
- neon effect should be strongest during active input

---

## 12. Navigation System

Navbar should be simple, clean, and lightly atmospheric.

### Navbar style

```css
background: rgba(17,20,27,.75);
backdrop-filter: blur(16px);
```

### Active nav item

Use:
- brighter text
- purple-to-mint underline or glow accent
- slightly elevated emphasis

### Navigation principles

- keep it minimal
- avoid turning the navbar into a large glass block
- let active state be clear but elegant

---

## 13. Layout Principles

### Preferred structure

```text
Header / metadata
Main heading
Short supporting description
Primary content
Secondary content / controls
Actions
```

### Layout rules

- use generous spacing
- avoid too many nested cards
- do not wrap every piece of content inside a glass panel
- use whitespace, typography, and separators to create hierarchy
- let key gameplay areas become the visual focus

### Avoid

- excessive card-inside-card design
- too many glow borders
- overly complex panel stacking
- large blocks of gradient-heavy UI

---

## 14. Spacing System

Use a consistent spacing scale.

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 24px;
--space-6: 32px;
--space-7: 48px;
--space-8: 64px;
--space-9: 96px;
```

### Principle

Do not use arbitrary spacing values unless there is a strong design reason.

---

## 15. Component Mood by Page

### Home
Mood:
- welcoming
- immersive
- slightly cinematic

Use:
- atmospheric hero section
- one main CTA
- glass feature cards
- subtle lighting effects

### Play / Gameplay
Mood:
- focused
- rewarding
- clear

Use:
- one dominant gameplay panel
- strong visual hierarchy
- visible progress / streak / timer
- success feedback with higher glow intensity

### Daily Challenge
Mood:
- special
- collectible
- ritual-based

Use:
- badge-like daily number
- clear “today’s challenge” emphasis
- subtle exclusive feel

### Leaderboard
Mood:
- competitive
- clean
- efficient

Use:
- simple structured rows
- highlight top 3 and current user
- do not make every row glow

### Profile
Mood:
- personal
- polished
- progress-driven

Use:
- avatar with subtle accent ring
- visible stats
- clean achievement sections
- limited decorative effects

---

## 16. Brand Tone Summary

The interface should feel like:

- a polished modern music game
- premium but accessible
- futuristic without becoming chaotic
- immersive without losing usability

### Keywords

- dark
- neon
- glass
- atmospheric
- minimal
- futuristic
- premium
- synthwave-inspired
- soft gaming UI

---

## 17. Full Design Tokens

```css
:root {
  /* Background */
  --bg-base: #11141b;
  --bg-elevated: #181c24;
  --bg-soft: #20242d;

  /* Glass */
  --glass-soft: rgba(34, 38, 47, .48);
  --glass: rgba(38, 42, 52, .62);
  --glass-strong: rgba(45, 49, 59, .78);

  /* Border */
  --border-subtle: rgba(255,255,255,.08);
  --border-default: rgba(255,255,255,.14);
  --border-hover: rgba(255,255,255,.24);

  /* Brand */
  --purple: #d767ff;
  --purple-dark: #a940d3;
  --mint: #7cf5bc;
  --mint-dark: #61dfa5;
  --brand-gradient: linear-gradient(
    90deg,
    #D767FF 0%,
    #B68BFF 45%,
    #7CF5BC 100%
  );

  /* Text */
  --text-primary: #f4f5f7;
  --text-secondary: #b8bdc7;
  --text-muted: #858c98;
  --text-disabled: #606672;

  /* Semantic */
  --success: #7cf5bc;
  --warning: #ffd166;
  --danger: #ff647c;
  --info: #67b7ff;

  /* Radius */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --radius-xl: 22px;

  /* Spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 64px;
  --space-9: 96px;
}
```

---

## 18. Reusable AI Design Prompt

Use this if you want consistent page generation in AI design tools:

> Design this page using a dark neo-modern interface with smoked-glass panels, restrained purple-to-mint neon accents, soft volumetric background lighting, subtle translucent borders, and clean futuristic typography. Use a deep near-black background, soft glow hierarchy, rounded corners, and a premium synthwave-inspired atmosphere. Keep layouts minimal and readable. Reserve the strongest glow for active states, progress, achievements, and reward moments. Avoid overusing neon or placing strong glow on every component.

---

## 19. Final System Summary

This design system should be consistently applied across all pages.

### Identity formula

> **Dark Neo-Modern + Glassmorphism + Purple/Mint Neon + Volumetric Lighting + Editorial Typography**

### Core rule

Neon is not the base.  
Neon is the reward.

The foundation of the interface should remain:
- dark
- calm
- spacious
- premium
- readable

The accent system should communicate:
- action
- progress
- success
- delight

---
