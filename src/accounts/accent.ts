// A profile's accent colour, picked from its picture (ACCOUNTS-SPEC.md §3).
//
// 1. Blur down to one pixel. Start from the stored picture's grid (the centre
//    square, at most 128 × 128, linear light, alpha-premultiplied). Each pass
//    halves the size (rounding up) and samples the dual-Kawase kernels, down
//    and up overlaid, at a per-pass offset following Intel's Kawase sequence
//    0, 1, 2, 2, 3, then 3, 4, 4, 5, 5, … as needed. Output pixel (x, y) sits at
//    source position c = (2x + 1, 2y + 1) (texel corners at integers); with
//    d = offset + 0.5 source texels, the taps, each a bilinear sample with
//    edges clamped, are:
//      down kernel (÷ 8):  c × 4, and c + (±d, ±d) × 1 each
//      up kernel (÷ 12):   c + (±2d, 0), c + (0, ±2d) × 1 each, and c + (±d, ±d) × 2 each
//    overlaid as the average of the two normalised kernels, which comes to
//      centre 1/4, the four diagonals 7/48 each, the four axial taps 1/24 each
//    (the diagonals of both kernels fall on the same points, so 9 distinct
//    samples). Passes repeat until the image is 1 × 1: 7 passes from 128.
// 2. That pixel is the colour (alpha-weighted, so transparent areas don't
//    count). A fully transparent picture has no accent.
// 3. Raise its HSL saturation (saturate), since an average of a whole
//    picture is usually greyer than the picture looks.
// 4. Clamp it for its uses (the profile card's edge, its circle and its
//    primary buttons), in both themes: keep the hue, cap chroma at
//    ACCENT_MAX_CHROMA and to the sRGB gamut, and move OKLCH lightness until
//    relative luminance is within ACCENT_LUMINANCE. In that band the accent is
//    at least 3:1 against the page and surface colours of both themes, and
//    either dark or light text on it is at least 4.5:1 (accentText picks).
//    That colour is what's stored; it's the source hue for step 5.
// 5. Snap it to the profile's colour map, once per theme (snapAccent). Not
//    to the calendar's six cells, or many pictures would land on the same
//    few colours: to the map itself, its 64-colour toned table (mapSamples).
//    Of the colours past the free end (FREE_END, busy step 1's place on the
//    ramp) that have a hue (OKLCH chroma at least MAP_HUE_MIN_CHROMA), the
//    one nearest the stored accent's hue, a little in favour of the more
//    colourful; for a grey accent (chroma under GREY_ACCENT_CHROMA), or no
//    picture, the hued colour nearest the middle of the map. Then its
//    lightness is moved, hue and chroma kept, only as far as it takes to be
//    3:1 against that theme's page and surface (THEME_ACCENT_LUMINANCE).
//    Black or white text on any colour is at least 4.58:1 one way or the
//    other, so accentText still holds.

import { PALETTE_SOURCES, type PaletteName, type Theme, fitGamut, hexToRgb, luminance, rgbToHex, rgbToOklch, toneTable } from "../parula";
import { stepPosition } from "../dither";
import type { Grid } from "./image-decode";

/** Intel's Kawase offsets, continued: pass i uses KAWASE_OFFSETS[i] (then on, each offset is used for two passes). */
export const KAWASE_OFFSETS = [0, 1, 2, 2, 3] as const;
export function kawaseOffset(pass: number): number {
  return pass < KAWASE_OFFSETS.length ? KAWASE_OFFSETS[pass]! : 2 + Math.floor((pass - 2) / 2);
}

/** Tap weights after overlaying the normalised down (÷8) and up (÷12) kernels. */
export const KAWASE_WEIGHTS = { centre: 1 / 4, diagonal: 7 / 48, axial: 1 / 24 } as const;

/** Relative luminance band for the clamped accent. */
export const ACCENT_LUMINANCE = { min: 0.14, max: 0.26 } as const;
export const ACCENT_MAX_CHROMA = 0.2;

