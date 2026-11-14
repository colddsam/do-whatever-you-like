# Do-Whatever-You-Like — Design Direction

The single source of truth for every page. New sections and routes must use these
tokens and rules; do not introduce new colors, fonts, radii or shadows ad hoc.

## A. Concept — "The Worksheet"

Do-Whatever-You-Like is a growing toolbox for everyday digital chores (downloading, converting,
cleaning up files, writing, developer utilities). The identity borrows from a well-kept
paper worksheet: warm paper, black ink, hairline rules, indexed sections, and a single
signal-orange mark that says "this is where to act".

- **Personality:** capable, calm, direct, a little witty. Never loud.
- **Audience:** everyone who just wants a task done — creators, students, office workers, developers.
- **Primary journey:** land → type a task, or pick a collection → open the tool.
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
- **Mono (labels, indices, kbd):** Geist Mono — 400 / 500, uppercase, `tracking-[0.08em]`, 12px (`label-mono`).

Scale: display `clamp(2.75rem, 7vw, 6rem)` / leading 0.95 / tracking -0.04em ·
h2 `clamp(2rem, 4.5vw, 3.5rem)` / leading 1.02 / tracking -0.03em ·
h3 20px/600 · body-lg 18px/1.6 · body 15–16px/1.6 · small 13px · micro (mono labels, counts, badges) 12px.

