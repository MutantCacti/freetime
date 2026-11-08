// Ordered (Bayer 4×4) dither. Each cell's pattern depends only on its own
// busy fraction, so a pattern never changes because a neighbour changed.

import { LEVELS, busyStep } from "./levels";

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

/**
 * Where a step sits on the ramp, 0 (free) to 1 (fully busy): an S-curve
 * (smoothstep, 3t² − 2t³ with t = step / (LEVELS − 1)) rather than a straight
 * line, so more steps read close to the ends, near free and near busy, and
 * the middle is compressed. The colour and the dots both follow it.
 */
export function stepPosition(step: number): number {
  const t = Math.min(1, Math.max(0, step / (LEVELS - 1)));
  return t * t * (3 - 2 * t);
}

/**
 * Dither level for a step: round(MIN + stepPosition(step) × (MAX − MIN)),
 * at least MIN + 1 for any busy step (busy time always has dots) and at most
 * MAX − 1 short of fully busy (only a full slot gets the full pattern).
 * There are more steps (17) than levels (13), so some neighbouring steps
 * share a level and differ by colour alone; levels never go down.
 * With 0 and 12: 0, 1, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 11, 11, 12.
 */
export function ditherLevelForStep(step: number): number {
  const last = LEVELS - 1;
  const level = Math.round(DITHER_MIN_LEVEL + stepPosition(step) * (DITHER_MAX_LEVEL - DITHER_MIN_LEVEL));
  if (step <= 0) return DITHER_MIN_LEVEL;
  if (step >= last) return DITHER_MAX_LEVEL;
  return Math.min(DITHER_MAX_LEVEL - 1, Math.max(DITHER_MIN_LEVEL + 1, level));
}

/** Dither level for a busy fraction, through its step. */
export function ditherLevel(fraction: number): number {
  return ditherLevelForStep(busyStep(fraction));
}

/** Pixel size of one Bayer cell in the pattern tile. */
export const DOT_PX = 2;
export const DOT_OPACITY = 0.42;

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
 * The class that colours and dithers a cell: `p<step>`. The generated CSS
 * gives each step its colour and dot pattern for the current theme. Every
 * view uses this one function, so a fraction always looks the same.
 */
export function cellClasses(fraction: number): string {
  return stepClasses(busyStep(fraction));
}

export function stepClasses(step: number): string {
  return `p${step}`;
}
