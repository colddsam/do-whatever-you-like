"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * Real devices as CSS: the screen is exactly the device's viewport in CSS pixels, and the body,
 * bezels, camera cut-outs, buttons, status bar, keyboard deck or stand are drawn around it at the
 * same scale, so a page looks (and wraps) the way it would on the device.
 */

export type FrameKind = "phone" | "tablet" | "laptop" | "monitor" | "tv" | "none";
export type Cutout = "island" | "notch" | "punch" | "home" | "none";
export type Device = {
  id: string;
  name: string;
  group: "Phones" | "Tablets" | "Laptops" | "Desktops & TVs";
  w: number;
  h: number;
  dpr: number;
  kind: FrameKind;
  cutout?: Cutout;
  /** Body colour (the bezel is always near-black, like the real thing). */
  finish?: string;
  /** Screen corner radius, in CSS pixels. */
  radius?: number;
};

export const DEVICES: Device[] = [
  // Phones
  { id: "iphone-se", name: "iPhone SE", group: "Phones", w: 375, h: 667, dpr: 2, kind: "phone", cutout: "home", finish: "#e4e4e2" },
  { id: "iphone-13-mini", name: "iPhone 13 mini", group: "Phones", w: 375, h: 812, dpr: 3, kind: "phone", cutout: "notch", finish: "#3b4250", radius: 44 },
  { id: "iphone-15", name: "iPhone 15", group: "Phones", w: 393, h: 852, dpr: 3, kind: "phone", cutout: "island", finish: "#c9d6dc", radius: 55 },
  { id: "iphone-16-pro", name: "iPhone 16 Pro", group: "Phones", w: 402, h: 874, dpr: 3, kind: "phone", cutout: "island", finish: "#bfb5a6", radius: 55 },
  { id: "iphone-16-pro-max", name: "iPhone 16 Pro Max", group: "Phones", w: 440, h: 956, dpr: 3, kind: "phone", cutout: "island", finish: "#4a4744", radius: 58 },
  { id: "pixel-9", name: "Pixel 9", group: "Phones", w: 412, h: 923, dpr: 2.625, kind: "phone", cutout: "punch", finish: "#e8dccb", radius: 44 },
  { id: "pixel-9-pro-xl", name: "Pixel 9 Pro XL", group: "Phones", w: 412, h: 915, dpr: 3.5, kind: "phone", cutout: "punch", finish: "#2f3437", radius: 40 },
  { id: "galaxy-s24", name: "Galaxy S24", group: "Phones", w: 360, h: 780, dpr: 3, kind: "phone", cutout: "punch", finish: "#d6cfe3", radius: 36 },
  { id: "galaxy-s24-ultra", name: "Galaxy S24 Ultra", group: "Phones", w: 384, h: 824, dpr: 3.75, kind: "phone", cutout: "punch", finish: "#5a5c5e", radius: 18 },
  { id: "galaxy-a55", name: "Galaxy A55", group: "Phones", w: 384, h: 854, dpr: 2.8125, kind: "phone", cutout: "punch", finish: "#9fb4d6", radius: 34 },
  { id: "galaxy-z-fold", name: "Galaxy Z Fold (folded)", group: "Phones", w: 344, h: 882, dpr: 3, kind: "phone", cutout: "punch", finish: "#2b2d30", radius: 24 },
  { id: "oneplus-12", name: "OnePlus 12", group: "Phones", w: 412, h: 919, dpr: 3.5, kind: "phone", cutout: "punch", finish: "#1f5c4a", radius: 40 },
  { id: "redmi-note-13", name: "Redmi Note 13", group: "Phones", w: 393, h: 873, dpr: 2.75, kind: "phone", cutout: "punch", finish: "#26282c", radius: 34 },
  // Tablets
  { id: "ipad-mini", name: "iPad mini", group: "Tablets", w: 744, h: 1133, dpr: 2, kind: "tablet", finish: "#d8d2e6", radius: 22 },
  { id: "ipad-air-11", name: "iPad Air 11″", group: "Tablets", w: 820, h: 1180, dpr: 2, kind: "tablet", finish: "#c4d3e0", radius: 18 },
  { id: "ipad-pro-13", name: "iPad Pro 13″", group: "Tablets", w: 1032, h: 1376, dpr: 2, kind: "tablet", finish: "#3d3d3f", radius: 18 },
  { id: "galaxy-tab-s9", name: "Galaxy Tab S9", group: "Tablets", w: 800, h: 1280, dpr: 2, kind: "tablet", finish: "#4b4d50", radius: 16 },
  { id: "surface-pro", name: "Surface Pro", group: "Tablets", w: 912, h: 1368, dpr: 2, kind: "tablet", finish: "#a8adb3", radius: 10 },
  { id: "galaxy-z-fold-open", name: "Galaxy Z Fold (open)", group: "Tablets", w: 690, h: 829, dpr: 2.625, kind: "tablet", finish: "#2b2d30", radius: 16 },
  // Laptops
  { id: "macbook-air-13", name: "MacBook Air 13″", group: "Laptops", w: 1470, h: 956, dpr: 2, kind: "laptop", finish: "#c8ccd1" },
  { id: "macbook-pro-14", name: "MacBook Pro 14″", group: "Laptops", w: 1512, h: 982, dpr: 2, kind: "laptop", finish: "#3a3b3d" },
  { id: "macbook-pro-16", name: "MacBook Pro 16″", group: "Laptops", w: 1728, h: 1117, dpr: 2, kind: "laptop", finish: "#3a3b3d" },
  { id: "laptop-hd", name: "Laptop 1366 × 768", group: "Laptops", w: 1366, h: 768, dpr: 1, kind: "laptop", finish: "#2e3033" },
  { id: "laptop-fhd", name: "Laptop 1536 × 864 (125%)", group: "Laptops", w: 1536, h: 864, dpr: 1.25, kind: "laptop", finish: "#2e3033" },
  { id: "chromebook", name: "Chromebook", group: "Laptops", w: 1280, h: 800, dpr: 1, kind: "laptop", finish: "#6f7378" },
  // Desktops & TVs
  { id: "desktop-hd", name: "Monitor 1280 × 720", group: "Desktops & TVs", w: 1280, h: 720, dpr: 1, kind: "monitor" },
  { id: "desktop-fhd", name: "Monitor 1920 × 1080", group: "Desktops & TVs", w: 1920, h: 1080, dpr: 1, kind: "monitor" },
  { id: "desktop-qhd", name: "Monitor 2560 × 1440", group: "Desktops & TVs", w: 2560, h: 1440, dpr: 1, kind: "monitor" },
  { id: "imac-24", name: "iMac 24″", group: "Desktops & TVs", w: 2240, h: 1260, dpr: 2, kind: "monitor", finish: "#7fa3c7" },
  { id: "ultrawide", name: "Ultrawide 3440 × 1440", group: "Desktops & TVs", w: 3440, h: 1440, dpr: 1, kind: "monitor" },
  { id: "tv-1080", name: "Smart TV 1080p", group: "Desktops & TVs", w: 1920, h: 1080, dpr: 1, kind: "tv" },
  { id: "tv-4k", name: "Smart TV 4K", group: "Desktops & TVs", w: 3840, h: 2160, dpr: 2, kind: "tv" },
];