/** Four channels (premultiplied linear R, G, B and alpha), row-major. */
interface Image4 {
  w: number;
  h: number;
  px: Float64Array;
}

export function gridImage(grid: Grid): Image4 {
  const n = grid.size * grid.size;
  const px = new Float64Array(n * 4);
  for (let i = 0; i < n; i++) {
    const count = grid.n[i]! || 1;
    px[i * 4] = grid.r[i]! / count;
    px[i * 4 + 1] = grid.g[i]! / count;
    px[i * 4 + 2] = grid.b[i]! / count;
    px[i * 4 + 3] = grid.a[i]! / count;
  }
  return { w: grid.size, h: grid.size, px };
}

/** Bilinear sample at a source position (texel corners at integers), edges clamped, into out[0..3]. */
function sample(img: Image4, x: number, y: number, out: Float64Array, weight: number): void {
  const fx = Math.min(Math.max(x - 0.5, 0), img.w - 1);
  const fy = Math.min(Math.max(y - 0.5, 0), img.h - 1);
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, img.w - 1), y1 = Math.min(y0 + 1, img.h - 1);
  const tx = fx - x0, ty = fy - y0;
  const w00 = (1 - tx) * (1 - ty) * weight, w10 = tx * (1 - ty) * weight, w01 = (1 - tx) * ty * weight, w11 = tx * ty * weight;
  const p = img.px;
  const i00 = (y0 * img.w + x0) * 4, i10 = (y0 * img.w + x1) * 4, i01 = (y1 * img.w + x0) * 4, i11 = (y1 * img.w + x1) * 4;
  for (let k = 0; k < 4; k++) out[k]! += p[i00 + k]! * w00 + p[i10 + k]! * w10 + p[i01 + k]! * w01 + p[i11 + k]! * w11;
}

/** One pass: half the size (rounded up), the overlaid kernels at this pass's offset. */
export function kawasePass(img: Image4, pass: number): Image4 {
  const w = Math.max(1, Math.ceil(img.w / 2)), h = Math.max(1, Math.ceil(img.h / 2));
  const px = new Float64Array(w * h * 4);
  const d = kawaseOffset(pass) + 0.5;
  const acc = new Float64Array(4);
  const { centre, diagonal, axial } = KAWASE_WEIGHTS;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      acc.fill(0);
      const cx = 2 * x + 1, cy = 2 * y + 1;
      sample(img, cx, cy, acc, centre);
      sample(img, cx - d, cy - d, acc, diagonal);
      sample(img, cx + d, cy - d, acc, diagonal);
      sample(img, cx - d, cy + d, acc, diagonal);
      sample(img, cx + d, cy + d, acc, diagonal);
      sample(img, cx - 2 * d, cy, acc, axial);
      sample(img, cx + 2 * d, cy, acc, axial);
      sample(img, cx, cy - 2 * d, acc, axial);
      sample(img, cx, cy + 2 * d, acc, axial);
      px.set(acc, (y * w + x) * 4);
    }
  }
  return { w, h, px };
}

/** Passes until one pixel is left; returns that pixel and the number of passes. */
export function blurToPixel(img: Image4): { px: Float64Array; passes: number } {
  let passes = 0;
  while (img.w > 1 || img.h > 1) img = kawasePass(img, passes++);
  return { px: img.px.subarray(0, 4), passes };
}

const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** The picture's colour before clamping: sRGB 0–1, or null for a fully transparent picture. */
export function pictureColour(grid: Grid): [number, number, number] | null {
  const { px } = blurToPixel(gridImage(grid));
  const alpha = px[3]!;
  if (alpha < 1e-3) return null;
  return [toGamma(px[0]! / alpha), toGamma(px[1]! / alpha), toGamma(px[2]! / alpha)];
}

