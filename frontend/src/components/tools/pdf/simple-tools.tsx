"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { formatBytes } from "@/lib/media";
import { toolHref } from "@/lib/tools";
import { cn } from "@/lib/utils";
import { FileDrop } from "../file-drop";
import { Chips, Notice, PagesField, pagesError, Panel, PasswordField, PositionGrid, Row, Slider, Swatches, TextField, Toggle } from "./kit";
import { PageNav, PageView } from "./page-stage";
import { plural } from "./parts";
import { PdfTask, type TaskContext } from "./task";

const pdfApi = (a: string) => `/api/tools/pdf/${a}`;

const INK_COLOURS = [
  { value: "#000000", name: "Black" },
  { value: "#4b5563", name: "Grey" },
  { value: "#1d4ed8", name: "Blue" },
  { value: "#b91c1c", name: "Red" },
];

/** A page of the PDF to preview an option on, with page switching for longer files. */
function Preview({ ctx, children, caption }: { ctx: TaskContext; children: (scale: number, page: number) => React.ReactNode; caption: string }) {
  const [page, setPage] = useState(1);
  const doc = ctx.doc!;
  const pages = doc.upload.pages;
  const current = Math.min(page, pages);
  return (
    <div className="space-y-2">
      <div className="mx-auto w-full max-w-[300px]">
        <PageView token={doc.upload.token} page={current} size={doc.upload.sizes?.[current - 1]}>
          {(scale) => children(scale, current)}
        </PageView>
      </div>
      <p className="text-center font-mono text-[12px] text-ink-3">—— {caption}</p>
      <div className="mx-auto max-w-[300px]">
        <PageNav page={current} pages={pages} onChange={setPage} />
      </div>
    </div>
  );
}

/** Options on the left, preview on the right (stacked on phones, preview first). */
function WithPreview({ options, preview }: { options: React.ReactNode; preview: React.ReactNode }) {
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px] md:items-start lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="order-2 md:order-1">{options}</div>
      <div className="order-1 md:sticky md:top-24 md:order-2">{preview}</div>
    </div>
  );
}

/** Whether `page` (1-based) is in a selection ("" = every page). */
function inSelection(selection: string, page: number) {
  if (!selection.trim()) return true;
  return selection
    .replace(/\+/g, ",")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .some((part) => {
      const [a, b] = part.split("-").map((n) => Number(n.trim()));
      return b ? page >= a && page <= b : page === a;
    });
}

/* ---------- Page numbers ---------- */

const NUMBER_STYLES = [
  { value: "n", label: "1" },
  { value: "n_of", label: "1 / 12" },
  { value: "page_n", label: "Page 1" },
  { value: "page_n_of", label: "Page 1 of 12" },
] as const;

