# Do-Whatever — Design Direction

The single source of truth for every page. New sections and routes must use these
tokens and rules; do not introduce new colors, fonts, radii or shadows ad hoc.

## A. Concept — "The Worksheet"

Do-Whatever is a growing toolbox for everyday digital chores (downloading, converting,
cleaning up files, writing, developer utilities). The identity borrows from a well-kept
paper worksheet: warm paper, black ink, hairline rules, indexed sections, and a single
signal-orange mark that says "this is where to act".

- **Personality:** capable, calm, direct, a little witty. Never loud.
- **Audience:** everyone who just wants a task done — creators, students, office workers, developers.
- **Primary journey:** land → type / pick a task → open the tool.
- **Density:** generous whitespace, content aligned to a ruled grid; sections separated by hairlines rather than cards floating on gradients.

### Signature motifs (use consistently, nowhere else)
1. **Hairline rules** — 1px `--line` borders frame the container and separate sections.
2. **Mono indices** — every section opens with a mono label like `01 — Tools`.
3. **Serif italic emphasis** — one or two words per headline set in Instrument Serif italic.
4. **Signal dot** — the orange dot marks "live", "active", and the logo. Nothing else is orange
   except primary emphasis words and focus rings.

## B. Color tokens (`src/app/globals.css`)

| Token | Value | Use |
|---|---|---|
| `paper` | `#F3F0E8` | page background |
| `paper-2` | `#EAE6DB` | secondary band, hover fill |
| `surface` | `#FBFAF6` | cards, palette, inputs |
| `ink` | `#15140F` | primary text, primary button, dark band |
| `ink-2` | `#57544A` | secondary text |
| `ink-3` | `#8A867A` | muted labels, placeholders |
| `line` | `#DAD5C8` | borders, rules |
| `accent` | `#EB4A10` | signal dot, emphasis, focus |
| `ink-raised` | `#1F1E19` | surfaces inside the dark band |
| `line-dark` | `#33312A` | rules inside the dark band |
| `paper-dim` | `#A9A496` | secondary text inside the dark band |
| `success` / `warning` / `danger` | `#2F7D4F` / `#B7791F` / `#C2410C` | states |

Light theme only — the paper identity is the brand. The dark `ink` band is an inversion
of the same palette, not a separate theme.

## C. Typography

- **Sans (UI + headings):** Geist — 400 / 500 / 600.
- **Display emphasis:** Instrument Serif Italic — headline accent words only.
- **Mono (labels, indices, kbd):** Geist Mono — 400 / 500, uppercase, `tracking-[0.08em]`, 11–12px.

Scale: display `clamp(2.75rem, 7vw, 6rem)` / leading 0.95 / tracking -0.04em ·
h2 `clamp(2rem, 4.5vw, 3.5rem)` / leading 1.02 / tracking -0.03em ·
h3 20px/600 · body-lg 18px/1.6 · body 15–16px/1.6 · small 13px.

## D. Layout

- Container `max-w-[1200px]`, gutters `px-5 md:px-8`; on `lg` the container carries left/right hairlines.
- Section spacing `py-20 md:py-28`. Spacing scale = Tailwind 4px base.
- Grids: 12-col mental model; bento uses `lg:grid-cols-6`.
- Radius: `sm 6px` (chips, kbd) · `md 10px` (buttons, inputs) · `lg 16px` (cards, palette). Nothing rounder except pills/dots.
- Shadow: `shadow-card` (cards on hover) and `shadow-float` (command palette) only.

## E. Components

- **Button** — `primary` (ink fill, paper text), `secondary` (surface + line border), `ghost`. Height 40/48. Arrow icon nudges 2px on hover.
- **Badge** — mono uppercase, line border; `live` variant adds the signal dot.
- **Card** — surface, line border, radius lg, no shadow at rest; hover lifts border to ink-3 and adds `shadow-card`.
- **Navigation** — sticky, paper with 80% opacity + blur, bottom hairline appears on scroll.
- **Inputs** — surface, line border, radius md, accent focus ring.
- **FAQ** — native `details`, hairline separated, plus icon rotates 45°.

## F. Motion

- Easing `cubic-bezier(0.22, 1, 0.36, 1)`; durations 150ms (hover), 600ms (reveal).
- Reveal: fade + 12px rise, once, staggered 60ms in lists only.
- Hero palette: typewriter placeholder cycling through example tasks.
- Marquee: slow linear loop, paused on hover.
- Everything respects `prefers-reduced-motion` (MotionConfig `reducedMotion="user"` + CSS).

## G. Responsive

- Mobile: nav collapses to a sheet; bento becomes a single column; palette list shows 4 rows; principle row becomes 2×2.
- Touch targets ≥ 44px; no horizontal overflow (marquee is clipped).
