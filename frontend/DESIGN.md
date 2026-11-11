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
   except primary emphasis words, focus rings and the one "picked" block of the hero toolbox.
5. **Graph paper** — every page starts on the same sheet: 60px ruled cells (`line` at 60% opacity,
   1200 ÷ 20, so rules land on the container hairlines), masked to fade out down the page. One
   definition lives in `components/ui/paper.tsx` (`graphPaper`). The home hero animates it with
   parallax (`HeroBackdrop`); every other page wraps its content in `<Page>`, which pulls up under
   the transparent navbar and draws the still version (`PageBackdrop`). New pages must use `<Page>`
   rather than a bare `Container`, so no page ever sits on flat paper.
   **Grain** is site-wide, never per-section: one fixed `body::after` layer of ink specks at 9%
   opacity (no blend mode), below the navbar and click-through. It sits over cards and the dark
   band too, so every surface reads as the same paper.
6. **Figure captions** — illustrations get a mono caption with a leading rule: `—— Fig. 01 — …`.

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
- Radius: `sm 6px` (chips, kbd) · `md 10px` (buttons, inputs) · `lg 16px` (cards, palette). Nothing rounder except pills/dots — the navbar pill, its buttons and the announcement chip are the only fully rounded surfaces.
- Shadow: `shadow-card` (cards on hover) and `shadow-float` (command palette) only.

## E. Components

- **Button** — `primary` (ink fill, paper text), `secondary` (surface + line border), `ghost`. Height 40/48. Arrow icon nudges 2px on hover.
- **Badge** — mono uppercase, line border; `live` variant adds the signal dot.
- **Card** — surface, line border, radius lg, no shadow at rest; hover lifts border to ink-3 and adds `shadow-card`.
- **Navigation** — sticky. At the top it is the full-width ruled bar, transparent over the hero.
  After 24px of scroll it tucks into a **floating pill** (`max-w 920px`, `surface`/90 + blur,
  `line` border, `shadow-card`, fully rounded) over 500ms with the standard easing.
  - Links share one sliding **bubble** (`layoutId` spring, bounce 0.22): `paper-2` on hover,
    `ink` with paper text on the section you're reading (scroll-spy on the home page).
  - Nav buttons use the `pill` shape. A 1px `ink` reading-progress rule runs along the pill's
    straight bottom edge.
  - Mobile: the menu button becomes an ink circle (48px hit area); the menu is a `surface` card
    that drops out of the pill over a blurred `ink`/20 scrim; links stagger in.
- **Announcement chip** (hero) — fully rounded `surface` bubble with an inner `ink` tag bubble
  (pulsing signal dot + mono tag: New / Live / Next). Messages roll upward every 4.2s and the
  chip's width springs to fit; hover/focus pauses it; reduced motion shows the first message.
  Every message must be true and link to its tool.
- **Inputs** — surface, line border, radius md, accent focus ring.
- **FAQ** — native `details`, hairline separated, plus icon rotates 45°.

## E2. Tool pages (`/tools/[id]`)

Every tool page has the same layout, whatever the tool does, so people learn it once.

- **Header** is kept compact so the whole workbench sits on the first screen, even on a 1366×768
  laptop or a 390×844 phone. The status badge sits at the right end of the breadcrumb row. Below it,
  the icon box sits beside the title (last word in `serif-em`, `clamp(1.875rem, 3.4vw, 2.75rem)`)
  and a one-line description.
- **Workbench** (`components/tools/workbench.tsx`): the one `lg` card on the page (`surface`,
  `shadow-float`). Across the top is a **three-step tracker**. Numbers sit in `sm` boxes; a finished step
  turns `ink` with a check, the current step gets an `accent` hairline along its top edge. On phones,
  only the current step shows its name. The tool's UI goes in the body. Small print (rights, limits)
  goes in the `paper` footer strip, never in the body.
- **Rail**: "At a glance" **spec sheet** (`dl`, hairline rows: `Takes` / `Gives` / `Limit`
  (optional) / `Cost`, a few words each), then "What it does" (`features`), both as hairline lists.
  On phones it falls below the workbench.
