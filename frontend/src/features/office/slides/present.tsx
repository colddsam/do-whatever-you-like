"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, MonitorUp, Pencil, Timer, X } from "lucide-react";
import { SIZE, SLIDE_CSS, slideHtml, type Deck } from "./model";

/** Steps through a slide's entrance animations (by order), then moves on to the next slide. */
function useSteps(deck: Deck, start: number) {
  const visible = useMemo(() => deck.slides.map((s, i) => ({ s, i })).filter((x) => !x.s.hidden), [deck]);
  const startPos = Math.max(0, visible.findIndex((x) => x.i === start));
  const [pos, setPos] = useState(startPos);
  const [step, setStep] = useState(0);
  const cur = visible[pos]?.s;
  const maxStep = cur ? Math.max(0, ...cur.elements.filter((e) => e.anim && e.anim.type !== "none").map((e) => e.anim!.order)) : 0;
  const next = useCallback(() => {
    if (step < maxStep) setStep((s) => s + 1);
    else if (pos < visible.length - 1) {
      setPos((p) => p + 1);
      setStep(0);
    }
  }, [step, maxStep, pos, visible.length]);
  const prev = useCallback(() => {
    if (step > 0) setStep((s) => s - 1);
    else if (pos > 0) {
      setPos((p) => p - 1);
      setStep(0);
    }
  }, [step, pos]);
  const goto = (p: number) => {
    setPos(Math.max(0, Math.min(visible.length - 1, p)));
    setStep(0);
  };
  return { visible, pos, step, cur, next, prev, goto, maxStep };
}

const TRANSITION_CSS = `
@keyframes sl-fade{from{opacity:0}to{opacity:1}}
@keyframes sl-slide{from{transform:translateX(100%)}to{transform:none}}
@keyframes sl-push{from{transform:translateY(100%)}to{transform:none}}
@keyframes sl-zoom{from{transform:scale(.6);opacity:0}to{transform:none;opacity:1}}
@keyframes sl-flip{from{transform:perspective(1200px) rotateY(80deg);opacity:0}to{transform:none;opacity:1}}
@keyframes sl-cover{from{transform:translateX(-100%)}to{transform:none}}
@keyframes an-fade{from{opacity:0}to{opacity:1}}
@keyframes an-fly-left{from{transform:translateX(-60px);opacity:0}to{transform:none;opacity:1}}
@keyframes an-fly-right{from{transform:translateX(60px);opacity:0}to{transform:none;opacity:1}}
@keyframes an-fly-up{from{transform:translateY(60px);opacity:0}to{transform:none;opacity:1}}
@keyframes an-zoom{from{transform:scale(.3);opacity:0}to{transform:none;opacity:1}}
@keyframes an-wipe{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
@keyframes an-spin{from{transform:rotate(-180deg) scale(.3);opacity:0}to{transform:none;opacity:1}}
`;