export const GROUPS = ["Phones", "Tablets", "Laptops", "Desktops & TVs"] as const;

const BEZEL = "#0b0b0c";

/** The frame's outer size around a w × h screen, so the caller can scale it to fit. */
export function frameSize(kind: FrameKind, w: number, h: number, landscape: boolean, cutout: Cutout = "none") {
  switch (kind) {
    case "phone": {
      if (cutout === "home") return landscape ? { w: w + 2 * 64, h: h + 2 * 16 } : { w: w + 2 * 16, h: h + 2 * 64 };
      return { w: w + 2 * 13, h: h + 2 * 13 };
    }
    case "tablet":
      return { w: w + 2 * 20, h: h + 2 * 20 };
    case "laptop": {
      const bz = Math.round(Math.max(14, w * 0.012));
      return { w: Math.round((w + 2 * bz) * 1.16), h: h + bz + bz * 1.6 + Math.max(14, w * 0.012) + 6 };
    }
    case "monitor": {
      const bz = Math.round(Math.max(12, w * 0.008));
      return { w: w + 2 * bz, h: h + 2 * bz + Math.round(h * 0.03) + Math.round(h * 0.17) + 10 };
    }
    case "tv": {
      const bz = Math.round(Math.max(8, w * 0.004));
      return { w: w + 2 * bz, h: h + 2 * bz + Math.round(h * 0.05) };
    }
    default:
      return { w, h };
  }
}