/** Keep the hue; cap chroma; move lightness until luminance is inside ACCENT_LUMINANCE. Returns a hex colour. */
export function clampAccent(rgb: [number, number, number]): string {
  const [L0, C0, h] = rgbToOklch(rgb);
  const C = Math.min(C0, ACCENT_MAX_CHROMA);
  const lumAt = (L: number) => luminance(rgbToHex(fitGamut([L, C, h])));
  let L = L0;
  const y = lumAt(L);
  const target = y < ACCENT_LUMINANCE.min ? ACCENT_LUMINANCE.min + 0.005 : y > ACCENT_LUMINANCE.max ? ACCENT_LUMINANCE.max - 0.005 : null;
  if (target !== null) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (lumAt(mid) < target) lo = mid;
      else hi = mid;
    }
    L = (lo + hi) / 2;
  }
  return rgbToHex(fitGamut([L, C, h]));
}

/** HSL saturation boost: S' = S + (1 − S) × SATURATION_BOOST × ramp(S). */
export const SATURATION_BOOST = 0.42;
/** Below `grey` the colour is left neutral (no hue to speak of); the boost reaches full strength at `full`. */
export const SATURATION_RAMP = { grey: 0.03, full: 0.12 } as const;

/**
 * Blurring a whole picture to one pixel averages its colours, and colours
 * that cancel out (a teal background behind an orange shirt) come out
 * greyish. So the pixel is taken to HSL and its saturation raised towards 1
 * by SATURATION_BOOST, fading in from SATURATION_RAMP.grey to .full so that a
 * near-grey picture stays near grey instead of being given an invented hue.
 * Hue and HSL lightness are kept; the contrast clamp runs afterwards.
 */
export function saturate([r, g, b]: [number, number, number]): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-9) return [r, g, b];
  const s = d / (1 - Math.abs(2 * l - 1));
  const ramp = Math.min(1, Math.max(0, (s - SATURATION_RAMP.grey) / (SATURATION_RAMP.full - SATURATION_RAMP.grey)));
  if (ramp === 0) return [r, g, b];
  const s2 = Math.min(1, s + (1 - s) * SATURATION_BOOST * ramp);
  // Hue from the original channels, then back from HSL.
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  if (h < 0) h += 6;
  const c = (1 - Math.abs(2 * l - 1)) * s2;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return [r1 + m, g1 + m, b1 + m];
}

/** The accent for a picture's grid, or null: blurred to one pixel, saturated, clamped. */
export function accentOf(grid: Grid): string | null {
  const colour = pictureColour(grid);
  return colour ? clampAccent(saturate(colour)) : null;
}

/**
 * Text and icons on the accent: black or white, whichever contrasts more.
 * Inside the band one of them is always at least 4.5:1 (black from luminance
 * 0.175 up, white up to 0.183).
 */
export function accentText(hex: string): "dark" | "light" {
  const y = luminance(hex);
  return (y + 0.05) / 0.05 >= 1.05 / (y + 0.05) ? "dark" : "light";
}

/** An accent as stored: lower-case #rrggbb. */
export function isAccent(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-f]{6}$/.test(v);
}


// ---------------------------------------------------------------- snapped to the colour map

/** A stored accent with less OKLCH chroma than this counts as grey: no hue to match. */
export const GREY_ACCENT_CHROMA = 0.03;
/** Map colours with less chroma than this have no hue worth matching (cividis's greys). */
export const MAP_HUE_MIN_CHROMA = 0.04;
/** How much a map colour's chroma counts against hue distance (radians per unit of chroma). */
export const CHROMA_PREFERENCE = (40 * Math.PI) / 180;
/**
 * Luminance limits for the snapped accent, one side per theme: in the dark
 * theme at least `min` (3:1 against the dark page and surface), in the light
 * theme at most `max` (3:1 against white and the light surface). The tests
 * check them against tokens.css.
 */
export const THEME_ACCENT_LUMINANCE = { dark: { min: 0.14 }, light: { max: 0.26 } } as const;

