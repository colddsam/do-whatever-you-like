import { ImageResponse } from "next/og";
import { LOGO_HALO_PATH, LOGO_INK_PATH, LOGO_VIEWBOX } from "./logo-paths";

/** Social card size (Open Graph and X both use 1200×630). */
export const OG_SIZE = { width: 1200, height: 630 };

const PAPER = "#f3f0e8";
const INK = "#15140f";
const INK_2 = "#57544a";
const LINE = "#dad5c8";
const ACCENT = "#eb4a10";

/**
 * The card every page shares: a centered 566×546 editorial card inside the 1200×630 canvas.
 * Keeping all key content inside the center 630×630 square ensures nothing is cropped on
 * platforms that render 1:1 thumbnails (e.g. WhatsApp Web) while still looking balanced as
 * a full 1.91:1 banner (X/Twitter, Discord, LinkedIn, Slack, Facebook).
 */
export function ogCard({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  const titleSize = title.length > 36 ? 36 : title.length > 22 ? 44 : 54;
  const trimmedSubtitle = subtitle.length > 120 ? `${subtitle.slice(0, 117).trimEnd()}...` : subtitle;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: PAPER,
          color: INK,
          position: "relative",
        }}
      >
        {/* Subtle horizontal framing rule across the full 1200px banner */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 315,
            height: 2,
            background: LINE,
            display: "flex",
          }}
        />

        {/* Center-safe card (fits cleanly inside a 630×630 square crop) */}
        <div
          style={{
            width: 566,
            height: 546,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            background: "#faf8f3",
            border: `2px solid ${LINE}`,
            borderRadius: 24,
            padding: "40px 44px",
            position: "relative",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14 }}>
            <svg width="28" height="55" viewBox={LOGO_VIEWBOX}>
              <path d={LOGO_HALO_PATH} fill="#ffffff" />
              <path d={LOGO_INK_PATH} fill={INK} fillRule="evenodd" />
            </svg>
            <div style={{ display: "flex", fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em" }}>
              Do<span style={{ color: INK_2 }}>-</span>Whatever<span style={{ color: INK_2 }}>-</span>You<span style={{ color: INK_2 }}>-</span>Like
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
            <div
              style={{
                display: "flex",
                fontSize: 18,
                fontWeight: 600,
                color: ACCENT,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              {eyebrow}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginTop: 14,
                fontSize: titleSize,
                fontWeight: 600,
                lineHeight: 1.08,
                letterSpacing: "-0.03em",
              }}
            >
              {title}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginTop: 18,
                fontSize: 21,
                color: INK_2,
                lineHeight: 1.35,
                maxWidth: 470,
              }}
            >
              {trimmedSubtitle}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              borderTop: `2px solid ${LINE}`,
              paddingTop: 18,
              gap: 4,
              fontSize: 17,
              color: INK_2,
            }}
          >
            <span>Free · No sign-up · Nothing to install</span>
            <span style={{ color: INK, fontWeight: 600 }}>do-whatever-you-like.colddsam.com</span>
          </div>
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