function StageSlide({ deck, index, step, width, height, transition = true }: { deck: Deck; index: number; step: number; width: number; height: number; transition?: boolean }) {
  const slide = deck.slides[index];
  const { w, h } = SIZE[deck.ratio];
  const scale = Math.min(width / w, height / h);
  const html = useMemo(() => (slide ? slideHtml(slide, deck, { animStep: step }) : ""), [slide, deck, step]);
  const ref = useRef<HTMLDivElement | null>(null);
  // play the entrance animation of elements whose order equals this step
  useEffect(() => {
    if (!slide || !ref.current) return;
    for (const el of slide.elements) {
      if (!el.anim || el.anim.type === "none" || el.anim.order !== step || step === 0) continue;
      const node = ref.current.querySelector(`[data-id="${el.id}"]`) as HTMLElement | null;
      if (node) node.style.animation = `an-${el.anim.type} .6s cubic-bezier(.22,1,.36,1) both`;
    }
  }, [slide, step, html]);
  if (!slide) return null;
  return (
    <div style={{ width: w * scale, height: h * scale, position: "relative", overflow: "hidden" }}>
      <div
        key={slide.id}
        ref={ref}
        style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: "top left", animation: transition && slide.transition !== "none" ? `sl-${slide.transition} .55s cubic-bezier(.22,1,.36,1)` : undefined }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

export function Slideshow({ deck, start, presenter, onExit, onIndex, channelName }: { deck: Deck; start: number; presenter: boolean; onExit: () => void; onIndex?: (i: number) => void; channelName?: string }) {
  const { visible, pos, step, cur, next, prev, goto } = useSteps(deck, start);
  const [blank, setBlank] = useState<null | "black" | "white">(null);
  const [laser, setLaser] = useState(false);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ w: 1280, h: 720 });
  const [t0] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [typed, setTyped] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const touch = useRef<number | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const index = visible[pos]?.i ?? 0;

  useEffect(() => {
    const el = rootRef.current;
    el?.requestFullscreen?.().catch(() => {});
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    onResize();
    window.addEventListener("resize", onResize);
    const t = setInterval(() => setNow(Date.now()), 1000);
    if (channelName && "BroadcastChannel" in window) channel.current = new BroadcastChannel(channelName);
    return () => {
      window.removeEventListener("resize", onResize);
      clearInterval(t);
      channel.current?.close();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [channelName]);

  useEffect(() => {
    onIndex?.(index);
    channel.current?.postMessage({ type: "goto", index, step, blank });
  }, [index, step, blank, onIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter", "n"].includes(e.key)) {
        e.preventDefault();
        if (typed && e.key === "Enter") {
          goto(visible.findIndex((v) => v.i === Number(typed) - 1));
          setTyped("");
          return;
        }
        setBlank(null);
        next();
      } else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace", "p"].includes(e.key)) {
        e.preventDefault();
        prev();
      } else if (e.key === "Escape") onExit();
      else if (e.key.toLowerCase() === "b" || e.key === ".") setBlank((b) => (b === "black" ? null : "black"));
      else if (e.key.toLowerCase() === "w" || e.key === ",") setBlank((b) => (b === "white" ? null : "white"));
      else if (e.key.toLowerCase() === "l") setLaser((l) => !l);
      else if (e.key === "Home") goto(0);
      else if (e.key === "End") goto(visible.length - 1);
      else if (/^\d$/.test(e.key)) setTyped((t) => (t + e.key).slice(-3));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const openAudience = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("audience", channelName ?? "");
    window.open(url.toString(), "dwyl-audience", "popup,width=1280,height=720");
    setTimeout(() => channel.current?.postMessage({ type: "goto", index, step, blank }), 1500);
  };

  const stage = (w: number, h: number) =>
    blank ? <div style={{ width: w, height: h, background: blank }} /> : <StageSlide deck={deck} index={index} step={step} width={w} height={h} />;

  const elapsed = Math.floor((now - t0) / 1000);
  const timer = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[100] flex select-none items-center justify-center bg-black text-white"
      style={{ cursor: laser ? "none" : "default" }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        if (!presenter) next();
      }}
      onPointerMove={(e) => laser && setPointer({ x: e.clientX, y: e.clientY })}
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touch.current === null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        if (dx < -40) next();
        else if (dx > 40) prev();
        touch.current = null;
      }}
    >
      <style>{TRANSITION_CSS + SLIDE_CSS}</style>
      {presenter ? (
        <div className="grid size-full grid-cols-1 gap-4 bg-[#1a1a1a] p-4 md:grid-cols-[2fr_1fr]">
          <div className="flex min-h-0 flex-col gap-3">
            <div className="flex items-center gap-3 text-sm text-white/70">
              <span className="inline-flex items-center gap-1"><Timer className="size-4" /> {timer}</span>
              <span>Slide {pos + 1} / {visible.length}</span>
              <span className="ml-auto">{new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center">{stage(Math.min(size.w * 0.62, 1400), size.h * 0.6)}</div>
            <div className="flex items-center justify-center gap-2">
              <button type="button" onClick={prev} className="rounded-md bg-white/10 px-4 py-2 hover:bg-white/20"><ChevronLeft className="size-5" /></button>
              <button type="button" onClick={() => { setBlank(null); next(); }} className="rounded-md bg-white/10 px-6 py-2 hover:bg-white/20"><ChevronRight className="size-5" /></button>
              <button type="button" onClick={() => setBlank((b) => (b ? null : "black"))} className="rounded-md bg-white/10 px-3 py-2 text-sm hover:bg-white/20">Black screen</button>
              <button type="button" onClick={() => setLaser((l) => !l)} className="rounded-md bg-white/10 px-3 py-2 text-sm hover:bg-white/20"><Pencil className="inline size-4" /> Laser</button>
              {channelName && <button type="button" onClick={openAudience} className="rounded-md bg-white/10 px-3 py-2 text-sm hover:bg-white/20"><MonitorUp className="inline size-4" /> Open audience window</button>}
              <button type="button" onClick={onExit} className="rounded-md bg-white/10 px-3 py-2 text-sm hover:bg-white/20"><X className="inline size-4" /> End</button>
            </div>
          </div>
          <div className="flex min-h-0 flex-col gap-3">
            <p className="text-xs uppercase tracking-wide text-white/50">Next</p>
            {visible[pos + 1] ? <StageSlide deck={deck} index={visible[pos + 1].i} step={99} width={size.w * 0.3} height={size.h * 0.3} transition={false} /> : <p className="text-sm text-white/50">End of show</p>}
            <p className="text-xs uppercase tracking-wide text-white/50">Notes</p>
            <div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-md bg-white/5 p-3 text-lg leading-relaxed">{cur?.notes || <span className="text-white/40">No notes for this slide.</span>}</div>
            <div className="flex gap-1 overflow-x-auto pb-1">
              {visible.map((v, i) => (
                <button key={v.s.id} type="button" onClick={() => goto(i)} className={`shrink-0 rounded border px-2 py-1 text-xs ${i === pos ? "border-white bg-white/20" : "border-white/20"}`}>
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <>
          {stage(size.w, size.h)}
          <div className="group absolute bottom-3 left-3 flex gap-1 opacity-0 transition-opacity hover:opacity-100">
            <button type="button" onClick={prev} className="rounded bg-white/15 p-2" aria-label="Previous"><ChevronLeft className="size-4" /></button>
            <span className="rounded bg-white/15 px-2 py-1.5 text-xs">{pos + 1} / {visible.length}</span>
            <button type="button" onClick={next} className="rounded bg-white/15 p-2" aria-label="Next"><ChevronRight className="size-4" /></button>
            <button type="button" onClick={onExit} className="rounded bg-white/15 p-2" aria-label="End show"><X className="size-4" /></button>
          </div>
        </>
      )}
      {laser && pointer && <div className="pointer-events-none fixed z-[101] size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500 shadow-[0_0_12px_4px_rgba(255,0,0,.7)]" style={{ left: pointer.x, top: pointer.y }} />}
    </div>
  );
}

/** The audience window opened from presenter view: follows the presenter over a BroadcastChannel. */
export function AudienceView({ deck, channelName }: { deck: Deck; channelName: string }) {
  const [state, setState] = useState<{ index: number; step: number; blank: null | string }>({ index: 0, step: 0, blank: null });
  const [size, setSize] = useState({ w: 1280, h: 720 });
  useEffect(() => {
    const ch = new BroadcastChannel(channelName);
    ch.onmessage = (e) => e.data?.type === "goto" && setState({ index: e.data.index, step: e.data.step, blank: e.data.blank });
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    onResize();
    window.addEventListener("resize", onResize);
    return () => {
      ch.close();
      window.removeEventListener("resize", onResize);
    };
  }, [channelName]);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black" onDoubleClick={() => document.documentElement.requestFullscreen?.()}>
      <style>{TRANSITION_CSS + SLIDE_CSS}</style>
      {state.blank ? <div style={{ position: "fixed", inset: 0, background: state.blank }} /> : <StageSlide deck={deck} index={state.index} step={state.step} width={size.w} height={size.h} />}
    </div>
  );
}