function StatusBar({ cutout, dark }: { cutout: Cutout; dark?: boolean }) {
  const h = cutout === "island" ? 54 : cutout === "notch" ? 47 : cutout === "home" ? 20 : 30;
  const big = cutout === "island" || cutout === "notch";
  return (
    <div className={cn("flex shrink-0 items-center justify-between font-semibold tracking-tight", dark ? "bg-black text-white" : "bg-white text-black")} style={{ height: h, padding: big ? "0 30px 0 34px" : "0 14px", fontSize: big ? 16 : 12 }}>
      <span style={{ width: big ? 54 : undefined }}>9:41</span>
      {cutout === "home" && <span className="text-[11px] font-semibold">Safari</span>}
      <span className="flex items-center gap-[5px]" aria-hidden>
        <svg width={big ? 18 : 15} height="11" viewBox="0 0 18 11" fill="currentColor">
          <rect x="0" y="7" width="3" height="4" rx="0.7" />
          <rect x="5" y="5" width="3" height="6" rx="0.7" />
          <rect x="10" y="2.5" width="3" height="8.5" rx="0.7" />
          <rect x="15" y="0" width="3" height="11" rx="0.7" />
        </svg>
        <svg width={big ? 16 : 14} height="11" viewBox="0 0 16 11" fill="currentColor">
          <path d="M8 2.2c2.2 0 4.2.9 5.7 2.3l1.1-1.2A9.6 9.6 0 0 0 8 .6 9.6 9.6 0 0 0 1.2 3.3l1.1 1.2A8 8 0 0 1 8 2.2Zm0 3.2c1.3 0 2.5.5 3.4 1.3l1.1-1.2A6.4 6.4 0 0 0 8 3.8c-1.7 0-3.3.6-4.5 1.7l1.1 1.2c.9-.8 2.1-1.3 3.4-1.3Zm0 3.2c.5 0 .9.2 1.2.5L8 10.4 6.8 9.1c.3-.3.7-.5 1.2-.5Z" />
        </svg>
        <span className="relative inline-block rounded-[3.5px] border border-current opacity-90" style={{ width: big ? 25 : 21, height: big ? 12 : 10 }}>
          <span className="absolute inset-[1.5px] rounded-[2px] bg-current" style={{ right: "18%" }} />
        </span>
      </span>
    </div>
  );
}

/**
 * Draws the device around `children` (the iframe), at 1:1. `w`/`h` are the screen's CSS size in the
 * current orientation. The status bar and home indicator are drawn on the screen, as on the device.
 */
