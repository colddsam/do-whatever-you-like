"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  CalendarDays,
  Circle,
  Copy,
  Eraser,
  Highlighter,
  ImagePlus,
  Italic,
  Minus,
  MousePointer2,
  Pencil,
  Signature,
  Square,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Chips, Panel, Row, Slider, Swatches } from "./kit";
import { clamp01, EditableBox, fractionAt, normalize, PageNav, PageView, type Box } from "./page-stage";
import { nextId, plural } from "./parts";
import { SignatureMaker, type SignatureImage } from "./signature";
import { PdfTask, type TaskContext } from "./task";

type ItemType = "text" | "image" | "rect" | "ellipse" | "line" | "highlight" | "whiteout" | "ink";
type Item = {
  id: string;
  page: number;
  type: ItemType;
  box?: Box;
  line?: [number, number, number, number];
  points?: [number, number][];
  text?: string;
  font: "sans" | "serif" | "mono";
  size: number;
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right";
  color: string;
  fill: string | null;
  width: number;
  opacity: number;
  image?: number;
};
type Img = { blob: Blob; url: string; name: string; w: number; h: number };
type AddedImage = { index: number; w: number; h: number };
type Tool = "select" | "text" | "image" | "rect" | "ellipse" | "line" | "highlight" | "whiteout" | "ink" | "signature" | "initials" | "date";

const DEFAULTS: Omit<Item, "id" | "page" | "type"> = {
  font: "sans",
  size: 14,
  bold: false,
  italic: false,
  align: "left",
  color: "#111111",
  fill: null,
  width: 2,
  opacity: 1,
};

const COLOURS = [
  { value: "#111111", name: "Black" },
  { value: "#1d4ed8", name: "Blue" },
  { value: "#b91c1c", name: "Red" },
  { value: "#15803d", name: "Green" },
  { value: "#c2410c", name: "Orange" },
];
const HIGHLIGHTS = [
  { value: "#facc15", name: "Yellow" },
  { value: "#4ade80", name: "Green" },
  { value: "#60a5fa", name: "Blue" },
  { value: "#f472b6", name: "Pink" },
];
const CSS_FONT = { sans: "Helvetica, Arial, sans-serif", serif: "Georgia, 'Times New Roman', serif", mono: "'Courier New', monospace" };

const EDIT_TOOLS: { id: Tool; label: string; icon: typeof Type; hint: string }[] = [
  { id: "select", label: "Select", icon: MousePointer2, hint: "Click something to move, resize or change it." },
  { id: "text", label: "Text", icon: Type, hint: "Click where the text should start, then type." },
  { id: "image", label: "Image", icon: ImagePlus, hint: "Pick an image; it lands in the middle of the page." },
  { id: "rect", label: "Box", icon: Square, hint: "Drag to draw a box." },
  { id: "ellipse", label: "Circle", icon: Circle, hint: "Drag to draw a circle or oval." },
  { id: "line", label: "Line", icon: Minus, hint: "Drag from one end to the other." },
  { id: "highlight", label: "Highlight", icon: Highlighter, hint: "Drag over the text to highlight." },
  { id: "whiteout", label: "White-out", icon: Eraser, hint: "Drag over what you want to cover with white." },
  { id: "ink", label: "Draw", icon: Pencil, hint: "Draw freehand. Each stroke is its own drawing." },
];
const SIGN_TOOLS: { id: Tool; label: string; icon: typeof Type; hint: string }[] = [
  { id: "select", label: "Select", icon: MousePointer2, hint: "Click something to move, resize or change it." },
  { id: "signature", label: "Signature", icon: Signature, hint: "Click where your signature goes." },
  { id: "initials", label: "Initials", icon: Signature, hint: "Click where your initials go." },
  { id: "date", label: "Date", icon: CalendarDays, hint: "Click where the date goes." },
  { id: "text", label: "Text", icon: Type, hint: "Click where the text should start, then type." },
];