export function PageNumbersTool({ toolId }: { toolId: string }) {
  const [position, setPosition] = useState("bc");
  const [style, setStyle] = useState<string>("n");
  const [start, setStart] = useState("1");
  const [pages, setPages] = useState("");
  const [size, setSize] = useState(11);
  const [margin, setMargin] = useState("small");
  const [color, setColor] = useState("#000000");
  const startNum = Number(start);
  const startOk = /^\d{1,6}$/.test(start);

  return (
    <PdfTask
      toolId={toolId}
      input={{ kind: "pdf" }}
      endpoint={pdfApi("page-numbers")}
      dropTitle="Drop the PDF to number"
      label="Add page numbers"
      working="Numbering…"
      invalid={(ctx) => (!startOk ? "Start from a whole number." : pagesError(pages, ctx.doc?.upload.pages ?? null))}
      fields={() => [
        ["position", position],
        ["style", style],
        ["start", String(startNum)],
        ["pages", pages],
        ["font_size", String(size)],
        ["margin", margin],
        ["color", color],
      ]}
      resultNote="Numbers sit upright on every page, turned ones included."
      options={(ctx) => {
        const total = ctx.doc!.upload.pages;
        const chosen = Array.from({ length: total }, (_, i) => i + 1).filter((p) => inSelection(pages, p));
        const label = (page: number) => {
          const i = chosen.indexOf(page);
          if (i < 0) return null;
          const n = (startOk ? startNum : 1) + i;
          const of = (startOk ? startNum : 1) + chosen.length - 1;
          return { n: `${n}`, n_of: `${n} / ${of}`, page_n: `Page ${n}`, page_n_of: `Page ${n} of ${of}` }[style];
        };
        return (
          <WithPreview
            options={
              <Panel>
                <Row label="Position">
                  <div className="flex items-center gap-4">
                    <PositionGrid cells={6} value={position} onChange={setPosition} disabled={ctx.locked} />
                    <p className="text-sm text-ink-2">{position.startsWith("t") ? "In the header" : "In the footer"}, {position.endsWith("l") ? "left" : position.endsWith("r") ? "right" : "centred"}.</p>
                  </div>
                </Row>
                <Row label="Style">
                  <Chips value={style} onChange={setStyle} disabled={ctx.locked} options={NUMBER_STYLES.map((s) => ({ value: s.value, label: <span className="font-mono">{s.label}</span> }))} />
                </Row>
                <Row label="Pages" hint={pages ? `${plural(chosen.length, "page")} numbered` : undefined}>
                  <PagesField value={pages} onChange={setPages} pages={total} disabled={ctx.locked} someLabel="Only some" />
                </Row>
                <Row label="First number">
                  <div className="max-w-[140px]">
                    <TextField value={start} onChange={setStart} label="First number" mono inputMode="numeric" invalid={!startOk} disabled={ctx.locked} />
                  </div>
                </Row>
                <Row label="Size and margin">
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    <Chips value={size} onChange={setSize} disabled={ctx.locked} options={[{ value: 9, label: "Small" }, { value: 11, label: "Medium" }, { value: 14, label: "Large" }]} />
                    <Chips value={margin} onChange={setMargin} disabled={ctx.locked} options={[{ value: "small", label: "Near the edge" }, { value: "large", label: "Further in" }]} />
                  </div>
                </Row>
                <Row label="Colour">
                  <Swatches value={color} colors={INK_COLOURS} onChange={setColor} disabled={ctx.locked} />
                </Row>
              </Panel>
            }
            preview={
              <Preview ctx={ctx} caption="Fig. 01 — the numbers on this page">
                {(scale, page) => {
                  const text = label(page);
                  if (!text || !scale) return null;
                  const gap = (margin === "large" ? 48 : 24) * scale;
                  return (
                    <span
                      className="absolute whitespace-nowrap font-sans leading-none"
                      style={{
                        fontSize: size * scale,
                        color,
                        [position.startsWith("t") ? "top" : "bottom"]: gap - (position.startsWith("t") ? 0 : size * scale * 0.2),
                        ...(position.endsWith("l") ? { left: gap } : position.endsWith("r") ? { right: gap } : { left: "50%", transform: "translateX(-50%)" }),
                      }}
                    >
                      {text}
                    </span>
                  );
                }}
              </Preview>
            }
          />
        );
      }}
    />
  );
}

/* ---------- Watermark ---------- */

const WM_COLOURS = [
  { value: "#c2410c", name: "Orange" },
  { value: "#b91c1c", name: "Red" },
  { value: "#1d4ed8", name: "Blue" },
  { value: "#4b5563", name: "Grey" },
  { value: "#000000", name: "Black" },
];

