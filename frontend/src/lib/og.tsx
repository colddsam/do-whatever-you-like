import { ImageResponse } from "next/og";

/** Social card size (Open Graph and X both use 1200×630). */
export const OG_SIZE = { width: 1200, height: 630 };

const PAPER = "#f3f0e8";
const INK = "#15140f";
const INK_2 = "#57544a";
const LINE = "#dad5c8";
const ACCENT = "#eb4a10";

/** The card every page shares: the logo, a big headline, a line under it, the site's address. */
export function ogCard({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: PAPER, color: INK, padding: "64px 72px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="56" height="56" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="8" fill={INK} />
            <path d="M9 16.5l4.5 4.5L23 11.5" fill="none" stroke={PAPER} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="24.5" cy="24.5" r="3" fill={ACCENT} />
          </svg>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 600, letterSpacing: "-0.02em" }}>
            Do<span style={{ color: INK_2 }}>-</span>Whatever
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 26, color: ACCENT, textTransform: "uppercase", letterSpacing: "0.08em" }}>{eyebrow}</div>
          <div style={{ display: "flex", marginTop: 16, fontSize: title.length > 28 ? 76 : 96, fontWeight: 600, lineHeight: 1.02, letterSpacing: "-0.04em" }}>{title}</div>
          <div style={{ display: "flex", marginTop: 24, fontSize: 32, color: INK_2, lineHeight: 1.3, maxWidth: 980 }}>{subtitle}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: `2px solid ${LINE}`, paddingTop: 24, fontSize: 24, color: INK_2 }}>
          <span>Free · No sign-up · Nothing to install</span>
          <span>do-whatever-you-like.colddsam.com</span>
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