/** Edit PDF (and, with `sign`, Sign PDF): place things on pages, then flatten them into the PDF. */
export function EditTool({ toolId, sign = false }: { toolId: string; sign?: boolean }) {
  const [items, setItems] = useState<Item[]>([]);
  const [imgs, setImgs] = useState<Img[]>([]);
  const [signature, setSignature] = useState<{ full?: number; initials?: number }>({});
  const [undoCount, setUndoCount] = useState(0);
  const undo = useRef<Item[][]>([]);
  const itemsRef = useRef(items);
  const lastPush = useRef(0);

  /** Every change goes through here. Changes in quick succession (a drag) undo as one step. */
  const update = useCallback((next: Item[] | ((prev: Item[]) => Item[])) => {
    const prev = itemsRef.current;
    const value = typeof next === "function" ? next(prev) : next;
    if (Date.now() - lastPush.current > 400) {
      undo.current = [...undo.current.slice(-49), prev];
      setUndoCount(undo.current.length);
    }
    lastPush.current = Date.now();
    itemsRef.current = value;
    setItems(value);
  }, []);
  const undoLast = useCallback(() => {
    const prev = undo.current.pop();
    setUndoCount(undo.current.length);
    if (!prev) return;
    itemsRef.current = prev;
    setItems(prev);
  }, []);

  const imgsRef = useRef(imgs);
  /** Keeps an image for placing; returns its index and pixel size straight away (state catches up later). */
  const addImage = useCallback(async (blob: Blob, name: string): Promise<AddedImage> => {
    const url = URL.createObjectURL(blob);
    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
      const im = new Image();
      im.onload = () => resolve({ w: im.naturalWidth || 1, h: im.naturalHeight || 1 });
      im.onerror = () => resolve({ w: 1, h: 1 });
      im.src = url;
    });
    const index = imgsRef.current.length;
    imgsRef.current = [...imgsRef.current, { blob, url, name, ...dims }];
    setImgs(imgsRef.current);
    return { index, ...dims };
  }, []);
  useEffect(() => () => imgsRef.current.forEach((i) => URL.revokeObjectURL(i.url)), []);

  const ops = () => {
    // Only the images still on a page are sent, renumbered.
    const used = [...new Set(items.filter((i) => i.type === "image").map((i) => i.image!))];
    const ops = items
      .filter((i) => i.type !== "text" || i.text?.trim())
      .map((i) => ({
        type: i.type,
        page: i.page,
        box: i.box,
        line: i.line,
        points: i.points,
        text: i.text ?? "",
        font: i.font,
        size: i.size,
        bold: i.bold,
        italic: i.italic,
        align: i.align,
        color: i.color,
        fill: i.fill ?? undefined,
        width: i.width,
        opacity: i.opacity,
        image: i.type === "image" ? used.indexOf(i.image!) : undefined,
      }));
    return { ops, files: used.map((u) => imgs[u]) };
  };

  return (
    <PdfTask
      toolId={toolId}
      input={{ kind: "pdf" }}
      endpoint="/api/tools/pdf/edit"
      dropTitle={sign ? "Drop the PDF to sign" : "Drop the PDF to edit"}
      label={sign ? "Sign the PDF" : `Save ${plural(items.length, "change")}`}
      working="Saving…"
      invalid={() =>
        items.length === 0
          ? sign
            ? "Place your signature on a page first."
            : "Add something to a page first."
          : null
      }
      fields={() => {
        const { ops: list, files } = ops();
        const out: [string, string | Blob, string?][] = [["ops", JSON.stringify(list)], ["suffix", sign ? "signed" : "edited"]];
        files.forEach((f, i) => out.push(["images", f.blob, f.name || `image-${i}.png`]));
        return out;
      }}
      backLabel="Keep editing"
      resultNote={sign ? "Your signature is part of the page now, not a loose layer that can be lifted off." : "Everything you added is part of the pages now."}
      options={(ctx) => (
        <Editor
          ctx={ctx}
          sign={sign}
          items={items}
          imgs={imgs}
          update={update}
          undo={undoLast}
          canUndo={undoCount > 0}
          addImage={addImage}
          signature={signature}
          setSignature={setSignature}
        />
      )}
    />
  );
}