export function WatermarkTool({ toolId }: { toolId: string }) {
  const [mode, setMode] = useState<"text" | "image">("text");
  const [text, setText] = useState("CONFIDENTIAL");
  const [font, setFont] = useState("sans");
  const [bold, setBold] = useState(true);
  const [size, setSize] = useState(48);
  const [color, setColor] = useState("#c2410c");
  const [opacity, setOpacity] = useState(30);
  const [rotation, setRotation] = useState(45);
  const [position, setPosition] = useState("mc");
  const [layer, setLayer] = useState("over");
  const [pages, setPages] = useState("");
  const [image, setImage] = useState<File | null>(null);

  const [imageScale, setImageScale] = useState(40);
  const [imageError, setImageError] = useState<string | null>(null);
  const imageUrl = useMemo(() => (image ? URL.createObjectURL(image) : null), [image]);
  useEffect(() => (imageUrl ? () => URL.revokeObjectURL(imageUrl) : undefined), [imageUrl]);

  const fontFamily = font === "serif" ? "Georgia, 'Times New Roman', serif" : font === "mono" ? "'Courier New', monospace" : "Helvetica, Arial, sans-serif";

  return (
    <PdfTask
      toolId={toolId}
      input={{ kind: "pdf" }}
      endpoint={pdfApi("watermark")}
      dropTitle="Drop the PDF to watermark"
      label="Add the watermark"
      working="Stamping…"
      invalid={(ctx) =>
        mode === "text" && !text.trim() ? "Type the watermark text." : mode === "image" && !image ? "Add the image to stamp." : pagesError(pages, ctx.doc?.upload.pages ?? null)
      }
      fields={() => {
        const f: [string, string | Blob, string?][] = [
          ["mode", mode],
          ["text", text],
          ["font", font],
          ["font_size", String(size)],
          ["bold", String(bold)],
          ["color", color],
          ["opacity", String(opacity / 100)],
          ["rotation", String(rotation)],
          ["position", position],
          ["layer", layer],
          ["pages", pages],
          ["image_scale", String(imageScale / 100)],
        ];
        if (mode === "image" && image) f.push(["image", image, image.name]);
        return f;
      }}
      options={(ctx) => {
        const total = ctx.doc!.upload.pages;
        return (
          <WithPreview
            options={
              <Panel>
                <Row label="Stamp">
                  <Chips value={mode} onChange={setMode} disabled={ctx.locked} options={[{ value: "text", label: "Text" }, { value: "image", label: "Image" }]} />
                </Row>
                {mode === "text" ? (
                  <>
                    <Row label="Text">
                      <TextField value={text} onChange={setText} label="Watermark text" maxLength={200} disabled={ctx.locked} />
                    </Row>
                    <Row label="Font">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        <Chips value={font} onChange={setFont} disabled={ctx.locked} options={[{ value: "sans", label: "Sans" }, { value: "serif", label: "Serif" }, { value: "mono", label: "Mono" }]} />
                        <Toggle checked={bold} onChange={setBold} label="Bold" disabled={ctx.locked} />
                      </div>
                    </Row>
                    <Row label="Size">
                      <Slider value={size} min={12} max={140} onChange={setSize} format={(v) => `${v} pt`} label="Font size" disabled={ctx.locked} />
                    </Row>
                    <Row label="Colour">
                      <Swatches value={color} colors={WM_COLOURS} onChange={setColor} disabled={ctx.locked} />
                    </Row>
                  </>
                ) : (
                  <Row label="Image" hint={image ? formatBytes(image.size) : undefined}>
                    {image ? (
                      <div className="flex items-center gap-3 rounded-md border border-line bg-paper p-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {imageUrl && <img src={imageUrl} alt="" className="size-12 rounded-sm border border-line bg-surface object-contain" />}
                        <p className="min-w-0 flex-1 truncate text-sm text-ink">{image.name}</p>
                        <button type="button" onClick={() => setImage(null)} aria-label="Remove image" className="inline-flex size-9 items-center justify-center rounded-[8px] text-ink-3 hover:bg-paper-2 hover:text-ink">
                          <X aria-hidden className="size-4" />
                        </button>
                      </div>
                    ) : (
                      <FileDrop
                        compact
                        accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                        title="Add a logo or stamp"
                        formats="PNG (transparent works best) or JPG"
                        error={imageError}
                        onFile={(f) => {
                          if (!/^image\//.test(f.type)) return setImageError("That isn't an image. Try PNG or JPG.");
                          if (f.size > 10 * 1024 * 1024) return setImageError("Keep the image under 10 MB.");
                          setImageError(null);
                          setImage(f);
                        }}
                      />
                    )}
                    <div className="mt-3">
                      <Slider value={imageScale} min={10} max={100} onChange={setImageScale} format={(v) => `${v}%`} label="Image size" disabled={ctx.locked} />
                    </div>
                  </Row>
                )}
                <Row label="Look">
                  <Slider value={opacity} min={10} max={100} step={5} onChange={setOpacity} format={(v) => `${v}%`} label="Opacity" disabled={ctx.locked} />
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                    <Chips
                      value={rotation}
                      onChange={setRotation}
                      disabled={ctx.locked}
                      label="Angle"
                      options={[0, 45, 90, -45].map((r) => ({ value: r, label: `${r}°`, disabled: mode === "image" && r % 90 !== 0, title: mode === "image" && r % 90 !== 0 ? "Images turn in quarter turns" : undefined }))}
                    />
                    <Chips value={layer} onChange={setLayer} disabled={ctx.locked} options={[{ value: "over", label: "Over the page" }, { value: "under", label: "Under the text" }]} />
                  </div>
                </Row>
                <Row label="Position">
                  <div className="flex items-center gap-4">
                    <PositionGrid value={position === "tile" ? "" : position} onChange={setPosition} disabled={ctx.locked} />
                    <Toggle checked={position === "tile"} onChange={(v) => setPosition(v ? "tile" : "mc")} label="Repeat across the page" description="A tiled pattern is harder to crop out." disabled={ctx.locked} />
                  </div>
                </Row>
                <Row label="Pages">
                  <PagesField value={pages} onChange={setPages} pages={total} disabled={ctx.locked} />
                </Row>
              </Panel>
            }
            preview={
              <Preview ctx={ctx} caption="Fig. 01 — how the stamp sits">
                {(scale, page) => {
                  if (!scale || !inSelection(pages, page)) return null;
                  const size_ = ctx.doc!.upload.sizes?.[page - 1] ?? [595, 842];
                  const angle = mode === "image" && rotation % 90 !== 0 ? 0 : rotation;
                  const stamp = (key: string, style: React.CSSProperties) =>
                    mode === "text" ? (
                      <span
                        key={key}
                        className="pointer-events-none absolute whitespace-nowrap leading-none"
                        style={{ ...style, fontSize: size * scale, color, opacity: opacity / 100, fontFamily, fontWeight: bold ? 700 : 400, transform: `translate(-50%, -50%) rotate(${-angle}deg)` }}
                      >
                        {text}
                      </span>
                    ) : imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={key}
                        src={imageUrl}
                        alt=""
                        className="pointer-events-none absolute object-contain"
                        style={{ ...style, width: Math.min(size_[0], size_[1]) * (imageScale / 100) * scale, opacity: opacity / 100, transform: `translate(-50%, -50%) rotate(${-angle}deg)` }}
                      />
                    ) : null;
                  if (position === "tile") {
                    const out: React.ReactNode[] = [];
                    const [w, h] = size_;
                    const sx = Math.max(w / 3, 120);
                    const sy = Math.max(h / 4, 120);
                    for (let row = 0, y = sy / 2; y < h + sy; y += sy, row++) {
                      for (let x = sx / 2 + (row % 2 ? sx / 2 : 0); x < w + sx; x += sx) {
                        out.push(stamp(`${row}-${x}`, { left: (x - sx / 2) * scale, top: y * scale }));
                      }
                    }
                    return <div className="absolute inset-0 overflow-hidden">{out}</div>;
                  }
                  const [w, h] = size_;
                  const pad = Math.min(w, h) * 0.12;
                  const cx = { l: pad + w * 0.12, c: w / 2, r: w - pad - w * 0.12 }[position[1] as "l" | "c" | "r"];
                  const cy = { t: pad + h * 0.06, m: h / 2, b: h - pad - h * 0.06 }[position[0] as "t" | "m" | "b"];
                  return <div className="absolute inset-0 overflow-hidden">{stamp("one", { left: cx * scale, top: cy * scale })}</div>;
                }}
              </Preview>
            }
          />
        );
      }}
    />
  );
}

