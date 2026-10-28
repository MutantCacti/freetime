// Ordered (Bayer 4×4) dither. Each cell's pattern depends only on its own
// busy fraction, so a pattern never changes because a neighbour changed.

import { dotTone, parulaIndex } from "./parula";

/** Dots at fraction 0 (free). */
export const DITHER_MIN_LEVEL = 0;
/** Dots at fraction 1 (fully busy): 12 of 16 cells, 75% coverage, never solid. */
export const DITHER_MAX_LEVEL = 12;

export function assertDitherConstants(min: number, max: number): void {
  if (!Number.isInteger(min) || !Number.isInteger(max) || !(0 <= min && min < max && max <= 15)) {
    throw new Error(`Invalid dither constants: need 0 <= MIN < MAX <= 15, got MIN=${min}, MAX=${max}`);
  }
}

// Validated at start-up, so a later edit can't make busy cells solid.
assertDitherConstants(DITHER_MIN_LEVEL, DITHER_MAX_LEVEL);

export const BAYER_4X4: readonly (readonly number[])[] = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

export function ditherLevel(fraction: number): number {
  const f = Math.min(1, Math.max(0, fraction));
  return Math.round(DITHER_MIN_LEVEL + f * (DITHER_MAX_LEVEL - DITHER_MIN_LEVEL));
}

/** Pixel size of one Bayer cell in the pattern tile. */
export const DOT_PX = 2;
const DOT_OPACITY = 0.42;

/** The repeating 8×8 px SVG tile for a level. Level n fills n of 16 cells. */
export function ditherSvg(level: number, tone: "k" | "w"): string {
  const fill = tone === "k" ? "black" : "white";
  const rects: string[] = [];
  BAYER_4X4.forEach((row, y) =>
    row.forEach((threshold, x) => {
      if (threshold < level) {
        rects.push(`<rect x="${x * DOT_PX}" y="${y * DOT_PX}" width="${DOT_PX}" height="${DOT_PX}"/>`);
      }
    }),
  );
  const size = DOT_PX * 4;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><g fill="${fill}" fill-opacity="${DOT_OPACITY}">${rects.join("")}</g></svg>`;
}

/**
 * The classes that colour and dither a cell. Every view uses this one
 * function, so a fraction always looks the same.
 */
export function cellClasses(fraction: number): string {
  const p = parulaIndex(fraction);
  const level = ditherLevel(fraction);
  return level === 0 ? `p${p}` : `p${p} d${level}${dotTone(p)}`;
}