function Editor({
  ctx,
  sign,
  items,
  imgs,
  update,
  undo,
  canUndo,
  addImage,
  signature,
  setSignature,
}: {
  ctx: TaskContext;
  sign: boolean;
  items: Item[];
  imgs: Img[];
  update: (next: Item[] | ((prev: Item[]) => Item[])) => void;
  undo: () => void;
  canUndo: boolean;
  addImage: (blob: Blob, name: string) => Promise<AddedImage>;
  signature: { full?: number; initials?: number };
  setSignature: React.Dispatch<React.SetStateAction<{ full?: number; initials?: number }>>;
}) {
  const doc = ctx.doc!;
  const pages = doc.upload.pages;
  const [page, setPage] = useState(1);
  const [tool, setTool] = useState<Tool>(sign ? "signature" : "select");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraftState] = useState<Item | null>(null);
  // The shape being drawn, also kept in a ref: pointerup must see the last pointermove, which
  // may not have re-rendered yet.
  const draftRef = useRef<Item | null>(null);
  const setDraft = (d: Item | null) => {
    draftRef.current = d;
    setDraftState(d);
  };
  const [making, setMaking] = useState<"full" | "initials" | null>(sign ? "full" : null);
  const [style, setStyle] = useState(DEFAULTS);
  const imageInput = useRef<HTMLInputElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const size = doc.upload.sizes?.[page - 1] ?? [595, 842];
  const pageRatio = size[0] / size[1];

  const current = items.filter((i) => i.page === page);
  const sel = items.find((i) => i.id === selected) ?? null;
  const marked = useMemo(() => new Set(items.map((i) => i.page)), [items]);
  const tools = sign ? SIGN_TOOLS : EDIT_TOOLS;
  const hint = tools.find((t) => t.id === tool)?.hint;

  const patch = (id: string, p: Partial<Item>) => update((prev) => prev.map((i) => (i.id === id ? { ...i, ...p } : i)));
  const remove = (id: string) => {
    update((prev) => prev.filter((i) => i.id !== id));
    setSelected(null);
    setEditing(null);
  };
  const add = (item: Item, keepTool = false) => {
    update((prev) => [...prev, item]);
    setSelected(item.id);
    if (!keepTool) setTool("select");
  };

  // Keyboard: Delete removes, Escape lets go, Ctrl/Cmd+Z undoes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest("input, textarea, select");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        undo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected && !editing && !typing) {
        e.preventDefault();
        remove(selected);
      } else if (e.key === "Escape") {
        setEditing(null);
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const imageBox = (index: number, at: { x: number; y: number }, widthFrac: number, dims?: { w: number; h: number }): Box => {
    const im = dims ?? imgs[index] ?? { w: 3, h: 1 };
    const w = widthFrac;
    const h = w * (im.h / im.w) * pageRatio;
    const x0 = clamp01(Math.min(at.x - w / 2, 1 - w));
    const y0 = clamp01(Math.min(at.y - h / 2, 1 - h));
    return { x0, y0, x1: x0 + w, y1: y0 + h };
  };

  const placeImage = (index: number, at: { x: number; y: number }, widthFrac: number, dims?: { w: number; h: number }) => {
    add({ ...DEFAULTS, id: nextId(), page, type: "image", image: index, box: imageBox(index, at, widthFrac, dims) }, sign);
  };

  const onStageDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (ctx.locked || e.button !== 0) return;
    // Keep the browser from moving focus to the page on this press: a text box created here is
    // focused for typing straight away, and the default focus change would blur (and drop) it.
    e.preventDefault();
    const stage = e.currentTarget;
    const p = fractionAt(stage, e.clientX, e.clientY);
    setEditing(null);
    if (tool === "select") return setSelected(null);
    if (tool === "text" || tool === "date") {
      const h = ((tool === "date" ? 12 : style.size) * 1.5) / size[1];
      const item: Item = {
        ...DEFAULTS,
        ...(tool === "text" ? style : {}),
        id: nextId(),
        page,
        type: "text",
        text: tool === "date" ? new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "",
        size: tool === "date" ? 12 : style.size,
        box: { x0: p.x, y0: clamp01(p.y - h / 2), x1: Math.min(1, p.x + (tool === "date" ? 0.25 : 0.35)), y1: Math.min(1, p.y + h / 2) },
      };
      add(item);
      if (tool === "text") setEditing(item.id);
      return;
    }
    if (tool === "signature" || tool === "initials") {
      const index = tool === "signature" ? signature.full : signature.initials;
      if (index === undefined) return setMaking(tool === "signature" ? "full" : "initials");
      return placeImage(index, p, tool === "signature" ? 0.28 : 0.12);
    }
    if (tool === "image") return imageInput.current?.click();
    start.current = p;
    stage.setPointerCapture(e.pointerId);
    const base = { ...DEFAULTS, ...style, id: nextId(), page };
    if (tool === "line") setDraft({ ...base, type: "line", line: [p.x, p.y, p.x, p.y] });
    else if (tool === "ink") setDraft({ ...base, type: "ink", points: [[p.x, p.y]] });
    else
      setDraft({
        ...base,
        type: tool,
        box: normalize(p, p),
        fill: tool === "highlight" ? (style.fill ?? "#facc15") : tool === "whiteout" ? "#ffffff" : style.fill,
        opacity: tool === "highlight" ? 0.4 : style.opacity,
      });
  };
  const onStageMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const draft = draftRef.current;
    if (!draft || !start.current) return;
    const p = fractionAt(e.currentTarget, e.clientX, e.clientY);
    if (draft.type === "line") setDraft({ ...draft, line: [start.current.x, start.current.y, p.x, p.y] });
    else if (draft.type === "ink") setDraft({ ...draft, points: [...(draft.points ?? []), [p.x, p.y]] });
    else setDraft({ ...draft, box: normalize(start.current, p) });
  };
  const onStageUp = () => {
    const d = draftRef.current;
    if (!d) return;
    setDraft(null);
    start.current = null;
    if (d.type === "line") {
      const [x0, y0, x1, y1] = d.line!;
      if (Math.hypot(x1 - x0, y1 - y0) < 0.01) return;
      return add(d);
    }
    if (d.type === "ink") {
      if ((d.points?.length ?? 0) < 2) return;
      // Fewer points: drop ones closer than ~1/400 of the page to the last kept one.
      const kept: [number, number][] = [];
      for (const pt of d.points!) {
        const last = kept[kept.length - 1];
        if (!last || Math.hypot(pt[0] - last[0], pt[1] - last[1]) > 0.0025) kept.push(pt);
      }
      return add({ ...d, points: kept }, true);
    }
    const b = d.box!;
    if (b.x1 - b.x0 < 0.01 || b.y1 - b.y0 < 0.006) {
      // A click rather than a drag: drop a sensible default size there.
      const w = d.type === "highlight" ? 0.3 : 0.18;
      const h = d.type === "highlight" ? 0.025 : 0.1;
      return add({ ...d, box: { x0: b.x0, y0: b.y0, x1: Math.min(1, b.x0 + w), y1: Math.min(1, b.y0 + h) } }, d.type === "highlight");
    }
    add(d, d.type === "highlight" || d.type === "whiteout");
  };

  return (
    <div className="space-y-3">
      <input
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f || !f.type.startsWith("image/")) return;
          const added = await addImage(f, f.name);
          placeImage(added.index, { x: 0.5, y: 0.5 }, 0.4, added);
        }}
      />

      {/* Toolbar */}
      <div role="toolbar" aria-label={sign ? "Signing tools" : "Editing tools"} className="flex flex-wrap items-center gap-1.5">
        {tools.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={tool === t.id}
            title={t.label}
            disabled={ctx.locked}
            onClick={() => {
              setTool(t.id);
              setEditing(null);
              if (t.id === "image") imageInput.current?.click();
              if (t.id === "signature" && signature.full === undefined) setMaking("full");
              if (t.id === "initials" && signature.initials === undefined) setMaking("initials");
            }}
            className={cn(
              "inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-sm border px-2.5 text-sm transition-colors duration-150 sm:h-9",
              tool === t.id ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
            )}
          >
            <t.icon aria-hidden className="size-4" />
            <span className={cn(!sign && "max-sm:hidden")}>{t.label}</span>
          </button>
        ))}
        <span aria-hidden className="mx-0.5 h-5 w-px bg-line" />
        <button
          type="button"
          onClick={undo}
          disabled={ctx.locked || !canUndo}
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
          className="inline-flex size-11 items-center justify-center rounded-sm border border-line bg-surface text-ink-2 transition-colors hover:border-ink-3 hover:text-ink disabled:opacity-40 sm:size-9"
        >
          <Undo2 aria-hidden className="size-4" />
        </button>
      </div>
      <p className="text-xs text-ink-3" aria-live="polite">
        {hint}
        {items.length ? ` · ${plural(items.length, "thing")} on ${plural(marked.size, "page")}` : ""}
      </p>

      {sign && making && (
        <SignatureMaker
          kind={making}
          onCancel={() => setMaking(null)}
          onDone={async (img: SignatureImage) => {
            const added = await addImage(img.blob, making === "full" ? "signature.png" : "initials.png");
            setSignature((s) => ({ ...s, [making]: added.index }));
            setTool(making === "full" ? "signature" : "initials");
            setMaking(null);
          }}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-start">
        {/* Stage */}
        <div className="space-y-2">
          <div className="mx-auto w-full max-w-[640px]">
            <PageView
              token={doc.upload.token}
              page={page}
              size={size}
              overlayClassName={cn(tool !== "select" && "cursor-crosshair", "touch-none")}
              overlayProps={{
                onPointerDown: onStageDown,
                onPointerMove: onStageMove,
                onPointerUp: onStageUp,
                onPointerCancel: onStageUp,
              }}
            >
              {(scale) => (
                <>
                  <svg className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden>
                    {[...current, ...(draft ? [draft] : [])]
                      .filter((i) => i.type === "line" || i.type === "ink")
                      .map((i) => (
                        <StrokeItem
                          key={i.id}
                          item={i}
                          scale={scale}
                          selected={i.id === selected}
                          onSelect={() => {
                            setSelected(i.id);
                            setTool("select");
                          }}
                          onChange={(p) => patch(i.id, p)}
                        />
                      ))}
                  </svg>
                  {[...current, ...(draft && draft.box ? [draft] : [])]
                    .filter((i) => i.box)
                    .map((i) => (
                      <EditableBox
                        key={i.id}
                        box={i.box!}
                        selected={i.id === selected}
                        onSelect={() => {
                          setSelected(i.id);
                          if (tool !== "select") setTool("select");
                        }}
                        onChange={(box) => patch(i.id, { box })}
                        keepRatio={i.type === "image"}
                        minSize={0.01}
                        label={`${i.type === "text" ? `Text: ${i.text || "empty"}` : i.type} on page ${page}`}
                        className={cn(i.id === draft?.id && "pointer-events-none")}
                      >
                        <BoxItem
                          item={i}
                          img={i.image !== undefined ? imgs[i.image] : undefined}
                          scale={scale}
                          editing={editing === i.id}
                          onEdit={() => setEditing(i.id)}
                          onText={(text, grow) => patch(i.id, { text, ...(grow ? { box: { ...i.box!, y1: Math.min(1, i.box!.y0 + grow) } } : {}) })}
                          onDoneEditing={() => {
                            setEditing(null);
                            if (!i.text?.trim()) remove(i.id);
                          }}
                          pageHeight={size[1]}
                        />
                      </EditableBox>
                    ))}
                </>
              )}
            </PageView>
          </div>
          <div className="mx-auto max-w-[640px]">
            <PageNav page={page} pages={pages} onChange={(p) => (setPage(p), setSelected(null))} marked={marked} disabled={ctx.locked} />
          </div>
        </div>

        {/* Properties of what's selected (or of what the next thing will look like) */}
        <Properties
          item={sel}
          style={style}
          locked={ctx.locked}
          onStyle={(p) => {
            setStyle((s) => ({ ...s, ...p }));
            if (sel) patch(sel.id, p);
          }}
          onText={(text) => sel && patch(sel.id, { text })}
          onDelete={() => sel && remove(sel.id)}
          onDuplicate={() => {
            if (!sel) return;
            const shift = 0.02;
            const copy: Item = {
              ...sel,
              id: nextId(),
              box: sel.box && { x0: Math.min(sel.box.x0 + shift, 1 - (sel.box.x1 - sel.box.x0)), y0: Math.min(sel.box.y0 + shift, 1 - (sel.box.y1 - sel.box.y0)), x1: Math.min(1, sel.box.x1 + shift), y1: Math.min(1, sel.box.y1 + shift) },
            };
            add(copy);
          }}
          onAllPages={
            sel && pages > 1
              ? () => {
                  const copies: Item[] = [];
                  for (let p = 1; p <= pages; p++) if (p !== sel.page) copies.push({ ...sel, id: nextId(), page: p });
                  update((prev) => [...prev, ...copies]);
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}

function BoxItem({
  item,
  img,
  scale,
  editing,
  onEdit,
  onText,
  onDoneEditing,
  pageHeight,
}: {
  item: Item;
  img?: Img;
  scale: number;
  editing: boolean;
  onEdit: () => void;
  onText: (text: string, grow?: number) => void;
  onDoneEditing: () => void;
  pageHeight: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);
  if (item.type === "text") {
    const font: React.CSSProperties = {
      fontFamily: CSS_FONT[item.font],
      fontSize: item.size * scale,
      lineHeight: 1.2,
      color: item.color,
      fontWeight: item.bold ? 700 : 400,
      fontStyle: item.italic ? "italic" : "normal",
      textAlign: item.align,
      opacity: item.opacity,
    };
    return editing ? (
      <textarea
        ref={ref}
        value={item.text}
        onChange={(e) => {
          const el = e.currentTarget;
          const grow = el.scrollHeight > el.clientHeight + 1 ? (el.scrollHeight / scale) / pageHeight : undefined;
          onText(e.target.value, grow);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onBlur={onDoneEditing}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onDoneEditing();
        }}
        placeholder="Type here"
        aria-label="Text"
        className="block size-full resize-none overflow-hidden bg-surface/40 p-0 outline-none placeholder:text-ink-3"
        style={font}
      />
    ) : (
      <div onDoubleClick={onEdit} className="size-full overflow-hidden whitespace-pre-wrap break-words" style={font}>
        {item.text || <span className="text-ink-3">Type here</span>}
      </div>
    );
  }
  if (item.type === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return img ? <img src={img.url} alt="" draggable={false} className="pointer-events-none size-full object-contain" /> : null;
  }
  const common: React.CSSProperties = { opacity: item.opacity };
  if (item.type === "highlight") return <div className="size-full mix-blend-multiply" style={{ background: item.fill ?? "#facc15", opacity: Math.min(item.opacity, 0.5) }} />;
  if (item.type === "whiteout") return <div className="size-full bg-white" />;
  return (
    <div
      className={cn("size-full", item.type === "ellipse" && "rounded-[50%]")}
      style={{ ...common, border: item.width > 0 ? `${Math.max(1, item.width * scale)}px solid ${item.color}` : undefined, background: item.fill ?? undefined }}
    />
  );
}

function StrokeItem({
  item,
  scale,
  selected,
  onSelect,
  onChange,
}: {
  item: Item;
  scale: number;
  selected: boolean;
  onSelect: () => void;
  onChange: (p: Partial<Item>) => void;
}) {
  const drag = useRef<{ x: number; y: number; item: Item; svg: SVGSVGElement; end?: 0 | 1 } | null>(null);
  const begin = (e: React.PointerEvent<SVGElement>, end?: 0 | 1) => {
    e.stopPropagation();
    onSelect();
    const svg = (e.currentTarget as SVGElement).ownerSVGElement ?? (e.currentTarget as unknown as SVGSVGElement);
    const r = svg.getBoundingClientRect();
    drag.current = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, item, svg, end };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent<SVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const r = d.svg.getBoundingClientRect();
    const x = clamp01((e.clientX - r.left) / r.width);
    const y = clamp01((e.clientY - r.top) / r.height);
    if (d.item.type === "line" && d.end !== undefined) {
      const l = [...d.item.line!] as Item["line"] & number[];
      l[d.end * 2] = x;
      l[d.end * 2 + 1] = y;
      return onChange({ line: l });
    }
    const dx = x - d.x;
    const dy = y - d.y;
    if (d.item.type === "line") {
      const [a, b, c, e2] = d.item.line!;
      onChange({ line: [clamp01(a + dx), clamp01(b + dy), clamp01(c + dx), clamp01(e2 + dy)] });
    } else {
      onChange({ points: d.item.points!.map(([px, py]) => [clamp01(px + dx), clamp01(py + dy)]) });
    }
  };
  const end = () => {
    drag.current = null;
  };
  /** Dragging one end of a line (which end is on the handle's data-end). */
  const beginEnd = (e: React.PointerEvent<SVGElement>) => begin(e, Number((e.currentTarget as SVGElement).dataset.end) as 0 | 1);
  const stroke = Math.max(1, item.width * scale);
  const pts = item.type === "line" ? [[item.line![0], item.line![1]], [item.line![2], item.line![3]]] : (item.points ?? []);
  const d = pts.map(([x, y]) => `${x * 1000},${y * 1000}`).join(" ");
  return (
    <g className="pointer-events-auto">
      {/* A wide invisible stroke makes thin lines easy to grab. */}
      <polyline points={d} fill="none" stroke="transparent" strokeWidth={Math.max(14, stroke + 10)} vectorEffect="non-scaling-stroke" className="cursor-move" onPointerDown={(e) => begin(e)} onPointerMove={move} onPointerUp={end} />
      <polyline points={d} fill="none" stroke={item.color} strokeOpacity={item.opacity} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" pointerEvents="none" />
      {selected && (
        <polyline points={d} fill="none" stroke="var(--color-ink)" strokeDasharray="4 3" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
      )}
      {selected &&
        item.type === "line" &&
        ([0, 1] as const).map((i) => (
          <circle
            key={i}
            cx={item.line![i * 2] * 1000}
            cy={item.line![i * 2 + 1] * 1000}
            r={9}
            fill="var(--color-surface)"
            stroke="var(--color-ink)"
            vectorEffect="non-scaling-stroke"
            className="cursor-grab"
            data-end={i}
            onPointerDown={beginEnd}
            onPointerMove={move}
            onPointerUp={end}
          />
        ))}
    </g>
  );
}

function Properties({
  item,
  style,
  locked,
  onStyle,
  onText,
  onDelete,
  onDuplicate,
  onAllPages,
}: {
  item: Item | null;
  style: typeof DEFAULTS;
  locked: boolean;
  onStyle: (p: Partial<Item>) => void;
  onText: (t: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onAllPages?: () => void;
}) {
  const v = item ?? ({ ...style, type: "text" } as Item);
  const isText = v.type === "text";
  const hasStroke = ["rect", "ellipse", "line", "ink"].includes(v.type);
  const hasFill = v.type === "rect" || v.type === "ellipse";
  return (
    <Panel className="lg:sticky lg:top-24">
      <p className="label-mono pb-3 text-ink-2">{item ? `Selected · ${labelOf(item)}` : "Style for new things"}</p>
      {item && isText && (
        <Row label="Text">
          <textarea
            value={item.text ?? ""}
            onChange={(e) => onText(e.target.value)}
            rows={3}
            disabled={locked}
            aria-label="Text"
            className="w-full resize-y rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink focus:ring-4 focus:ring-accent/15"
          />
        </Row>
      )}
      {isText && v.type !== "image" && (
        <Row label="Font">
          <Chips value={v.font} onChange={(font) => onStyle({ font })} disabled={locked} options={[{ value: "sans", label: "Sans" }, { value: "serif", label: "Serif" }, { value: "mono", label: "Mono" }]} />
          <div className="mt-2 flex gap-1.5">
            <ToggleButton on={v.bold} onClick={() => onStyle({ bold: !v.bold })} label="Bold" disabled={locked}>
              <Bold aria-hidden className="size-4" />
            </ToggleButton>
            <ToggleButton on={v.italic} onClick={() => onStyle({ italic: !v.italic })} label="Italic" disabled={locked}>
              <Italic aria-hidden className="size-4" />
            </ToggleButton>
            <span aria-hidden className="mx-0.5 h-9 w-px bg-line" />
            {(
              [
                ["left", "Align left", AlignLeft],
                ["center", "Centre", AlignCenter],
                ["right", "Align right", AlignRight],
              ] as const
            ).map(([align, label, Icon]) => (
              <ToggleButton key={align} on={v.align === align} onClick={() => onStyle({ align })} label={label} disabled={locked}>
                <Icon aria-hidden className="size-4" />
              </ToggleButton>
            ))}
          </div>
          <div className="mt-2">
            <Slider value={v.size} min={6} max={72} onChange={(size) => onStyle({ size })} format={(s) => `${s} pt`} label="Font size" disabled={locked} />
          </div>
        </Row>
      )}
      {(isText || hasStroke) && (
        <Row label={isText ? "Colour" : "Line colour"}>
          <Swatches value={v.color} colors={COLOURS} onChange={(color) => onStyle({ color })} disabled={locked} />
        </Row>
      )}
      {hasStroke && (
        <Row label="Line width">
          <Slider value={v.width} min={hasFill ? 0 : 1} max={16} step={0.5} onChange={(width) => onStyle({ width })} format={(w) => `${w} pt`} label="Line width" disabled={locked} />
        </Row>
      )}
      {hasFill && (
        <Row label="Fill">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => onStyle({ fill: null })}
              disabled={locked}
              aria-pressed={!v.fill}
              className={cn("inline-flex h-9 items-center rounded-sm border px-3 text-sm", !v.fill ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink-2")}
            >
              None
            </button>
            <Swatches value={v.fill ?? "#ffffff"} colors={COLOURS} onChange={(fill) => onStyle({ fill })} disabled={locked} />
          </div>
        </Row>
      )}
      {v.type === "highlight" && (
        <Row label="Highlight">
          <Swatches value={v.fill ?? "#facc15"} colors={HIGHLIGHTS} onChange={(fill) => onStyle({ fill })} disabled={locked} />
        </Row>
      )}
      {v.type !== "whiteout" && v.type !== "highlight" && (
        <Row label="Opacity">
          <Slider value={Math.round(v.opacity * 100)} min={10} max={100} step={5} onChange={(o) => onStyle({ opacity: o / 100 })} format={(o) => `${o}%`} label="Opacity" disabled={locked} />
        </Row>
      )}
      {item && (
        <div className="flex flex-wrap gap-1.5 pt-3">
          <SmallButton onClick={onDuplicate} disabled={locked}>
            <Copy aria-hidden className="size-3.5" /> Duplicate
          </SmallButton>
          {onAllPages && (
            <SmallButton onClick={onAllPages} disabled={locked}>
              On every page
            </SmallButton>
          )}
          <SmallButton onClick={onDelete} disabled={locked} danger>
            <Trash2 aria-hidden className="size-3.5" /> Delete
          </SmallButton>
        </div>
      )}
    </Panel>
  );
}

const labelOf = (i: Item) =>
  ({ text: "Text", image: "Image", rect: "Box", ellipse: "Circle", line: "Line", highlight: "Highlight", whiteout: "White-out", ink: "Drawing" })[i.type];

function ToggleButton({ on, onClick, label, disabled, children }: { on: boolean; onClick: () => void; label: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn("inline-flex size-9 items-center justify-center rounded-sm border transition-colors", on ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink-2 hover:border-ink-3")}
    >
      {children}
    </button>
  );
}

function SmallButton({ onClick, disabled, danger, children }: { onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-sm border px-2.5 text-sm transition-colors disabled:opacity-40",
        danger ? "border-danger/40 text-danger hover:bg-danger/5" : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