/* ---------- Protect / unlock / repair ---------- */

function strength(pw: string): { score: 0 | 1 | 2 | 3; label: string } {
  if (!pw) return { score: 0, label: "" };
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  const score = (s <= 1 ? 1 : s <= 3 ? 2 : 3) as 1 | 2 | 3;
  return { score, label: ["", "Weak", "Fair", "Strong"][score] };
}

export function ProtectTool({ toolId }: { toolId: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [print, setPrint] = useState(true);
  const [copy, setCopy] = useState(false);
  const [edit, setEdit] = useState(false);
  const st = strength(password);
  const mismatch = Boolean(confirm) && confirm !== password;

  return (
    <PdfTask
      toolId={toolId}
      input={{ kind: "pdf" }}
      endpoint={pdfApi("protect")}
      dropTitle="Drop the PDF to protect"
      label="Protect the PDF"
      working="Encrypting…"
      invalid={() => (!password ? "Choose a password first." : confirm !== password ? "The two passwords don't match yet." : null)}
      fields={() => [
        ["password", password],
        ["allow_print", String(print)],
        ["allow_copy", String(copy)],
        ["allow_edit", String(edit)],
      ]}
      resultNote="Encrypted with AES-256. Without the password, nobody can open it, including us."
      options={(ctx) => (
        <Panel>
          <Row label="Password" hint={st.label ? <span className={cn(st.score === 3 ? "text-success" : st.score === 2 ? "text-ink-2" : "text-warning")}>{st.label}</span> : undefined}>
            <PasswordField value={password} onChange={setPassword} label="Password" placeholder="Choose a password" disabled={ctx.locked} />
            <div className="mt-2 grid grid-cols-3 gap-1" aria-hidden>
              {[1, 2, 3].map((i) => (
                <span key={i} className={cn("h-1 rounded-full", st.score >= i ? (st.score === 3 ? "bg-success" : st.score === 2 ? "bg-ink-2" : "bg-warning") : "bg-paper-2")} />
              ))}
            </div>
            <div className="mt-3">
              <PasswordField value={confirm} onChange={setConfirm} label="Type it again" placeholder="Type it again" disabled={ctx.locked} invalid={mismatch} />
              {mismatch && <p className="mt-1.5 text-xs text-danger">Doesn&apos;t match the password above.</p>}
            </div>
          </Row>
          <Row label="What people can do once it's open">
            <div className="space-y-3">
              <Toggle checked={print} onChange={setPrint} label="Print it" disabled={ctx.locked} />
              <Toggle checked={copy} onChange={setCopy} label="Copy text and images" disabled={ctx.locked} />
              <Toggle checked={edit} onChange={setEdit} label="Change it (edit, fill forms, add comments)" disabled={ctx.locked} />
            </div>
          </Row>
          <Notice className="mt-3">Keep the password somewhere safe. It can&apos;t be recovered, and we never store it.</Notice>
        </Panel>
      )}
    />
  );
}

export function UnlockTool({ toolId }: { toolId: string }) {
  const [password, setPassword] = useState("");
  return (
    <PdfTask
      toolId={toolId}
      input={{ kind: "raw-pdf" }}
      endpoint={pdfApi("unlock")}
      dropTitle="Drop the protected PDF"
      label="Unlock the PDF"
      working="Unlocking…"
      fields={() => [["password", password]]}
      hint="If the PDF opens without a password, leave the box empty: its restrictions are removed."
      resultNote="The new copy opens without a password and can be printed, copied and edited."
      options={(ctx) => (
        <Panel>
          <Row label="Password" hint="Only if it asks for one">
            <PasswordField value={password} onChange={setPassword} label="Password" placeholder="The password that opens it" disabled={ctx.locked} autoComplete="off" />
          </Row>
          <Notice className="mt-3">Only unlock files you own or have permission to change. Your password is used once and never stored.</Notice>
        </Panel>
      )}
    />
  );
}

export function RepairTool({ toolId }: { toolId: string }) {
  return (
    <PdfTask
      toolId={toolId}
      input={{ kind: "raw-pdf" }}
      endpoint={pdfApi("repair")}
      dropTitle="Drop the damaged PDF"
      label="Repair the PDF"
      working="Repairing…"
      fields={() => []}
      hint="We rebuild the file's structure and keep every page that can still be read."
      resultInfo={(info) => {
        const pages = Number(info.pages ?? 0);
        const skipped = Number(info.skipped ?? 0);
        return (
          <>
            {plural(pages, "page")} recovered{skipped ? `, ${plural(skipped, "page")} couldn't be read` : ""}.{" "}
            {info.rebuilt ? "The file's broken index was rebuilt." : "The structure was cleaned and rewritten."}
          </>
        );
      }}
      resultNote="Open the preview to check every page made it."
    />
  );
}

/* ---------- OCR ---------- */

const LANGUAGE_NAMES: Record<string, string> = {
  eng: "English", hin: "Hindi", ben: "Bengali", spa: "Spanish", fra: "French", deu: "German", ita: "Italian", por: "Portuguese",
  rus: "Russian", ara: "Arabic", chi_sim: "Chinese (Simplified)", chi_tra: "Chinese (Traditional)", jpn: "Japanese", kor: "Korean",
  tur: "Turkish", nld: "Dutch", pol: "Polish", ukr: "Ukrainian", vie: "Vietnamese", tha: "Thai", ind: "Indonesian", msa: "Malay",
  tam: "Tamil", tel: "Telugu", mar: "Marathi", guj: "Gujarati", kan: "Kannada", mal: "Malayalam", pan: "Punjabi", urd: "Urdu",
  ori: "Odia", asm: "Assamese", nep: "Nepali", sin: "Sinhala", fas: "Persian", heb: "Hebrew", ell: "Greek", ces: "Czech",
  slk: "Slovak", hun: "Hungarian", ron: "Romanian", bul: "Bulgarian", hrv: "Croatian", srp: "Serbian", slv: "Slovenian",
  swe: "Swedish", nor: "Norwegian", dan: "Danish", fin: "Finnish", est: "Estonian", lav: "Latvian", lit: "Lithuanian",
  cat: "Catalan", eus: "Basque", glg: "Galician", afr: "Afrikaans", swa: "Swahili", fil: "Filipino", tgl: "Tagalog",
  aze: "Azerbaijani", kaz: "Kazakh", uzb: "Uzbek", mon: "Mongolian", khm: "Khmer", lao: "Lao", mya: "Burmese", amh: "Amharic",
  isl: "Icelandic", gle: "Irish", cym: "Welsh", lat: "Latin", epo: "Esperanto", bel: "Belarusian", mkd: "Macedonian",
  sqi: "Albanian", bos: "Bosnian", kat: "Georgian", hye: "Armenian", san: "Sanskrit", bod: "Tibetan",
};
export const langName = (code: string) => LANGUAGE_NAMES[code] ?? code.replace(/_/g, " ");
export const POPULAR_OCR = ["eng", "hin", "spa", "fra", "deu", "por", "ara", "chi_sim", "jpn", "ben"];

export function OcrTool({ toolId }: { toolId: string }) {
  const [available, setAvailable] = useState<string[] | null>(null);
  const [chosen, setChosen] = useState<string[]>(["eng"]);
  const [query, setQuery] = useState("");
  const [force, setForce] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/tools/pdf/ocr-languages")
      .then((r) => (r.ok ? r.json() : { languages: [] }))
      .then((d: { languages: string[] }) => live && setAvailable(d.languages))
      .catch(() => live && setAvailable([]));
    return () => {
      live = false;
    };
  }, []);
  const matches = useMemo(() => {
    const list = available ?? [];
    const q = query.trim().toLowerCase();
    const pool = q
      ? list.filter((c) => c.includes(q) || langName(c).toLowerCase().includes(q))
      : POPULAR_OCR.filter((c) => list.includes(c));
    return pool.filter((c) => !chosen.includes(c) && !c.endsWith("_vert")).slice(0, 12);
  }, [available, query, chosen]);

  return (
    <PdfTask
      toolId={toolId}
      input={{ kind: "pdf" }}
      endpoint={pdfApi("ocr")}
      needs="ocr"
      dropTitle="Drop the scanned PDF"
      label={(ctx) => `Read the text${ctx.doc ? ` on ${plural(ctx.doc.upload.pages, "page")}` : ""}`}
      working="Reading the pages…"
      invalid={() => (chosen.length ? null : "Pick at least one language.")}
      fields={() => [...chosen.map((c) => ["languages", c] as [string, string]), ["force", String(force)]]}
      hint="Big scans take a while: about a second or two per page."
      resultInfo={(info) => {
        const done = Number(info.ocr_pages ?? 0);
        const skipped = Number(info.skipped_pages ?? 0);
        return done === 0 ? (
          <>Every page already had text, so nothing needed reading. Turn on &ldquo;Read every page&rdquo; to read them anyway.</>
        ) : (
          <>
            Text read on {plural(done, "page")}
            {skipped ? `; ${plural(skipped, "page")} already had text and ${skipped === 1 ? "was" : "were"} left as they were` : ""}.
          </>
        );
      }}
      resultNote={
        <>
          The pages look exactly as before; now you can search and copy the text. Next:{" "}
          <Link href={toolHref("pdf-to-word")} className="underline underline-offset-4 hover:text-ink">
            turn it into Word
          </Link>
          .
        </>
      }
      options={(ctx) => (
        <Panel>
          <Row label="Languages in the document" hint={`${chosen.length} of 5`}>
            <div className="flex flex-wrap gap-1.5">
              {chosen.map((c) => (
                <button
                  key={c}
                  type="button"
                  disabled={ctx.locked}
                  onClick={() => setChosen((v) => v.filter((x) => x !== c))}
                  className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-ink bg-ink px-3 text-sm text-paper"
                  aria-label={`Remove ${langName(c)}`}
                >
                  {langName(c)} <X aria-hidden className="size-3.5 text-paper-dim" />
                </button>
              ))}
            </div>
            {available === null ? (
              <p className="mt-2 text-xs text-ink-3">Loading languages…</p>
            ) : (
              <>
                <div className="relative mt-3">
                  <Search aria-hidden className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={`Search ${available.length} languages`}
                    aria-label="Search languages"
                    disabled={ctx.locked || chosen.length >= 5}
                    className="h-10 w-full rounded-md border border-line bg-surface pl-9 pr-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink focus:ring-4 focus:ring-accent/15 disabled:opacity-50"
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {matches.map((c) => (
                    <button
                      key={c}
                      type="button"
                      disabled={ctx.locked || chosen.length >= 5}
                      onClick={() => {
                        setChosen((v) => [...v, c]);
                        setQuery("");
                      }}
                      className="inline-flex h-8 items-center rounded-sm border border-line bg-surface px-2.5 text-[13px] text-ink-2 transition-colors hover:border-ink-3 hover:text-ink disabled:opacity-40"
                    >
                      + {langName(c)}
                    </button>
                  ))}
                  {!matches.length && query && <p className="text-xs text-ink-3">No language matches &ldquo;{query}&rdquo;.</p>}
                </div>
              </>
            )}
          </Row>
          <Row label="Pages">
            <Toggle checked={force} onChange={setForce} disabled={ctx.locked} label="Read every page" description="Off: pages that already have selectable text are left alone, so nothing is doubled." />
          </Row>
        </Panel>
      )}
    />
  );
}

