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
// 3. Clamp it for its uses (the profile card's edge, its circle and its
//    primary buttons), in both themes: keep the hue, cap chroma at
//    ACCENT_MAX_CHROMA and to the sRGB gamut, and move OKLCH lightness until
//    relative luminance is within ACCENT_LUMINANCE. In that band the accent is
//    at least 3:1 against the page and surface colours of both themes, and
//    either dark or light text on it is at least 4.5:1 (accentText picks).

import { fitGamut, luminance, rgbToHex, rgbToOklch } from "../parula";
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

/** The accent for a picture's grid, or null. */
export function accentOf(grid: Grid): string | null {
  const colour = pictureColour(grid);
  return colour ? clampAccent(colour) : null;
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

