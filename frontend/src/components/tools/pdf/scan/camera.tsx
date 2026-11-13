"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Check, Flashlight, FlashlightOff, Loader2, ScanText, X, Zap, ZapOff } from "lucide-react";
import { FULL, hint as hintFor, pixels, Tracker, vision, type Detection, type Hint, type Quad } from "@/lib/scan";
import { cn } from "@/lib/utils";

/** A captured frame: the full-size pixels and where the page is in it. */
export type Shot = { image: ImageData; quad: Quad; found: boolean };

const DETECT_SIZE = 480;
const CAPTURE_SIZE = 4096;

/**
 * Full-screen guided camera, like a scanner app: it finds the page's edges live, says what to fix
 * (light, distance, angle, focus), notices text on the page, and shoots on its own once the page has
 * been steady for a moment. Frames are analysed in a worker; nothing leaves the device.
 */
export function ScanCamera({
  pages,
  lastThumb,
  onShot,
  onClose,
}: {
  pages: number;
  lastThumb: string | null;
  onShot: (shot: Shot) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const tracker = useRef(new Tracker());
  const busy = useRef(false);
  const armed = useRef(true); // Auto-capture waits for a new page after each shot.
  const shooting = useRef(false);
  const lastShot = useRef<Quad | null>(null);
  const shootRef = useRef<(() => void) | null>(null);
  const [state, setState] = useState<"starting" | "live" | "denied" | "failed">("starting");
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [det, setDet] = useState<Detection | null>(null);
  const [quad, setQuad] = useState<Quad | null>(null);
  const [steady, setSteady] = useState(0);
  const [auto, setAuto] = useState(true);
  const [torch, setTorch] = useState<boolean | null>(null);
  const [flash, setFlash] = useState(0);
  const [waitingForNext, setWaitingForNext] = useState(false);

  // Camera and vision start together; OpenCV loads while the camera warms up.
  useEffect(() => {
    let live = true;
    const begin = async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } },
        });
        if (!live) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        const v = video.current!;
        v.srcObject = s;
        await v.play();
        const track = s.getVideoTracks()[0];
        const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
        if (caps.torch) setTorch(false);
        await vision.start();
        if (!live) return;
        setSize({ w: v.videoWidth, h: v.videoHeight });
        setState("live");
      } catch (e) {
        if (!live) return;
        const name = e instanceof DOMException ? e.name : "";
        setState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "failed");
        setError(e instanceof Error ? e.message : String(e));
      }
    };
    void begin();
    return () => {
      live = false;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Esc closes, Space shoots.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === " " && state === "live") {
        e.preventDefault();
        shootRef.current?.();
      }
    };
    window.addEventListener("keydown", onKey);
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      html.style.overflow = prev;
    };
  }, [onClose, state]);

  const shoot = useCallback(
    (auto = false) => {
      const v = video.current;
      if (!v || shooting.current || !v.videoWidth) return;
      shooting.current = true;
      const image = pixels(v, v.videoWidth, v.videoHeight, CAPTURE_SIZE);
      const q = quad;
      setFlash((n) => n + 1);
      navigator.vibrate?.(35);
      onShot({ image, quad: q ?? FULL, found: Boolean(q) });
      armed.current = false;
      lastShot.current = q;
      if (auto) setWaitingForNext(true);
      tracker.current.reset();
      setTimeout(() => (shooting.current = false), 600);
    },
    [quad, onShot],
  );
  useEffect(() => {
    shootRef.current = () => shoot(false);
  }, [shoot]);

  // The analysis loop: one frame at a time, as fast as the worker answers (about 10 a second).
  useEffect(() => {
    if (state !== "live") return;
    let raf = 0;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      raf = requestAnimationFrame(tick);
      const v = video.current;
      if (busy.current || !v || v.readyState < 2) return;
      busy.current = true;
      const img = pixels(v, v.videoWidth, v.videoHeight, DETECT_SIZE);
      void vision
        .detect(img)
        .then((d) => {
          if (!alive) return;
          const { quad: q, steady: s } = tracker.current.update(d.quad);
          setDet(d);
          setQuad(q);
          setSteady(s);
          // A new page re-arms auto-capture: the old one left the view, or a different one
          // (a turned page, a new sheet in another spot) sits where it was.
          const moved = (a: Quad, b: Quad) => Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1])));
          if (!armed.current && (!d.quad || (d.quad && lastShot.current && moved(d.quad, lastShot.current) > 0.09))) {
            armed.current = true;
            setWaitingForNext(false);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          busy.current = false;
        });
    };
    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [state]);

  const aspect = size ? size.w / size.h : 16 / 9;
  const h: Hint = waitingForNext ? { key: "next", text: "Got it. Place the next page, or tap Done", tone: "good" } : hintFor(det, quad, steady, aspect);
  const ready = h.key === "go" || h.key === "steady";

  // Shoot by itself once everything is right and steady.
  useEffect(() => {
    if (auto && armed.current && h.key === "go" && state === "live") shoot(true);
  }, [auto, h.key, state, shoot]);

  const toggleTorch = async () => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track || torch === null) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch {
      setTorch(null);
    }
  };

  const ui = (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Document scanner"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex flex-col bg-[#0d0c09] text-paper"
    >
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 px-3 pb-2 pt-[max(12px,env(safe-area-inset-top))]">
        <button type="button" onClick={onClose} aria-label="Close the scanner" className="inline-flex size-10 items-center justify-center rounded-full bg-paper/10 hover:bg-paper/20">
          <X aria-hidden className="size-5" />
        </button>
        <div aria-live="polite" className="min-w-0 flex-1 text-center">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={h.key}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.22 }}
              className={cn(
                "mx-auto inline-flex max-w-full items-center gap-2 rounded-[18px] px-3.5 py-1.5 text-left text-[13px] font-medium leading-snug",
                h.tone === "good" ? "bg-success text-paper" : h.tone === "warn" ? "bg-warning text-ink" : h.tone === "adjust" ? "bg-paper text-ink" : "bg-paper/15 text-paper",
              )}
            >
              {h.tone === "search" && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
              <span className="line-clamp-2">{state === "live" ? h.text : state === "starting" ? "Starting the camera…" : "The camera isn't available"}</span>
            </motion.p>
          </AnimatePresence>
        </div>
        <div className="flex items-center gap-1.5">
          {torch !== null && (
            <button type="button" onClick={toggleTorch} aria-pressed={torch} aria-label="Torch" className={cn("inline-flex size-10 items-center justify-center rounded-full", torch ? "bg-paper text-ink" : "bg-paper/10 hover:bg-paper/20")}>
              {torch ? <Flashlight aria-hidden className="size-5" /> : <FlashlightOff aria-hidden className="size-5" />}
            </button>
          )}
          <button
            type="button"
            onClick={() => setAuto((a) => !a)}
            aria-pressed={auto}
            title={auto ? "Auto-capture is on" : "Auto-capture is off"}
            className={cn("inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium", auto ? "bg-paper text-ink" : "bg-paper/10 text-paper hover:bg-paper/20")}
          >
            {auto ? <Zap aria-hidden className="size-4" /> : <ZapOff aria-hidden className="size-4" />}
            Auto
          </button>
        </div>
      </div>

      {/* Viewfinder */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-2 [container-type:size]">
        {/* Exactly the video's shape, as large as fits: the outline's coordinates then match the picture. */}
        <div className="relative" style={{ width: `min(100cqw, calc(100cqh * ${aspect}))`, aspectRatio: `${aspect}` }}>
          <video ref={video} playsInline muted className="absolute inset-0 size-full rounded-md object-contain" />
          {state === "live" && size && <Overlay quad={quad} steady={auto ? steady : 0} ready={ready} w={size.w} h={size.h} searching={!quad} />}
          {/* Shutter flash */}
          <AnimatePresence>
            {flash > 0 && (
              <motion.span key={flash} aria-hidden initial={{ opacity: 0.9 }} animate={{ opacity: 0 }} transition={{ duration: 0.5 }} className="pointer-events-none absolute inset-0 rounded-md bg-paper" />
            )}
          </AnimatePresence>
          {det && det.text > 0.35 && quad && (
            <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-ink/80 px-2.5 py-1 text-[12px] text-paper backdrop-blur">
              <ScanText aria-hidden className="size-3.5" /> Text found
            </motion.span>
          )}
        </div>
        {(state === "denied" || state === "failed") && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="max-w-sm rounded-lg bg-paper p-5 text-ink">
              <p className="text-[15px] font-semibold">{state === "denied" ? "Camera access is blocked" : "The camera couldn't start"}</p>
              <p className="mt-1.5 text-sm text-ink-2">
                {state === "denied"
                  ? "Allow the camera for this site in your browser's settings, then try again. Or close this and add photos instead."
                  : `Close this and add photos of the pages instead. ${error ? `(${error})` : ""}`}
              </p>
              <button type="button" onClick={onClose} className="mt-4 inline-flex h-10 items-center rounded-md bg-ink px-4 text-sm font-medium text-paper">
                Add photos instead
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div className="grid grid-cols-3 items-center px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
        <div className="flex items-center">
          <AnimatePresence mode="popLayout">
            {lastThumb && (
              <motion.span
                key={lastThumb}
                initial={{ scale: 0.4, opacity: 0, y: -40 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 380, damping: 26 }}
                className="relative block h-14 w-11 overflow-hidden rounded-[6px] border-2 border-paper bg-paper"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={lastThumb} alt="" className="size-full object-cover" />
                <span className="absolute -right-0 -top-0 rounded-bl-[6px] bg-accent px-1 font-mono text-[11px] font-medium text-paper">{pages}</span>
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => shoot(false)}
            disabled={state !== "live"}
            aria-label="Take the picture"
            className="group relative inline-flex size-[74px] items-center justify-center rounded-full disabled:opacity-40"
          >
            <svg aria-hidden viewBox="0 0 74 74" className="absolute inset-0 -rotate-90">
              <circle cx="37" cy="37" r="34" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="4" />
              <motion.circle cx="37" cy="37" r="34" fill="none" stroke="var(--color-accent)" strokeWidth="4" strokeLinecap="round" pathLength={1} strokeDasharray="1 1" animate={{ strokeDashoffset: 1 - (auto ? steady : 0) }} transition={{ duration: 0.15 }} />
            </svg>
            <span className="size-[58px] rounded-full bg-paper transition-transform duration-150 group-active:scale-90" />
          </button>
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className={cn("inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-sm font-medium", pages ? "bg-paper text-ink" : "bg-paper/10 text-paper")}>
            <Check aria-hidden className="size-4" />
            {pages ? `Done · ${pages}` : "Done"}
          </button>
        </div>
      </div>
    </motion.div>
  );

  return createPortal(ui, document.body);
}

/**
 * The page outline over the video: a soft fill, the edges, viewfinder brackets on each corner, and
 * (when auto-capture is counting) the outline drawing itself in accent as the page holds steady.
 * While nothing is found, brackets frame the view and a scan line sweeps.
 */
function Overlay({ quad, steady, ready, w, h, searching }: { quad: Quad | null; steady: number; ready: boolean; w: number; h: number; searching: boolean }) {
  const pts = quad?.map(([x, y]) => [x * w, y * h]) ?? null;
  const path = pts ? `M${pts.map((p) => p.join(",")).join("L")}Z` : "";
  const stroke = Math.max(2, w / 300);
  const bracket = (p: number[], a: number[], b: number[]) => {
    const len = Math.min(w, h) * 0.06;
    const toward = (to: number[]) => {
      const dx = to[0] - p[0];
      const dy = to[1] - p[1];
      const d = Math.hypot(dx, dy) || 1;
      return [p[0] + (dx / d) * len, p[1] + (dy / d) * len];
    };
    const [ax, ay] = toward(a);
    const [bx, by] = toward(b);
    return `M${ax},${ay}L${p[0]},${p[1]}L${bx},${by}`;
  };
  return (
    <svg aria-hidden viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full">
      {searching ? (
        <>
          {[
            [0.08, 0.1, 1, 1],
            [0.92, 0.1, -1, 1],
            [0.92, 0.9, -1, -1],
            [0.08, 0.9, 1, -1],
          ].map(([x, y, sx, sy], i) => {
            const L = Math.min(w, h) * 0.08;
            const X = x * w;
            const Y = y * h;
            return <path key={i} d={`M${X + sx * L},${Y}L${X},${Y}L${X},${Y + sy * L}`} fill="none" stroke="white" strokeOpacity="0.7" strokeWidth={stroke * 1.5} strokeLinecap="round" />;
          })}
          <motion.rect
            x={w * 0.08}
            width={w * 0.84}
            height={stroke}
            fill="var(--color-accent)"
            initial={{ y: h * 0.12, opacity: 0.9 }}
            animate={{ y: [h * 0.12, h * 0.88, h * 0.12] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
          />
        </>
      ) : (
        pts && (
          <>
            <path d={path} fill={ready ? "rgba(47,125,79,0.16)" : "rgba(251,250,246,0.14)"} stroke="white" strokeOpacity="0.85" strokeWidth={stroke} strokeLinejoin="round" style={{ transition: "d 120ms linear, fill 200ms" }} />
            <motion.path d={path} fill="none" stroke="var(--color-accent)" strokeWidth={stroke * 1.6} strokeLinejoin="round" pathLength={1} strokeDasharray="1 1" animate={{ strokeDashoffset: 1 - steady }} transition={{ duration: 0.15 }} />
            {pts.map((p, i) => (
              <path key={i} d={bracket(p, pts[(i + 1) % 4], pts[(i + 3) % 4])} fill="none" stroke="white" strokeWidth={stroke * 2.4} strokeLinecap="round" strokeLinejoin="round" />
            ))}
          </>
        )
      )}
    </svg>
  );
}