- **Related tools**: a full-width section under the workbench and rail. A "Keep going" label sits over
  "Related *tools*" (h2, `serif-em` on the last word), with "All tools →" on the right. Below is a
  4-up hairline card grid (the same `gap-px bg-line` grid as `/tools`; 2-up on tablets, stacked on
  phones), with the same category first. Each card shows icon, status badge, name, description and
  a `Gives` spec row pinned to the bottom, so the rows line up.

### Tool kinds: how new integrations fit
Each tool in `lib/tools.ts` declares a `kind`, which picks its workspace and its default steps:

| kind | workspace | default steps |
|---|---|---|
| `link` | URL field → preview → save | Paste a link · Check the preview · Save the file |
| `file` | dashed drop zone + options | Add your files · Choose options · Download |
| `text` | input / result panes + action choice | Paste your text · Pick an action · Copy the result |
| `generate` | details + live preview square | Enter details · Adjust the look · Download |

A tool can rename its steps (`steps`) and list the choices for step two (`options`, which render as the
same `sm` chips as the hero's "Try" chips: selected = `ink`).

- **Live** tools take their workspace from the registry in `components/tools/playground.tsx`,
  looked up by id first, then by kind. To add a tool whose kind already has a workspace, add it to
  `tools.ts` and mark it `live`.
  - `link` → `DownloaderPlayground`, configured by `downloader`.
  - `file` → `ConvertPlayground` (one file in, one file out), configured by `converter`
    (`endpoint`, `input` noun, `extensions`, `maxMB`, `output`, `quality`). It starts with a
    `FileDrop` (`components/tools/file-drop.tsx`): a dashed `paper` box that is a real file input,
    turns `ink` while a file is dragged over it, and lists accepted formats in mono. The chosen file
    shows as a row: a still from the video, name, size and length. Step two's button doubles as the
    progress bar (upload %, then a slow sheen while the server works). The result is previewed before
    saving: audio gets `AudioPreview`, an `ink` play button with the real waveform (bars in `ink-3`,
    played bars in `ink`) as the seek bar. Nothing downloads until the person presses Download.
  - `pdf` (by id) → `PdfPlayground`: merge, split, organize and compress in one workbench. A **mode
    switch** sits in a ruled `paper` band under the step tracker: four equal segments (icon, name, mono
    hint), with an `ink` thumb that slides between them on the navbar's `layoutId` spring. Arrow keys
    move between modes; it locks while a job runs. Each mode renames the three steps.
    - **Pages** are shown as real thumbnails (`PageImage`, `components/tools/pdf-pages.tsx`): a 3:4
      `paper-2` frame with the page drawn by `/pdf/thumbnail`, lazy-loaded, its number shown while
      loading. A quarter turn scales it to 75% so it stays inside the frame. Page grids use
      `auto-fill` columns (≈3 on phones, 6–7 on laptops) in a hairline `paper` box that scrolls
      inside itself. On every tile, the mono `01` badge top-left is the page's place in the result and
      `p. 3` underneath is the page in the original. The badge turns `ink` on pages that are picked or in
      the active part.
    - Organize (`OrganizeBoard`): click or Space picks pages (Shift for a run); a toolbar of `sm`
      buttons (44px, icon-only on phones) turns, moves (earlier/later) or removes them. Pages also
      drag: anywhere with a mouse, by the grip on touch, and the others slide aside (layout spring).
      Keys: arrows move focus, Alt + arrows move the page, R turns, Delete removes. Removed pages
      wait in a dashed tray and go back where they came from. The button stays off until something
      has changed.
    - Split's "Chosen pages" shows the page grid under the range field (`SplitPicker`). A tray of
      part chips (the active one `ink`, "New part" dashed) picks which part clicks go into; pages in no
      part fade to 45% with an `out` tag. The field and the grid are one model: `+` joins ranges into a
      part (`1-3+5, 4`), and clicks rewrite the field.
    - PDFs show as a **sheet**: a small `surface` page with a folded corner and a mono `PDF` tag
      (with its merge position, `01`, `02`, when it's in a list). Use it for documents everywhere.
    - Merge keeps an ordered list. Rows reorder by dragging the grip, or with the up/down buttons
      (announced to screen readers). A compact `FileDrop` under the list adds more.
    - Split offers "Every page" / "Chosen pages" chips; ranges are typed in mono and parsed as you
      type into numbered part chips, so people see what they'll get before uploading.
    - Compress offers Light / Balanced / Strong chips plus a slider, and a hairline spec row with
      the real image DPI and JPEG quality the backend will use (`lib/pdf.ts` mirrors its formula).
    - Results: PDFs can be previewed inline; ZIPs list their parts (read from the archive);
      compression shows before/after bars. The secondary button goes back with inputs kept.
  - **The PDF family** (`family: "pdf"` in `lib/tools.ts`, workspaces in `components/tools/pdf/`): one page
    per PDF job (Merge PDF, PDF to Word, Sign PDF…), grouped as Organize / Optimize / Convert to PDF /
    Convert from PDF / Edit / Security. `/tools` lists them in their own section (`02 — PDF tools`) as
    compact hairline cells under group labels; the home grid shows only the `pdf` hub, never the family.
    - Merge, Split, Organize, Compress, Rotate, Remove pages and Extract pages reuse `PdfPlayground` on a
      fixed `mode` (no mode switch); Extract opens on "Chosen pages".
    - Everything else runs in **`PdfTask`** (`pdf/task.tsx`): one input (an uploaded PDF by token, a raw
      PDF for locked/damaged files, or an Office/HTML file), the tool's options, one `ProgressButton`, and
      the shared `ResultPanel` (preview for PDFs and images, ZIP contents, the exact size on Download, an
      optional info line from the server's `x-pdf-info`). A new tool supplies only its options and fields.
    - Options sit in a dashed `Panel` of hairline `Row`s (`pdf/kit.tsx`): `Chips` (selected = `ink`),
      `Toggle` (ink track), `Slider`, `Swatches`, `PositionGrid` (a small sheet with 6 or 9 dots),
      `PagesField`, `PasswordField`, `Notice`. Colours in swatches are the user's content, not site tokens.
    - **The page stage** (`pdf/page-stage.tsx`): the real page drawn by the server (`/pdf/thumbnail`, up to
      1000px), with an overlay in page fractions as seen (rotation applied, 0 at top-left), the same
      coordinates the backend takes. `PageView` hands its children the scale (px per PDF point) so text and
      strokes preview at their real size; `EditableBox` moves (drag, arrows), resizes (handles, Alt+arrows)
      and keeps ratio for images; `PageNav` is "‹ Page 3 of 12 ›" with a dot on pages that have marks.
    - Previews show the real result: page numbers and watermarks are drawn to scale on the page beside
      the options (sticky from `md`); crop dims everything outside the box and shows the size in mm;
      redactions are `ink`/80 boxes; compare marks removed text red and added text green on both versions.
    - Editors (Edit PDF, Sign PDF): an icon toolbar (`sm` buttons, 44px on phones, labels from `sm`), the
      stage, and a properties `Panel` for what's selected (or "Style for new things"). Delete removes,
      Escape lets go, Ctrl+Z undoes. Signatures are drawn, typed (Instrument Serif italic) or uploaded,
      and saved as trimmed transparent PNGs so they sit on the page like ink.
    - Tools that need a converter the server may lack (LibreOffice, Chromium, Tesseract, Ghostscript)
      check `/api/tools/convert/capabilities` and show a `warning` Notice with the action switched off,
      rather than failing after an upload.
    - Sizes: the four toolkit modes keep predicting sizes before the job (cheap server estimates). The
      single-purpose tools (conversions, OCR, edits) show the exact size on the result instead, before
      anything downloads: predicting it would mean running the whole job twice.
  - `qr` (by id) → `QrPlayground` (`kind: generate`): the template for every generate tool.
    - A **type switch** sits in the ruled `paper` band under the step tracker, the PDF mode switch widened
      to nine segments (icon over label, same `layoutId` ink thumb). On phones it scrolls sideways inside
      its band; arrow keys move between types. `?type=wifi` deep-links to a type. What was typed is
      kept when switching.
    - Body is two columns from `md`: the form (top) and the dashed **Look** panel (below) on the left,
      and a **sticky preview** on the right. On phones the preview sits between form and Look.
    - The preview is a **proof plate**: a `paper` square with crop marks at the corners (a checkerboard
      of `paper-2`/`surface` when the background is transparent) and a `Fig. 01 — 29 × 29 modules · EC M`
      caption. It is the real file, redrawn 350ms after any change; the previous code stays at 35%
      opacity with a mono "drawing" tag rather than flashing empty. Empty states say what's missing.
    - Look rows are hairline-separated, mono label over the controls: shape chips carry tiny SVG
      glyphs of the shape; colours are swatches + a native picker + a mono hex field (accepts `1ba`).
      Swatch colours are the user's content, not site tokens. Rare settings live in "More settings".
    - Format chips sit under the plate. Combinations the backend refuses are disabled with the reason
      as the title, and a change that would make one (a logo while on SVG) switches to PNG and says so.
    - The Download button carries the exact size; the line under it gives pixels, print size (PDF at
      300 dpi) or "vector". Scan risks (low contrast, inverted, transparent) show as `warning` notes.
      "Scanner reads" shows the exact encoded string (Wi-Fi passwords masked).
    - `lib/qrcode.ts` mirrors the backend schema and `build_payload`, so checks happen before sending.
  - The Workbench card uses `overflow-clip`, not `overflow-hidden`, so sticky panels inside it work.
  - **Sizes, before and after.** Every tool shows how big the result will be before anything is
    made or downloaded, and the exact size on the Download button once it is. Sizes are mono;
    predictions carry a `≈` (`formatSize` in `lib/media.ts`) and exact ones don't. Sources:
    downloaders get `estimated_size` from the backend preview (the same format the download picks);
    converters with a constant bitrate use `converter.bytesPerSecond` × the video's length; PDF
    tools run the real operation on the server (`/pdf/*/estimate`) against the copy uploaded once
    via `/pdf/upload`, so merge, split, organize and compress sizes are exact. While a size is being worked out,
    show the mono "measuring" spinner rather than a guess.
  - The step-two button is `ProgressButton` (`components/tools/progress-button.tsx`), shared by
    every file tool.
  - File uploads go through a route under `app/api/tools/` that streams the body to the backend
    (never buffered) with `proxyUpload` from `lib/backend.ts`. Check files in the browser first
    with the same rules as the backend (`checkFile`). PDF tools post to `/api/tools/pdf/<action>`,
    conversions to `/api/tools/convert/<action>`.
- **Not built yet** tools show their kind's workspace switched off (`inert`, 75% opacity), under a
  "Not built yet / Request it" strip. Never grey placeholder bars.
- Empty states teach rather than apologise. For example, link tools list "Links that work"
  instead of "Nothing here yet".

## F. Motion

- Easing `cubic-bezier(0.22, 1, 0.36, 1)`; durations 150ms (hover), 600ms (reveal).
- Reveal: fade + 12px rise, once, staggered 60ms in lists only.
- Hero headline: each line slides up from behind a mask (900ms, 100ms apart); copy, actions and stats follow with the standard rise.
- Hero palette: rises in with a 0.985→1 scale; rows stagger in once (50ms); the active-row fill slides between rows (shared layout spring); the list fades at the bottom edge while more rows are below; typewriter placeholder cycles through example tasks.
- Hero "Try" chips fill the palette query; the stats hairline draws in from the left.
- Marquee: slow linear loop, paused on hover.

### Hero 3D — "The toolbox" (`hero-object.tsx`)
- 27 rounded blocks (3×3×3) in `surface` / `paper-2`, one `ink` block and one `accent` block
  ("the tool you picked"). Matte (roughness ~0.9), soft daylight, a faint contact shadow (`ink` at 9%).
  Colors are read from the CSS tokens at runtime — never hard-code new ones.
- Intro: blocks fly in from a fixed scatter and lock into the cube (1.25s, staggered by layer).
- Idle: slow sway + 0.08 bob; leans toward the pointer (lerped). Every 5s the orange block slides
  out along its diagonal and back.
- Scroll: blocks spread apart as the hero leaves (eased, never jumps).
- **Interaction:** drag the cube (mouse, pen, or a sideways swipe) to turn it, with a little momentum; the tilt
  drifts back to level. Hovering a block lifts it and shows a grab cursor; clicking or tapping one slides it out
  and back. Only the cube itself is grabbable; vertical swipes still scroll the page (`touch-action: pan-y`).
  The mouse lean ignores touch. Reduced motion: still frames, but dragging still turns it.
- **Placement:** headline (`md:col-span-8`) and figure (`md:col-span-4`) share one row of the same 12-column grid
  as the copy/palette row, so the cube sits centred over the palette's right-hand columns. The caption sits level with
  the announcement chip, right-aligned to the content edge; the canvas starts under it and stops just above the
  palette, bleeding right into the gutter. Phones: the figure follows the headline (260/300px tall), caption below.
- The camera fits the cube to whatever box it gets (against the narrower field of view), so it is never cropped.
- Every screen size; three.js is imported on demand; the render loop sleeps off-screen and in hidden tabs;
  parallax only on `lg+`; no WebGL → the figure is removed and the hero closes up.

### Scroll, parallax, smooth motion
- Smooth wheel scrolling with Lenis (`lerp 0.1`, `allowNestedScroll` so the palette list scrolls
  first). Touch stays native. Anchor links glide and stop 72px below the top (clears the navbar).
  The mobile menu pauses it.
- Hero parallax depth, far → near, over the hero's own height: grid rules +240px, lamp wash +140px,
  toolbox +160px, headline +70px (and fades to 15%), content at page speed.
- Reduced motion: no Lenis, no parallax, no scroll spread, a single still frame of the toolbox.
- Everything respects `prefers-reduced-motion` (MotionConfig `reducedMotion="user"` + CSS).

## G. Responsive

- Mobile: nav collapses to a sheet; bento becomes a single column; palette list shows 4 rows; principle row becomes 2×2.
- Touch targets ≥ 44px; no horizontal overflow (marquee is clipped).
- Verified widths: 320 · 360 · 375 · 390 · 414 · 540 · 768 · 820 · 1024 · 1180 · 1280 · 1440 · 1920, plus phone landscape (740×360).
  Every route must pass at all of them with no element past the viewport edge.
- Safety nets (`globals.css`): `body` has `overflow-x: clip` (never `hidden`, which breaks the sticky navbar) and
  `overflow-wrap: break-word`. They are a backstop, not a layout tool: fix the overflowing element first.
  Decorative pieces that bleed past the container (the hero toolbox) clip on their own section with `overflow-x-clip`.
- **Tablet (md–lg)** is its own layout, not a stretched phone or a squeezed desktop: nav links tighten and "Request a tool"
  hides below `lg`; "How it works" stacks until `lg` (three columns only fit from 1024).
- **Single-column cards drop their desktop min-heights** (tool cells, step visuals, principles), so there are no empty gaps on phones.
- **Rows that can't fit stack, they don't truncate to nothing:** download rows put the description under the name;
  result actions (Download + secondary) stack full-width below `sm`; segmented switches (PDF modes, QR types) put the icon
  over the label on phones; swatch rows are a grid whose cells shrink together so they stay on one line.
- In a stacked `flex-col`, never give a fixed-height control `flex-1` (its height collapses to 0); use `w-full sm:flex-1`.
- `cn()` only joins classes and does not resolve conflicts, so to hide a component with base `inline-flex`, use a variant
  (`max-lg:hidden`), not `hidden lg:inline-flex`.
- The mobile menu caps at the viewport height and scrolls inside itself (landscape phones).
