// MATLAB's parula colormap as a fixed 64-entry lookup table, low to high,
// and the toned-down palette the calendar actually uses, derived from it at
// start-up. Users may pick another perceptually uniform map for their
// profile (PALETTE_NAMES); every map goes through the same toning, so
// lightness is monotonic and the dither and contrast rules hold for each. This file and public/css/tokens.css are the only places hex
// colours may appear (test/colour-rule.test.ts enforces it).

import { DOT_OPACITY, ditherLevelForStep, stepPosition } from "./dither";
import { LEVELS } from "./levels";

/** The original parula(64) table, the default map. */
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

/** matplotlib's viridis, resampled to 64 entries. */
export const VIRIDIS_SOURCE: readonly string[] = [
  "#440154", "#46075a", "#470d60", "#471365", "#48186a", "#481d6f", "#482374", "#482878",
  "#472d7b", "#46327e", "#453781", "#443b84", "#424086", "#404588", "#3e4989", "#3d4e8a",
  "#3a538b", "#38588c", "#365c8d", "#34608d", "#32648e", "#31688e", "#2f6c8e", "#2d708e",
  "#2c738e", "#2a778e", "#297b8e", "#277f8e", "#26828e", "#24868e", "#238a8d", "#218e8d",
  "#20928c", "#1f968b", "#1f9a8a", "#1f9e89", "#1fa187", "#21a585", "#23a983", "#26ad81",
  "#2ab07f", "#2fb47c", "#35b779", "#3bbb75", "#42be71", "#4ac16d", "#52c569", "#5ac864",
  "#65cb5e", "#6ece58", "#77d153", "#81d34d", "#8bd646", "#95d840", "#a0da39", "#aadc32",
  "#b5de2b", "#c0df25", "#cae11f", "#d5e21a", "#dfe318", "#eae51a", "#f4e61e", "#fde725",
];

/** matplotlib's cividis, resampled to 64 entries. */
export const CIVIDIS_SOURCE: readonly string[] = [
  "#00224e", "#002554", "#00285b", "#002b62", "#002e6a", "#003070", "#053371", "#123570",
  "#1a386f", "#213b6e", "#273e6e", "#2d416d", "#32436d", "#36466c", "#3b496c", "#3f4c6c",
  "#444f6c", "#48526c", "#4c556c", "#50576c", "#545a6d", "#575d6d", "#5b606e", "#5e636f",
  "#62656f", "#656870", "#696b71", "#6c6e72", "#707173", "#737475", "#777776", "#7a7a78",
  "#7e7d78", "#828079", "#868379", "#8a8678", "#8e8978", "#928c78", "#958f77", "#999277",
  "#9d9576", "#a19975", "#a59c74", "#a99f73", "#ada272", "#b1a570", "#b6a96f", "#baac6d",
  "#bfb06b", "#c3b369", "#c7b767", "#ccba64", "#d0be62", "#d4c15f", "#d9c55c", "#ddc858",
  "#e1cc55", "#e6d051", "#ead34c", "#efd748", "#f3db42", "#f8df3c", "#fde334", "#fee838",
];

/** matplotlib's magma, resampled to 64 entries. */
export const MAGMA_SOURCE: readonly string[] = [
  "#000004", "#020109", "#030312", "#06051a", "#0a0822", "#0e0b2b", "#130d34", "#180f3d",
  "#1d1147", "#221150", "#29115a", "#2f1163", "#36106b", "#3d0f71", "#440f76", "#4a1079",
  "#52137c", "#59157e", "#5f187f", "#651a80", "#6b1d81", "#721f81", "#782281", "#7e2482",
  "#842681", "#8b2981", "#912b81", "#982d80", "#9e2f7f", "#a5317e", "#ab337c", "#b2357b",
  "#ba3878", "#c03a76", "#c73d73", "#cd4071", "#d3436e", "#d9466b", "#df4a68", "#e44f64",
  "#e95462", "#ed5a5f", "#f1605d", "#f4675c", "#f66e5c", "#f8765c", "#fa7d5e", "#fb8560",
  "#fc8e64", "#fd9668", "#fe9d6c", "#fea571", "#feac76", "#feb47b", "#febb81", "#fec287",
  "#feca8d", "#fed194", "#fed89a", "#fde0a1", "#fde7a9", "#fceeb0", "#fcf6b8", "#fcfdbf",
];