/* ---------- PDF/A ---------- */

export function PdfaTool({ toolId }: { toolId: string }) {
  const [level, setLevel] = useState(2);
  return (
    <PdfTask
      toolId={toolId}
      input={{ kind: "pdf" }}
      endpoint={pdfApi("pdfa")}
      needs="pdfa"
      dropTitle="Drop the PDF to archive"
      label={`Convert to PDF/A-${level}b`}
      working="Converting…"
      fields={() => [["level", String(level)]]}
      resultNote="Fonts are embedded and colours fixed to sRGB, so it will look the same in decades."
      options={(ctx) => (
        <Panel>
          <Row label="Conformance level">
            <Chips
              value={level}
              onChange={setLevel}
              disabled={ctx.locked}
              options={[
                { value: 1, label: "PDF/A-1b" },
                { value: 2, label: "PDF/A-2b" },
                { value: 3, label: "PDF/A-3b" },
              ]}
            />
            <p className="mt-2 text-xs leading-relaxed text-ink-3">
              {level === 1
                ? "The oldest and strictest: no transparency. Pick it only if you're asked for 1b."
                : level === 2
                  ? "The usual choice: keeps transparency and layers. Accepted almost everywhere."
                  : "Like 2b, and allows other files attached inside."}
            </p>
          </Row>
        </Panel>
      )}
    />
  );
}