**12px is the floor.** No readable text is set below 12px: not labels, counts, line numbers,
badges or captions on image previews. Use `text-[12px]` for one-off mono text (not `text-xs`,
which also changes line-height). A badge that holds 12px text is at least `h-5`. The only
exception is a decorative placeholder drawn inside a preview smaller than 24px (the icon
maker's "IMG" swatch), which nobody needs to read.

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
  - **Tools menu** (`components/layout/tools-menu.tsx`): "Tools" is a button (chevron turns) that opens a
    `surface` panel under the pill (`shadow-float`, 940px). Collections run down a `paper` column on the left,
    numbered `01–05` with counts, an `ink` thumb sliding to the one under the pointer or focus
    (`tools-menu-thumb`). The right side shows that collection in full: its title and blurb, "All N →", then
    PDF and Images group by group in three columns (every tool, two moves away), the small collections as
    icon rows with descriptions, and the hub as a row at the foot. A `paper` strip at the bottom links to
    the searchable directory. Opens on hover (70ms intent, 180ms grace) or click; ↓ opens it and focuses the
    first collection; Esc or a click outside closes it and returns focus to the button.
  - Mobile: the menu button becomes an ink circle (48px hit area); the menu is a `surface` card
    that drops out of the pill over a blurred `ink`/20 scrim. It leads with the five collections (icon,
    name, blurb, count, linking to their section of `/tools`), then the page links; rows stagger in.

## E1. Collections: how the toolbox is organised

Every tool belongs to exactly one of nine **collections** (`CLUSTERS` in `lib/tools.ts`, `clusterOf()`):
**Any file** (three groups), **PDF** (five groups), **Images** (five groups), **Developer** (ten groups,
hub: Developer utilities), **Text** (four groups), **Design** (Fonts, Colour, CSS), **Downloads**, **Audio & video** and
**Everyday** (Calculate & convert, Time & dates, Privacy & security, QR codes, Device & browser); Design's groups are Charts & diagrams, Fonts, Colour, CSS. The Developer, Text,
Everyday and Design-CSS pages are generated from `lib/utilities/catalog.ts`: each
page is one engine (format, minify, validate, hash, random, network, device…) with a `preset` as its
starting state, rendered by `components/tools/utilities/utility-tool.tsx`. A new page there is one line
in the catalogue; never a new component for a variant of an existing job. Editors that need room (the chart and flowchart makers) set `wide` on their `Tool`: the workspace spans all twelve columns and the spec sheet moves under it in two columns. Inside them the same language holds: settings in a right-hand panel of hairline `Row`s (sticky on desktop), ink for the selected chip, the accent only for selection, live state and the flow being played; chart palettes default to the site's own (Studio: accent, ink, success, warning…), and flowchart shapes default to soft tints of the token colours with a 2px border in the matching tone. Animation there is part of the output (charts grow, links flow, Play the flow), always with a way to replay it, and every animated export honours reduced motion. A standalone page for one tab of the developer hub (JSON formatter, JWT decoder…) is a `Tool` with `devTab` set: the hub opens on that tab, never a copy of it. Timers show the time left in the tab title; anything that flashes (the stuck-pixel fixer) carries a seizure warning. Engines render in the browser
only (a same-sized pulse placeholder on the server) because they use browser APIs and random output. Each has a name, a title (last word in `serif-em`), a one-line blurb, an icon, a `noun` for
counts ("30 PDF tools", "14 image tools"), an optional hub and its `featured` tools. Every surface reads
from it, so a new tool appears everywhere once it's in the registry:

- **Home** (`01 — Tools`): a hairline bento of the collections, not of single tools. PDF is the big card
  (group chips with counts, eight featured tools in two columns, "All 30 PDF tools →" and the toolkit);
  Images beside it; Developer (group chips, eight featured in two columns) and Text under them; Downloads
  (with the link field) and Audio & video; Design and Everyday; the request cell last. Rows are icon + name (+ description) + arrow, "Soon" in mono for tools in the works.
- **`/tools`** is a directory (`components/sections/tool-directory.tsx`): a filter field (`/` focuses it,
  Esc clears) that narrows everything as you type, using the same ranking as the palette. Collections are
  numbered sections (icon box, mono `01 — PDF · 30 tools`, title, blurb, "Open the PDF toolkit →"), each in
  its groups of compact hairline cells; the hub leads its collection as a full-width "All-in-one" cell.
  From `lg` a sticky rail lists the collections with counts, an `ink` thumb on the one being read
  (`directory-rail`, scroll-spy) and its groups as jump links; below `lg` the same is a sticky chip bar
  under the navbar. Collections with no matches fade to 35% and can't be jumped to; no matches at all
  offers to request the tool. Anchors: `/tools#pdf`, `/tools#pdf-convert-to-pdf`.
- **Tool pages**: the breadcrumb is All tools | collection › group, each a link to that part of the
  directory. Related tools rank the same group first, then the same collection; the link reads "All 30 PDF
  tools →" and the label "More in PDF".
- **Search palette**: results come under collection headings (mono name and count); browsing lists the
  collections in order, searching orders the collections by their best match. Ranking weighs a word in the
  name over keywords over description.
- **Footer**: one link per collection, then "All N tools". The marquee, announcement chip, FAQ answer and
  hero "Try" chips only name tools that work today (the FAQ counts come from the registry).
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
    Convert from PDF / Edit / Security, the PDF collection's groups (see E1).
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
  - `audio-to-text` (by id) → `TranscribePlayground` (`components/tools/transcribe/`): speech to text.
    - Step one offers the `FileDrop` (audio or video) and, under an `or` hairline, the **recorder**: an `ink`
      circle mic button that turns into a live strip (the signal dot pulsing for "live", a mono timer,
      the voice's level as scrolling `ink` bars, Discard and an `ink` Stop). It records WebM/Opus (MP4 on
      Safari), up to 2 hours, and explains blocked or missing microphones in words.
    - The source row is followed by `AudioPreview` (real waveform). It reports its time (`onTime`) and takes
      `seek` requests, so the transcript and the player stay in step. Recordings without a stated length
      (MediaRecorder WebM) are measured on load.
    - Options sit in the dashed `Panel`: **Language** (Detect + six common languages as chips, every other
      Whisper language in a "More languages…" select that turns `ink` when used) and **Words to expect**
      (names and jargon, sent to Whisper as context so it spells them right).
    - While it runs, `ProgressButton` gets a real fill (`progress`, seconds heard ÷ length) and a stage
      label (waiting / reading / loading the model / writing it down · 42%) with a time-left estimate as
      `workingHint`. The transcript streams in below as it's recognised (NDJSON from the backend).
    - **The transcript sheet** (`TranscriptSheet`): a `paper` box ruled like a worksheet: mono start times in
      the margin, a hairline margin rule, the words beside it. Live, lines fade up and the sheet follows the
      newest (unless the reader scrolled up). Finished, it **reads along**: the line being heard is filled
      `paper-2` and set in `ink`, and the sheet keeps it in view while playing. Clicking a time or a line
      plays from there. "Edit text" turns each line into a borderless text box (`field-sizing: content`)
      that shows its frame on hover and focus.
    - The result header gives the facts in mono (language and confidence, length, words, time taken). An
      unsure language guess (< 70%) gets a `warning` Notice offering to pick the language. No speech gets an
      info Notice, not an empty sheet.
    - Export: TXT / SRT / VTT / JSON chips (TXT can add start times), one line on what the format is for,
      and the Download button carrying the exact size. Copy text puts plain paragraphs on the clipboard.
    - The footer says honestly where the audio goes: our server, or Groq when the server uses it.
  - **The image family** (`family: "image"`, workspaces in `components/tools/image/`): iLoveIMG's thirteen jobs,
    one page each, grouped Optimize / Create / Modify / Convert / Security, the Images collection's groups (see E1). The hub is Image studio:
    Compress, Resize, Convert and Cut out behind the PDF toolkit's mode switch (`image-mode-thumb`), each mode the
    full single-purpose tool with its own steps.
    - Most run in **`ImageTask`** (`image/task.tsx`): drop one image or many (up to 30), shown as a hairline
      `paper` grid of thumbnails on the transparency checkerboard (`CHECKER`, the QR tool's), each with a mono
      `01` badge, pixel size and file size. Formats a browser can't draw (HEIC, TIFF, RAW, PSD) get a format
      tag instead of a picture. A tool can add a line under each thumbnail (resize shows `→ 200 × 133` before
      anything is sent), a CSS transform (rotate shows the turn), small buttons (rotate's turn/flip, shown on
      hover from `sm`, always on phones) or earlier/later arrows (animated GIF frame order).
    - Options sit in the dashed `Panel` of `Row`s from the PDF kit. While a result is on screen the options and
      thumbnails lock; "Change options" goes back to them, so nothing changes unseen.
    - Results: one image is previewed on the checkerboard; several come as a ZIP listed file by file with
      `before → after` sizes and the change in mono (from the backend's `X-Image-Info`). AI results (upscale,
      cut-out) get **`CompareSlider`**: the original over the result, wiped by an ink rule and a round handle
      (drag, or arrow keys), with mono Before/After tags.
    - Crop and blur draw on the picture (`stage`), reusing the PDF page stage's `EditableBox` inside a
      `data-stage` frame. Crop dims everything outside the box (a 9999px `ink`/55 shadow), shows rule-of-thirds
      lines and the size in a mono tag, and keeps exact pixel fields in sync. Blur finds faces on its own
      (YuNet), shows each as a numbered box with a live `backdrop-filter` blur, and lets any face be kept sharp
      or areas be added by hand.
    - Watermark previews on the first image with the server's own maths (size relative to width, padding,
      shadow, turn direction, nine positions, brick-tiled mosaic) and the same fonts: the OFL families the
      backend bundles are loaded with `next/font` (`image/fonts.ts`, not preloaded). Hindi and Bangla text switch
      to Noto Devanagari/Bengali on both sides. Anton ("Impact") has one weight, so Bold is off for it.
    - **Browser-only tools** (meme generator, photo editor) never upload: the canvas is the file, the Download
      button carries its exact size (made at full resolution once edits pause), and the footer says the picture
      never leaves the device. The photo editor's tabs (Adjust, Filters, Shape, Text, Stickers, Frame) slide an
      ink thumb (`photo-tab`); text and stickers are live elements over the canvas, dragged into place, drawn
      into the file at the same spot.
    - Grids that hold a canvas use `grid-cols-[minmax(0,1fr)]` on phones: an `auto` track grows to the canvas's
      natural width and pushes the page sideways.
  - `convert-anything` (by id) → `UniversalConverter` (`components/tools/universal/`): any file to any format it
    can become (112 formats in 15 families). The formats and routes come from `lib/universal-formats.json` (made by
    `backend/scripts/export_universal_formats.py`) so the picker works at once, then from the live server
    (`/api/tools/universal/formats`), which leaves out anything that server lacks.
    - Step one is the `FileDrop` (accepts anything) over **Fig. 01 — What we read**: a disclosure that opens a
      hairline grid of the families (icon, name, count, every format as mono extensions). The format is read from
      the name (longest extension first, like the backend); an unknown or missing extension gets a `warning` Notice
      and a "It's a…" select, grouped by family.
    - Step two is a dashed `Panel`: **Most asked** (2–3 columns of large tiles: icon box, mono extension, name,
      chosen per source in `SUGGESTED`), then **Every format**: a search field (matches id, name, extension,
      family and aliases like "word", "excel"), family chips with mono counts (scroll sideways on phones, wrap from
      `sm`), and the formats as a `gap-px bg-line` hairline grid of tiles (selected = `ink`). A tile whose name is
      just its extension ("PDF") shows its family instead, so nothing reads twice.
    - The line under `ProgressButton` is the **route**: the formats it passes through in mono with arrows, then the
      engines ("· pdf2docx, then Pandoc"), plus a plain note for ZIP bundles, OCR and video re-encoding.
    - Results use the shared `ResultPanel` (`kindLabel` names the format) with extra previews: `AudioPreview` for
      audio, a `<video>` for MP4/WebM/MOV, a picture for WebP/GIF/AVIF/SVG/ICO/BMP, and a mono
      `paper` box with the first 6 KB of text results. The backend's notes (`x-convert-info`) go in the small print.
  - The Workbench card uses `overflow-clip`, not `overflow-hidden`, so sticky panels inside it work.
  - **Presets, not copies.** Popular pairs (PDF to Word/Excel/PowerPoint/JPG, Word/PowerPoint/Excel to PDF,
    Video to MP3) are tools with a `preset: { from, to }` in `lib/tools.ts`, rendered by the same
    `UniversalConverter`: the drop zone takes only `from`, the picker becomes a mono `PDF → DOCX` line with
    "Convert to another format ↗", and a pair's options (PDF→images DPI/pages/extract, PDF→Excel sheets,
    spreadsheet→PDF fit, audio bitrate) sit in a dashed `Panel` above the button. Never build a second
    workspace for a pair the converter can run.
  - **Any-file tools** (`components/tools/files/`): `compress-files`, `merge-files`, `split-files`.
    - They share `FileStack` (`files/kit.tsx`): Merge PDF's list (folded `Sheet` labelled with the file's
      extension, grip to drag, arrow buttons announced to screen readers, × to remove) with a compact `FileDrop`
      under it. Families mirror the backend in `lib/file-tools.ts`; a file of another family is refused with
      the reason, never silently dropped.
    - Merge shows "You'll get" (one format, N files in this order) and the family's options; Split reads the
      file first (`/merge-split/inspect`, or the browser's media duration) and offers only splits that exist:
      heading levels show their part counts, a deck lists its slide titles, a workbook its sheets and columns.
      The button always says how many parts ("Split into 3 parts") or why it can't yet.
    - Compress's strengths are three radio cards (title + one line), and the result lists every file with a
      before/after bar (ink, animated once), the change in green, notes in the small print, and any file that
      failed in `danger` with its reason, while the rest still download.
  - **Icon maker** (`image/icon-tool.tsx`): options on the left, a sticky preview on the right (stacked first
    on phones): the icon on the checkerboard, a browser tab, a dark home-screen row (iOS rounds its own
    icons, so that one is square and opaque), and a strip at actual pixel sizes. Shape, padding and background
    are CSS on the preview, mirroring exactly what `services/icon/engine.py` draws.
  - **Scan to PDF** (`pdf/scan/`): a full-screen camera (`camera.tsx`, a portal over the page, near-black
    `#0d0c09` so the picture reads true) with three bands: close / guidance pill / torch + Auto on top, the
    viewfinder (exactly the video's shape, via container units, so the outline lines up), and thumbnail /
    shutter / Done at the bottom. The guidance pill changes colour with what's asked (searching: translucent
    with a spinner; adjust: paper; good: success; warn: warning). While searching, viewfinder brackets frame the
    view and an accent scan line sweeps; once a page is found its outline glides (smoothed in `lib/scan.ts`),
    brackets sit on its corners, and the accent outline draws itself as the page holds steady (the same progress
    rings the shutter). A capture flashes paper-white, and the new page's thumbnail springs into the corner.
    Vision runs in `public/scan/scan-worker.js` (OpenCV.js from `/vendor`, copied from npm by
    `scripts/copy-vendor.mjs`; nothing leaves the device). Pages sit in a tray of 3:4 tiles; tapping one opens the
    editor below it: `CornerEditor` (four accent handles, draggable or arrow-keyable, with a 3x loupe while
    dragging), the four looks as radio cards, turn left/right, and the cleaned result.
  - **Developer utilities** (`dev/`): a rail of 13 utilities grouped Data / Encode / Inspect / Convert /
    Generate (an ink thumb slides between them; one scrolling row on phones). The choice lives in the URL hash
    (`#jwt`), so each has a link. Inputs are `Editor` (file tab on top, mono line/char count under) and results
    `Output` (the same frame, read-only, with a spring copy button and download); lists of values use `ValueRow`.
    Layouts inside respond to the panel's own width (`@container`), not the screen's, because the panel shares the
    page with the "At a glance" column.
  - **Design tools** (`design/`): the Font checker opens on a specimen card (big "Aa" in the font, name, verdict
    pill coloured by the worst check, a mono fact grid), then tabs with a sliding ink thumb: Type tester, Glyphs
    (a `gap-px` grid of outlines; tapping one opens its outline with metric lines and points), Checks, Languages
    (coverage bars that grow in), Details. The Colour picker is a picture with a pixel loupe that follows the
    pointer (11× zoom, sampled pixel outlined, its hex on a chip in its own colour) beside a detail card (the colour
    as a block, every notation with copy) and swatch groups; picked swatches spring in. The Font creator has a mode
    switch (Draw / Pixel / Handwriting), a character grid that fills with the user's own glyphs, editing canvases
    with accent guide lines (cap, x-height, baseline), and a live preview typed in the font being made.
  - **Browser-only media tools** (`media/`, `image/gif-speed-tool.tsx`, `image/pixelate-tool.tsx`, `image/emoji-tool.tsx`): nothing is uploaded, so the
    free server does no work. Video to frames and Video to GIF share `media/trim.tsx`: the video above a two-handle range (ink handles, accent
    track, mono times, "Start here / End here"), dragging a handle shows that moment. Frames are read by seeking a hidden `<video>` (`lib/video.ts`),
    shown as a `gap-px` hairline grid of tiles (mono `01 · 00:00.727` + a pick checkbox), downloaded as a ZIP (fflate) or a contact sheet. GIFs use
    `lib/gif.ts`: speed and looping are rewritten in place (lossless, said so on the button); reverse, boomerang and speeds past the 20 ms frame
    floor re-draw frames (gifenc, a palette per frame). Results sit on the `CHECKER`; before/after GIFs are `figure`s with a mono caption.
    Pixelate draws a live canvas preview (block averages, then squares/rounded/dots/mosaic, optional palettes) and can be limited to a dragged box.
    Emoji to image renders on a canvas from Noto/Twemoji/OpenMoji SVGs (jsDelivr, credited in the footer) or the device's emoji font.
  - **Scientific calculator** (`utilities/calculator-engine.tsx`): an `ink` display card (mono expression, the live answer in `paper-dim`, the final
    one large in `paper`, fraction/hex/binary under it) over two key grids: functions (5 columns, the `2nd` key turns `accent` and relabels its
    keys) and the number pad (4 columns; operators `paper-2`, `=` ink, AC `danger` text). mathjs evaluates; never `eval`.
  - **Drop zones** take the scanner's motif: while a file is held over one, four viewfinder brackets snap onto its
    corners.
  - **Reveal on tiles**: in a hairline grid (`gap-px bg-line`), never fade the tile itself, only its content;
    a faded tile shows the grid colour through as an empty slab until it scrolls into view.
  - **Sizes, before and after.** Every tool shows how big the result will be before anything is
    made or downloaded, and the exact size on the Download button once it is. Sizes are mono;
    predictions carry a `≈` (`formatSize` in `lib/media.ts`) and exact ones don't. Sources:
    downloaders get `estimated_size` from the backend preview (the same format the download picks); compress
    reports every file's size before and after; PDF
    tools run the real operation on the server (`/pdf/*/estimate`) against the copy uploaded once
    via `/pdf/upload`, so merge, split, organize and compress sizes are exact. While a size is being worked out,
    show the mono "measuring" spinner rather than a guess.
  - The step-two button is `ProgressButton` (`components/tools/progress-button.tsx`), shared by
    every file tool.
  - File uploads go through a route under `app/api/tools/` that streams the body to the backend
    (never buffered) with `proxyUpload` from `lib/backend.ts`. Check files in the browser first
    with the same rules as the backend (`checkFile`). PDF tools post to `/api/tools/pdf/<action>`,
    conversions to `/api/tools/universal/convert`, compression to `/api/tools/compress`, merge/split to
    `/api/tools/merge-split/<action>`, icons to `/api/tools/icon`, speech to text to `/api/tools/transcribe/run`.
    In production (`BACKEND_PUBLIC_URL` set) the route hands out a short-lived signed ticket instead and
    the browser sends the file straight to the backend, because Vercel caps a route at 4.5 MB and 300 s.
    `uploadForm` (and `streamTranscription`) do this for you; never post files to the backend any other way.
- **Not built yet** tools show their kind's workspace switched off (`inert`, 75% opacity), under a
  "Not built yet / Request it" strip. Never grey placeholder bars.
- Empty states teach rather than apologise. For example, link tools list "Links that work"
  instead of "Nothing here yet".

## F. Motion

- Easing `cubic-bezier(0.22, 1, 0.36, 1)`; durations 150ms (hover), 600ms (reveal).
- Reveal: fade + 12px rise, once, staggered 60ms in lists only.
- Hero headline and its intro paragraph: no entrance animation. They are painted with the server HTML
  because they are the page's largest content (LCP); hiding them until scripts load delayed LCP by
  seconds. Actions, suggestions and stats follow with the standard rise.
- Never put a page's largest above-the-fold element (a hero headline, a tool page's title, the tool
  workspace) inside `Reveal` or any opacity-0/transform entrance. Reveal is for content below the fold.
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