/** matplotlib's plasma, resampled to 64 entries. */
export const PLASMA_SOURCE: readonly string[] = [
  "#0d0887", "#19068c", "#220690", "#2a0593", "#310597", "#38049a", "#3f049c", "#46039f",
  "#4c02a1", "#5302a3", "#5901a5", "#6001a6", "#6600a7", "#6c00a8", "#7201a8", "#7801a8",
  "#8004a8", "#8606a6", "#8b0aa5", "#910ea3", "#9613a1", "#9c179e", "#a11b9b", "#a62098",
  "#ab2494", "#b02991", "#b42e8d", "#b83289", "#bd3786", "#c13b82", "#c5407e", "#c9447a",
  "#cd4a76", "#d14e72", "#d5536f", "#d8576b", "#db5c68", "#de6164", "#e26561", "#e56a5d",
  "#e76f5a", "#ea7457", "#ed7953", "#ef7e50", "#f1834c", "#f48849", "#f68d45", "#f79342",
  "#f99a3e", "#fb9f3a", "#fca537", "#fdab33", "#fdb130", "#feb72d", "#febd2a", "#fdc328",
  "#fdca26", "#fcd025", "#fbd724", "#f9dd25", "#f7e425", "#f5eb27", "#f2f227", "#f0f921",
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

export function hexToRgb(hex: string): RGB {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as RGB;
}

export function rgbToHex(rgb: RGB): string {
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
export function fitGamut([L, C, h]: LCH): RGB {
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

/** Chroma scale for time that has passed: the same colours, less saturated. */
export const PAST_CHROMA = 0.5;

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Whether dither dots on a colour are dark ("k") or light ("w"): whichever
 * contrasts more with the colour underneath.
 */
export function toneFor(hex: string): "k" | "w" {
  const l = luminance(hex);
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? "k" : "w";
}

export type Theme = "light" | "dark";
export type Tone = "k" | "w";

/** One theme's ramp: each step's colour, its past colour, and its dot tone. */
export interface StepPalette {
  colours: readonly string[];
  past: readonly string[];
  tones: readonly Tone[];
}
type ThemePalettes = Record<Theme, StepPalette>;

/**
 * What a cell looks like from arm's length: its colour with its dots blended
 * in, in linear light (dots cover level / 16 of the cell at DOT_OPACITY).
 */
export function averagedCell(hex: string, tone: Tone, level: number): RGB {
  const cover = (level / 16) * DOT_OPACITY;
  const dot = tone === "k" ? 0 : 1;
  return hexToRgb(hex).map((c) => toGamma(toLinear(c) * (1 - cover) + dot * cover)) as RGB;
}

/** Each step's averaged cell must read at least this much busier (OKLab L) than the one before. */
export const MIN_LIGHTNESS_STEP = 0.001;

/** Dots must differ from the colour under them by at least this (WCAG ratio). */
export const MIN_DOT_CONTRAST = 1.4;

/** WCAG contrast between a colour and one dot on it (dot blended at DOT_OPACITY in sRGB, as drawn). */
export function dotContrast(hex: string, tone: Tone): number {
  const base = hexToRgb(hex);
  const d = tone === "k" ? 0 : 1;
  const dot = rgbToHex(base.map((c) => c * (1 - DOT_OPACITY) + d * DOT_OPACITY) as RGB);
  const [x, y] = [luminance(hex), luminance(dot)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/**
 * A theme's ramp from the map's colours, free to busy. Step i is meant to
 * read at stepPosition(i) between free and fully busy, but the dots change
 * how light a cell looks (light dots lift it, dark dots sink it), and where
 * the dot tone flips the cell would jump the wrong way. So each step's
 * colour keeps its hue and chroma and has its lightness solved so that the
 * averaged cell (colour plus dots) lands on target: the free cell's
 * lightness moved towards the fully busy cell's by stepPosition(i). The dot
 * tone is whichever can reach the target with the clearer dots.
 */
function solveRamp(sampled: readonly string[], busyIsLighter: boolean): StepPalette {
  const last = LEVELS - 1;
  const okL = (rgb: RGB) => rgbToOklch(rgb)[0];
  // Fully busy: of the two dot tones, whichever leaves the cell furthest towards busy with
  // its dots still showing. If the dots don't show on the map's end colour, that colour's
  // lightness is moved (away from busy) just until they do.
  const levelN = ditherLevelForStep(last);
  const [Ln, Cn, hn] = rgbToOklch(hexToRgb(sampled[last]!));
  const ends = (["k", "w"] as const).map((tone) => {
    let hex = sampled[last]!;
    if (dotContrast(hex, tone) < MIN_DOT_CONTRAST) {
      // Dark dots need a lighter colour under them, light dots a darker one.
      const away = tone === "k" ? 1 : -1;
      let lo = 0, hi = tone === "k" ? 1 - Ln : Ln;
      for (let k = 0; k < 32; k++) {
        const mid = (lo + hi) / 2;
        if (dotContrast(rgbToHex(fitGamut([Ln + away * mid, Cn, hn])), tone) >= MIN_DOT_CONTRAST) hi = mid;
        else lo = mid;
      }
      hex = rgbToHex(fitGamut([Ln + away * hi, Cn, hn]));
    }
    return { hex, tone, L: okL(averagedCell(hex, tone, levelN)) };
  });
  const end = ends.sort((a, b) => (busyIsLighter ? b.L - a.L : a.L - b.L))[0]!;
  const toneN = end.tone;
  const from = okL(hexToRgb(sampled[0]!));
  const to = end.L;
  const colours: string[] = [sampled[0]!];
  const tones: Tone[] = [toneFor(sampled[0]!)]; // no dots at step 0; the tone is unused
  for (let i = 1; i < last; i++) {
    const level = ditherLevelForStep(i);
    const target = from + (to - from) * stepPosition(i);
    const [, C, h] = rgbToOklch(hexToRgb(sampled[i]!));
    const options: { hex: string; tone: Tone; contrast: number }[] = [];
    for (const tone of ["k", "w"] as const) {
      let lo = 0, hi = 1;
      for (let k = 0; k < 32; k++) {
        const mid = (lo + hi) / 2;
        if (okL(averagedCell(rgbToHex(fitGamut([mid, C, h])), tone, level)) < target) lo = mid;
        else hi = mid;
      }
      const hex = rgbToHex(fitGamut([(lo + hi) / 2, C, h]));
      if (Math.abs(okL(averagedCell(hex, tone, level)) - target) > 0.004) continue; // this tone can't reach it
      options.push({ hex, tone, contrast: dotContrast(hex, tone) });
    }
    options.sort((a, b) => b.contrast - a.contrast);
    const best = options[0] ?? { hex: sampled[i]!, tone: toneFor(sampled[i]!), contrast: 0 };
    colours.push(best.hex);
    tones.push(best.tone);
  }
  colours.push(end.hex);
  tones.push(toneN);
  // With many steps the targets near the ends are only a few thousandths apart, about the size of
  // one 8-bit rounding of a colour. So walk the ramp and, where a step doesn't read busier than the
  // one before, move its lightness towards busy, a little at a time, until it does.
  const dir = busyIsLighter ? 1 : -1;
  const avg = (i: number) => okL(averagedCell(colours[i]!, tones[i]!, ditherLevelForStep(i)));
  for (let i = 1; i < last; i++) {
    const [L0, C, h] = rgbToOklch(hexToRgb(colours[i]!));
    for (let k = 1; k <= 200 && (avg(i) - avg(i - 1)) * dir < MIN_LIGHTNESS_STEP; k++) {
      colours[i] = rgbToHex(fitGamut([L0 + dir * k * 0.001, C, h]));
    }
  }
  const past = colours.map((hex) => {
    const [L, C, h] = rgbToOklch(hexToRgb(hex));
    return rgbToHex(fitGamut([L, C * PAST_CHROMA, h]));
  });
  return { colours, past, tones };
}

/**
 * A map's ramps for both themes. Dark: free is the map's dark end, busy its
 * light end. Light: the map is inverted, so busy is dark against a white
 * page. Each step's colour is sampled from the toned table at
 * stepPosition(step), then solveRamp sets its lightness for its dots.
 */
export function themePalettesFor(source: readonly string[], chroma = PALETTE_CHROMA): ThemePalettes {
  const toned = toneTable(source, chroma);
  const sampled = Array.from({ length: LEVELS }, (_, step) => toned[Math.round(stepPosition(step) * (toned.length - 1))]!);
  return { dark: solveRamp(sampled, true), light: solveRamp([...sampled].reverse(), false) };
}

/** Parula's ramps: the main site's, and the default. */
export const THEME_PALETTES: ThemePalettes = themePalettesFor(PARULA_SOURCE);
/** Parula's dark-theme colours, free to busy. */
export const PALETTE: readonly string[] = THEME_PALETTES.dark.colours;
/** Parula's dark-theme past colours: each step with chroma scaled by PAST_CHROMA. */
export const PALETTE_PAST: readonly string[] = THEME_PALETTES.dark.past;

/** Dot tone for a step of parula's dark-theme ramp. */
export function dotTone(step: number): Tone {
  return THEME_PALETTES.dark.tones[step]!;
}

// ---------------------------------------------------------------- presets

/** The colour maps a user may choose; parula is the default (and the main site's). */
export const PALETTE_NAMES = ["parula", "viridis", "cividis", "magma", "plasma"] as const;
export type PaletteName = (typeof PALETTE_NAMES)[number];
export const DEFAULT_PALETTE: PaletteName = "parula";

export function isPaletteName(v: unknown): v is PaletteName {
  return typeof v === "string" && (PALETTE_NAMES as readonly string[]).includes(v);
}

export const PALETTE_SOURCES: Record<PaletteName, readonly string[]> = {
  parula: PARULA_SOURCE,
  viridis: VIRIDIS_SOURCE,
  cividis: CIVIDIS_SOURCE,
  magma: MAGMA_SOURCE,
  plasma: PLASMA_SOURCE,
};

/** Every preset's colours in each theme. PALETTES.parula is THEME_PALETTES. */
export const PALETTES: Record<PaletteName, ThemePalettes> = Object.fromEntries(
  PALETTE_NAMES.map((name) => [name, name === "parula" ? THEME_PALETTES : themePalettesFor(PALETTE_SOURCES[name])]),
) as Record<PaletteName, ThemePalettes>;
