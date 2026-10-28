// CSS generated from parula.ts and dither.ts, served at /css/calendar.css.
// Generating it keeps the colour table and the dither levels in one place.

import { RANGE_COLUMN_MAX_DAYS } from "./config";
import { DITHER_MAX_LEVEL, DITHER_MIN_LEVEL, DOT_PX, ditherSvg } from "./dither";
import { NOW_STEPS } from "./calendar";
import { PALETTE } from "./parula";

export function ditherAssetPath(level: number, tone: "k" | "w"): string {
  return `/img/dither/${level}${tone}.svg`;
}

/** The SVG for "/img/dither/<level><tone>.svg", or null if there is no such level. */
export function ditherAsset(name: string): string | null {
  const m = /^(\d{1,2})([kw])\.svg$/.exec(name);
  if (!m) return null;
  const level = Number(m[1]);
  if (level <= DITHER_MIN_LEVEL || level > DITHER_MAX_LEVEL) return null;
  return ditherSvg(level, m[2] as "k" | "w");
}

let css: string | null = null;

export function calendarCss(): string {
  if (css) return css;
  const out: string[] = [];
  out.push(`:root{${PALETTE.map((c, i) => `--palette-${i}:${c}`).join(";")}}`);
  PALETTE.forEach((_, i) => out.push(`.p${i}{background-color:var(--palette-${i})}`));
  const tile = DOT_PX * 4;
  for (let level = DITHER_MIN_LEVEL + 1; level <= DITHER_MAX_LEVEL; level++) {
    for (const tone of ["k", "w"] as const) {
      out.push(`.d${level}${tone}{background-image:url(${ditherAssetPath(level, tone)});background-size:${tile}px ${tile}px}`);
    }
  }
  for (let step = 0; step < NOW_STEPS; step++) {
    const pct = ((step / NOW_STEPS) * 100).toFixed(3);
    out.push(`.now-line.m${step}{top:${pct}%}`);
    // The slot holding now: its past part is greyed, up to the line.
    out.push(`.slot.split.m${step}::after{height:${pct}%}`);
  }
  for (let n = 1; n <= RANGE_COLUMN_MAX_DAYS; n++) {
    out.push(`.cols.n${n}{grid-template-columns:var(--time-col-w) repeat(${n},minmax(var(--day-col-min),1fr))}`);
  }
  css = out.join("\n") + "\n";
  return css;
}
