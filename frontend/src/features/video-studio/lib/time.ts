/** Random ids that survive JSON and sort nowhere in particular. */
export function uid(prefix = "") {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return prefix + a[0].toString(36) + a[1].toString(36).slice(0, 4);
}

/** Floating-point times drift (0.1 + 0.2); keep them on a microsecond grid. */
export const rt = (t: number) => Math.round(t * 1e6) / 1e6;

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** The start of the frame that contains `t`. */
export const frameFloor = (t: number, fps: number) => rt(Math.floor(t * fps + 1e-6) / fps);
/** The nearest frame boundary. */
export const frameRound = (t: number, fps: number) => rt(Math.round(t * fps) / fps);

/** HH:MM:SS:FF, the SMPTE-style timecode editors show (always with hours, so 00:00:04:00 can't read as minutes). */
export function timecode(t: number, fps: number) {
  const rate = Math.max(1, Math.round(fps));
  const total = Math.max(0, Math.round(t * rate));
  const f = total % rate;
  const s = Math.floor(total / rate);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(f)}`;
}

/** 1:02.5 — short, for lengths. */
export function shortTime(t: number) {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  const sec = rest < 10 && m ? `0${rest.toFixed(1)}` : rest.toFixed(1);
  return m ? `${m}:${sec}` : `${sec}s`;
}

export function formatBytes(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

export const dbToGain = (db: number) => (db <= -60 ? 0 : Math.pow(10, db / 20));
export const gainToDb = (g: number) => (g <= 0.001 ? -60 : 20 * Math.log10(g));