export function DeviceFrame({ device, w, h, landscape, children }: { device: Pick<Device, "kind" | "cutout" | "finish" | "radius">; w: number; h: number; landscape: boolean; children: ReactNode }) {
  const { kind, cutout = "none", finish = "#2b2c2e", radius = 0 } = device;
  const size = frameSize(kind, w, h, landscape, cutout);

  if (kind === "phone") {
    const home = cutout === "home";
    const bz = 13;
    const bodyR = home ? 56 : radius + bz;
    const pad = home ? (landscape ? "16px 64px" : "64px 16px") : `${bz}px`;
    const statusShown = !landscape;
    const buttons = landscape
      ? [
          { side: "top" as const, at: 0.18, len: 0.07 },
          { side: "top" as const, at: 0.28, len: 0.07 },
          { side: "bottom" as const, at: 0.26, len: 0.1 },
        ]
      : [
          { side: "left" as const, at: 0.17, len: 0.035 },
          { side: "left" as const, at: 0.24, len: 0.07 },
          { side: "left" as const, at: 0.33, len: 0.07 },
          { side: "right" as const, at: 0.26, len: 0.1 },
        ];
    return (
      <div className="relative" style={{ width: size.w, height: size.h }}>
        {/* Side buttons, just outside the body */}
        {buttons.map((b, i) => (
          <span
            key={i}
            aria-hidden
            className="absolute rounded-full"
            style={{
              background: finish,
              boxShadow: "inset 0 0 0 1px rgba(0,0,0,.25)",
              ...(b.side === "left" || b.side === "right"
                ? { top: size.h * b.at, height: size.h * b.len, width: 4, [b.side]: -3 }
                : { left: size.w * b.at, width: size.w * b.len, height: 4, [b.side]: -3 }),
            }}
          />
        ))}
        {/* Body: the metal edge, then the black bezel */}
        <div className="absolute inset-0" style={{ borderRadius: bodyR, background: finish, padding: 3, boxShadow: "0 30px 60px -20px rgba(0,0,0,.45), 0 0 0 1px rgba(0,0,0,.2)" }}>
          <div className="relative flex h-full w-full items-center justify-center" style={{ borderRadius: bodyR - 3, background: BEZEL, padding: `calc(${pad} - 3px)` }}>
            {home && (
              <>
                {/* Earpiece and camera above, home button below */}
                <span aria-hidden className="absolute rounded-full bg-[#2a2a2c]" style={landscape ? { left: 24, top: "50%", width: 5, height: 46, transform: "translateY(-50%)" } : { top: 30, left: "50%", width: 46, height: 5, transform: "translateX(-50%)" }} />
                <span aria-hidden className="absolute size-[9px] rounded-full bg-[#1d2333] ring-1 ring-[#333]" style={landscape ? { left: 36, top: "50%", transform: "translate(0,-180%)" } : { top: 27, left: "50%", transform: "translateX(-410%)" }} />
                <span aria-hidden className="absolute size-[44px] rounded-full border-2 border-[#2c2c2e]" style={landscape ? { right: 10, top: "50%", transform: "translateY(-50%)" } : { bottom: 10, left: "50%", transform: "translateX(-50%)" }} />
              </>
            )}
            {/* The screen */}
            <div className="relative flex overflow-hidden bg-white" style={{ width: w, height: h, borderRadius: home ? 0 : radius, flexDirection: "column" }}>
              {statusShown && <StatusBar cutout={cutout} />}
              <div className="relative min-h-0 flex-1">{children}</div>
              {/* Camera cut-outs, drawn over the screen like the real hardware */}
              {cutout === "island" && <span aria-hidden className="absolute rounded-full bg-black" style={landscape ? { left: 11, top: "50%", width: 37, height: 126, transform: "translateY(-50%)" } : { top: 11, left: "50%", width: 126, height: 37, transform: "translateX(-50%)" }} />}
              {cutout === "notch" && <span aria-hidden className="absolute bg-black" style={landscape ? { left: 0, top: "50%", width: 32, height: 162, transform: "translateY(-50%)", borderRadius: "0 22px 22px 0" } : { top: 0, left: "50%", width: 162, height: 32, transform: "translateX(-50%)", borderRadius: "0 0 22px 22px" }} />}
              {cutout === "punch" && <span aria-hidden className="absolute size-[12px] rounded-full bg-black ring-2 ring-black/30" style={landscape ? { left: 12, top: "50%", transform: "translateY(-50%)" } : { top: 10, left: "50%", transform: "translateX(-50%)" }} />}
              {!home && <span aria-hidden className="pointer-events-none absolute left-1/2 h-[5px] -translate-x-1/2 rounded-full bg-black/80" style={{ bottom: 8, width: landscape ? 200 : 134 }} />}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (kind === "tablet") {
    return (
      <div className="relative" style={{ width: size.w, height: size.h }}>
        <span aria-hidden className="absolute rounded-full" style={{ background: finish, ...(landscape ? { left: -3, top: 40, width: 4, height: 56 } : { top: -3, right: 46, height: 4, width: 56 }) }} />
        <div className="absolute inset-0" style={{ borderRadius: radius + 20, background: finish, padding: 3, boxShadow: "0 30px 70px -25px rgba(0,0,0,.45), 0 0 0 1px rgba(0,0,0,.2)" }}>
          <div className="relative flex h-full w-full items-center justify-center" style={{ borderRadius: radius + 17, background: BEZEL }}>
            <span aria-hidden className="absolute size-[7px] rounded-full bg-[#1d2333]" style={landscape ? { left: 7, top: "50%", transform: "translateY(-50%)" } : { top: 7, left: "50%", transform: "translateX(-50%)" }} />
            <div className="relative flex flex-col overflow-hidden bg-white" style={{ width: w, height: h, borderRadius: radius }}>
              <StatusBar cutout="none" />
              <div className="relative min-h-0 flex-1">{children}</div>
              <span aria-hidden className="pointer-events-none absolute bottom-2 left-1/2 h-[5px] w-[180px] -translate-x-1/2 rounded-full bg-black/80" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (kind === "laptop") {
    const bz = Math.round(Math.max(14, w * 0.012));
    const deck = Math.max(14, w * 0.012);
    const lidW = w + 2 * bz;
    return (
      <div className="relative flex flex-col items-center" style={{ width: size.w, height: size.h }}>
        {/* Lid */}
        <div className="relative shrink-0" style={{ width: lidW, padding: `${bz * 1.6}px ${bz}px ${bz}px`, background: BEZEL, borderRadius: `${bz * 1.3}px ${bz * 1.3}px 4px 4px`, boxShadow: `0 0 0 2px ${finish}, 0 20px 50px -20px rgba(0,0,0,.4)` }}>
          <span aria-hidden className="absolute left-1/2 rounded-full bg-[#1d2333] ring-1 ring-[#333]" style={{ top: bz * 0.55, width: bz * 0.45, height: bz * 0.45, transform: "translateX(-50%)" }} />
          <div className="relative overflow-hidden bg-white" style={{ width: w, height: h }}>
            {children}
          </div>
        </div>
        {/* Base, with the thumb notch */}
        <div className="relative shrink-0" style={{ width: size.w, height: deck, marginTop: 2, background: `linear-gradient(${finish}, color-mix(in srgb, ${finish} 70%, black))`, borderRadius: `2px 2px ${deck * 1.4}px ${deck * 1.4}px`, boxShadow: "0 12px 24px -10px rgba(0,0,0,.45)" }}>
          <span aria-hidden className="absolute left-1/2 top-0 -translate-x-1/2" style={{ width: lidW * 0.14, height: deck * 0.42, background: "rgba(0,0,0,.25)", borderRadius: `0 0 ${deck}px ${deck}px` }} />
        </div>
      </div>
    );
  }

  if (kind === "monitor") {
    const bz = Math.round(Math.max(12, w * 0.008));
    const chin = Math.round(h * 0.03);
    const neck = Math.round(h * 0.17);
    const isMac = finish !== "#2b2c2e";
    return (
      <div className="relative flex flex-col items-center" style={{ width: size.w, height: size.h }}>
        <div className="relative shrink-0" style={{ padding: bz, paddingBottom: isMac ? chin + bz : bz, background: isMac ? `linear-gradient(${BEZEL} 0, ${BEZEL} calc(100% - ${chin}px), ${finish} 0)` : BEZEL, borderRadius: bz, boxShadow: "0 30px 60px -25px rgba(0,0,0,.45), 0 0 0 1px rgba(0,0,0,.25)" }}>
          <div className="relative overflow-hidden bg-white" style={{ width: w, height: h }}>
            {children}
          </div>
          {!isMac && <span aria-hidden className="absolute bottom-[3px] left-1/2 h-[3px] w-[3px] -translate-x-1/2 rounded-full bg-emerald-400/80" />}
        </div>
        {!isMac && <span aria-hidden style={{ height: chin }} />}
        <div aria-hidden className="shrink-0" style={{ width: Math.max(60, w * 0.12), height: neck, background: isMac ? finish : "linear-gradient(90deg,#26272a,#3a3b3f,#26272a)", clipPath: "polygon(12% 0, 88% 0, 100% 100%, 0 100%)" }} />
        <div aria-hidden className="shrink-0 rounded-[50%]" style={{ width: Math.max(140, w * 0.28), height: 10, background: isMac ? finish : "#2b2c2f", boxShadow: "0 6px 12px -4px rgba(0,0,0,.4)" }} />
      </div>
    );
  }

  if (kind === "tv") {
    const bz = Math.round(Math.max(8, w * 0.004));
    const feet = Math.round(h * 0.05);
    return (
      <div className="relative" style={{ width: size.w, height: size.h }}>
        <div className="relative" style={{ padding: bz, background: BEZEL, borderRadius: 4, boxShadow: "0 30px 60px -25px rgba(0,0,0,.5), 0 0 0 1px #222" }}>
          <div className="relative overflow-hidden bg-white" style={{ width: w, height: h }}>
            {children}
          </div>
        </div>
        <span aria-hidden className="absolute" style={{ left: "12%", bottom: 0, width: w * 0.03, height: feet, background: "#1d1e20", clipPath: "polygon(40% 0, 60% 0, 100% 100%, 0 100%)" }} />
        <span aria-hidden className="absolute" style={{ right: "12%", bottom: 0, width: w * 0.03, height: feet, background: "#1d1e20", clipPath: "polygon(40% 0, 60% 0, 100% 100%, 0 100%)" }} />
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-sm bg-white ring-1 ring-line" style={{ width: w, height: h }}>
      {children}
    </div>
  );
}
