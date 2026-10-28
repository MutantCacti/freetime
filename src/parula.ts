// MATLAB's parula colormap as a fixed 64-entry lookup table, low to high,
// and the toned-down palette the calendar actually uses, derived from it at
// start-up. This file and public/css/tokens.css are the only places hex
// colours may appear (test/colour-rule.test.ts enforces it).

import { LEVELS } from "./levels";

/** The original parula(64) table, kept for reference. */
export const PARULA_SOURCE: readonly string[] = [
  "#352a87", "#363093", "#3637a0", "#353dad", "#3243ba", "#2c4ac7", "#2053d4", "#0f5cdd",
  "#0363e1", "#0268e1", "#046de0", "#0871de", "#0d75dc", "#1079da", "#127dd8", "#1481d6",
  "#1485d4", "#1389d3", "#108ed2", "#0c93d2", "#0998d1", "#079ccf", "#06a0cd", "#06a4ca",
  "#06a7c6", "#07a9c2", "#0aacbe", "#0faeb9", "#15b1b4", "#1db3af", "#25b5a9", "#2eb7a4",
  "#38b99e", "#42bb98", "#4dbc92", "#59bd8c", "#65be86", "#71bf80", "#7cbf7b", "#87bf77",
  "#92bf73", "#9cbf6f", "#a5be6b", "#aebe67", "#b7bd64", "#c0bc60", "#c8bc5d", "#d1bb59",
  "#d9ba56", "#e1b952", "#e9b94e", "#f1b94a", "#f8bb44", "#fdbe3d", "#ffc337", "#fec832",
  "#fcce2e", "#fad32a", "#f7d826", "#f5de21", "#f5e41d", "#f5eb18", "#f6f313", "#f9fb0e",
];

/** Chroma scale applied in OKLCH: < 1 makes the palette less saturated. */
export const PALETTE_CHROMA = 0.85;
/** The source table's lightness range is mapped linearly onto this range (OKLCH L, 0–1). */
export const PALETTE_L_MIN = 0.36;
export const PALETTE_L_MAX = 0.9;

// ---------------------------------------------------------------- sRGB <-> OKLCH

type RGB = [number, number, number];
type LCH = [number, number, number];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function hexToRgb(hex: string): RGB {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as RGB;
}

function rgbToHex(rgb: RGB): string {
  return "#" + rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0")).join("");
}

export function rgbToOklch([r, g, b]: RGB): LCH {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

/** OKLCH to sRGB (0–1), unclamped. */
export function oklchToRgb([L, C, h]: LCH): RGB {
  const A = C * Math.cos(h);
  const B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

const inGamut = (rgb: RGB) => rgb.every((c) => c >= -1e-6 && c <= 1 + 1e-6);

/** Keep lightness and hue; reduce chroma until the colour fits in sRGB. */
function fitGamut([L, C, h]: LCH): RGB {
  let rgb = oklchToRgb([L, C, h]);
  if (inGamut(rgb)) return rgb;
  let lo = 0;
  let hi = C;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToRgb([L, mid, h]))) lo = mid;
    else hi = mid;
  }
  rgb = oklchToRgb([L, lo, h]);
  return rgb;
}

/** The source table toned down: same hue path, chroma scaled, lightness compressed. */
export function toneTable(source: readonly string[], chroma = PALETTE_CHROMA, lMin = PALETTE_L_MIN, lMax = PALETTE_L_MAX): string[] {
  const lch = source.map((hex) => rgbToOklch(hexToRgb(hex)));
  const ls = lch.map(([L]) => L);
  const srcMin = Math.min(...ls);
  const srcMax = Math.max(...ls);
  return lch.map(([L, C, h]) => {
    const t = (L - srcMin) / (srcMax - srcMin);
    return rgbToHex(fitGamut([lMin + t * (lMax - lMin), C * chroma, h]));
  });
}

/** The toned 64-entry table, generated at start-up. */
export const PARULA_TONED: readonly string[] = toneTable(PARULA_SOURCE);

/** The calendar's palette: the toned table sampled at the LEVELS steps, low to high. */
export const PALETTE: readonly string[] = Array.from(
  { length: LEVELS },
  (_, step) => PARULA_TONED[Math.round((step / (LEVELS - 1)) * (PARULA_TONED.length - 1))]!,
);

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Whether dither dots on a palette step are dark ("k") or light ("w"):
 * whichever contrasts more with the colour underneath. Same in both themes.
 */
export function dotTone(step: number): "k" | "w" {
  const l = luminance(PALETTE[step]!);
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? "k" : "w";
}