/** Where on the map (0 free, 1 fully busy) a grey accent, or none, takes its colour: the middle. */
export const MID_POSITION = 0.5;
/**
 * The free end of the map that the accent never takes: everything short of
 * busy step 1's place on the ramp, so the accent never matches free cells.
 */
export const FREE_END = stepPosition(1);

const hueDistance = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** One colour of the map, at position t from free (0) to fully busy (1) in a theme. */
export interface MapSample {
  t: number;
  hex: string;
  C: number;
  h: number;
}

const samplesCache = new Map<PaletteName, MapSample[]>();

/**
 * The map itself, finely: its toned table (64 colours, the same both themes),
 * each placed by how far from free it is in the theme. The calendar's six
 * cells are sampled from this same table; the accent isn't limited to them,
 * so different pictures get different colours.
 */
export function mapSamples(palette: PaletteName, theme: Theme): MapSample[] {
  let base = samplesCache.get(palette);
  if (!base) {
    const toned = toneTable(PALETTE_SOURCES[palette]);
    base = toned.map((hex, i) => {
      const [, C, h] = rgbToOklch(hexToRgb(hex));
      return { t: i / (toned.length - 1), hex, C, h };
    });
    samplesCache.set(palette, base);
  }
  // Dark: free is the table's low end. Light: the map is inverted, so free is its high end.
  return theme === "dark" ? base : base.map((s) => ({ ...s, t: 1 - s.t })).reverse();
}

/**
 * The map colour an accent snaps to in a theme: of the samples past the free
 * end (FREE_END) with a hue worth matching (chroma at least
 * MAP_HUE_MIN_CHROMA), the one nearest the accent's hue, a little in favour
 * of the more colourful; for a grey accent or none, the hued sample nearest
 * the middle (MID_POSITION; the one nearer free on a tie), so a map with
 * greys in the middle (cividis) still gives a colour.
 */
export function snapSample(accent: string | null, palette: PaletteName, theme: Theme): MapSample {
  const all = mapSamples(palette, theme);
  const hued = all.filter((s) => s.t >= FREE_END - 1e-9 && s.C >= MAP_HUE_MIN_CHROMA);
  const source = accent ? rgbToOklch(hexToRgb(accent)) : null;
  const score =
    !source || source[1] < GREY_ACCENT_CHROMA
      ? (s: MapSample) => Math.abs(s.t - MID_POSITION) + s.t * 1e-6
      : (s: MapSample) => hueDistance(s.h, source[2]) - CHROMA_PREFERENCE * s.C;
  if (hued.length === 0) return all.reduce((best, s) => (Math.abs(s.t - MID_POSITION) < Math.abs(best.t - MID_POSITION) ? s : best));
  return hued.reduce((best, s) => (score(s) < score(best) ? s : best));
}

/**
 * The profile's accent in a theme: the map colour snapSample picks, with its
 * lightness moved (hue and chroma kept) just far enough to be 3:1 against
 * that theme's page and surface.
 */
export function snapAccent(accent: string | null, palette: PaletteName, theme: Theme): string {
  const cell = snapSample(accent, palette, theme).hex;
  const [L0, C, h] = rgbToOklch(hexToRgb(cell));
  const lumAt = (L: number) => luminance(rgbToHex(fitGamut([L, C, h])));
  const ok = (L: number) => (theme === "dark" ? lumAt(L) >= THEME_ACCENT_LUMINANCE.dark.min : lumAt(L) <= THEME_ACCENT_LUMINANCE.light.max);
  if (ok(L0)) return cell;
  // Lighter in the dark theme, darker in the light one: bisect between the colour and the far end.
  let [bad, good] = theme === "dark" ? [L0, 1] : [L0, 0];
  for (let i = 0; i < 30; i++) {
    const mid = (bad + good) / 2;
    if (ok(mid)) good = mid;
    else bad = mid;
  }
  return rgbToHex(fitGamut([good, C, h]));
}
