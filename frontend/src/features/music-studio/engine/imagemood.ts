/**
 * Image → music (MusicAI-style): reads a picture's colour, brightness, contrast and warmth on
 * the device and turns them into a genre, mood, tempo, key and energy for the composer.
 */

export type ImageMood = {
  genre: string;
  mood: string;
  bpm: number;
  mode: "major" | "minor";
  energy: number;
  key: string;
  seed: number;
  palette: string[];
  reading: string;
};

const KEYS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

export async function analyzeImage(file: Blob): Promise<ImageMood> {
  const bmp = await createImageBitmap(file);
  const size = 48;
  const canvas = new OffscreenCanvas(size, size);
  const g = canvas.getContext("2d")!;
  g.drawImage(bmp, 0, 0, size, size);
  bmp.close();
  const { data } = g.getImageData(0, 0, size, size);
  let lum = 0;
  let lum2 = 0;
  let sat = 0;
  let warm = 0;
  let hash = 2166136261;
  const hues = new Array(12).fill(0);
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const gg = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const max = Math.max(r, gg, b);
    const min = Math.min(r, gg, b);
    const l = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    lum += l;
    lum2 += l * l;
    const s = max === 0 ? 0 : (max - min) / max;
    sat += s;
    warm += r - b;
    if (s > 0.2 && max > 0.2) {
      let h = 0;
      if (max === r) h = ((gg - b) / (max - min)) % 6;
      else if (max === gg) h = (b - r) / (max - min) + 2;
      else h = (r - gg) / (max - min) + 4;
      hues[Math.floor((((h * 60 + 360) % 360) / 30)) % 12] += s;
    }
    hash = Math.imul(hash ^ data[i], 16777619);
  }
  lum /= n;
  sat /= n;
  warm /= n;
  const contrast = Math.sqrt(Math.max(0, lum2 / n - lum * lum));
  const domHue = hues.indexOf(Math.max(...hues)) * 30;
  const colourful = Math.max(...hues) > n * 0.05;

  // Palette: the three strongest hues as swatches.
  const palette = hues
    .map((v, i) => ({ v, i }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 3)
    .filter((x) => x.v > 0)
    .map((x) => `hsl(${x.i * 30 + 15} ${Math.round(40 + sat * 50)}% ${Math.round(30 + lum * 40)}%)`);

  let genre = "pop";
  let mood = "Happy";
  if (lum < 0.25) {
    genre = colourful && domHue >= 240 && domHue < 330 ? "synthwave" : contrast > 0.2 ? "trap" : "cinematic";
    mood = contrast > 0.2 ? "Dark" : "Mysterious";
  } else if (sat < 0.15) {
    genre = lum > 0.6 ? "piano" : "lofi";
    mood = lum > 0.6 ? "Calm" : "Sad";
  } else if (domHue >= 180 && domHue < 260) {
    genre = lum > 0.55 ? "ambient" : "lofi";
    mood = lum > 0.55 ? "Dreamy" : "Chill";
  } else if (domHue >= 260 && domHue < 330) {
    genre = "synthwave";
    mood = "Dreamy";
  } else if (domHue >= 70 && domHue < 180) {
    genre = sat > 0.45 ? "afrobeats" : "folk";
    mood = "Hopeful";
  } else {
    // Reds, oranges, yellows.
    genre = sat > 0.5 && contrast > 0.18 ? "edm" : warm > 0.15 ? "rnb" : "pop";
    mood = sat > 0.5 ? "Energetic" : "Romantic";
  }
  const energy = Math.max(1, Math.min(5, Math.round(1 + sat * 3 + contrast * 4 + (lum > 0.5 ? 0.5 : 0))));
  const mode = mood === "Dark" || mood === "Sad" || mood === "Mysterious" || (mood === "Chill" && lum < 0.45) ? "minor" : "major";
  const bpm = Math.round(68 + energy * 14 + (warm > 0 ? 4 : 0));
  const seed = hash >>> 0;
  const brightWord = lum > 0.6 ? "bright" : lum < 0.3 ? "dark" : "soft";
  const satWord = sat > 0.5 ? "vivid" : sat < 0.15 ? "muted" : "gentle";
  return {
    genre,
    mood,
    bpm,
    mode,
    energy,
    key: KEYS[seed % 12],
    seed,
    palette,
    reading: `A ${brightWord}, ${satWord} picture${colourful ? ` leaning ${hueName(domHue)}` : ""} with ${contrast > 0.22 ? "strong" : contrast > 0.12 ? "moderate" : "low"} contrast.`,
  };
}

function hueName(h: number) {
  if (h < 30 || h >= 330) return "red";
  if (h < 60) return "orange";
  if (h < 90) return "yellow";
  if (h < 160) return "green";
  if (h < 200) return "teal";
  if (h < 260) return "blue";
  return "violet";
}
