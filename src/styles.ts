// CSS generated from parula.ts and dither.ts, served at /css/calendar.css.
// Generating it keeps the colour table and the dither levels in one place.

import { RANGE_COLUMN_MAX_DAYS } from "./config";
import { DITHER_MAX_LEVEL, DITHER_MIN_LEVEL, DOT_PX, ditherLevelForStep, ditherSvg } from "./dither";
import { LEVELS } from "./levels";
import { NOW_STEPS } from "./calendar";
import { THEME_PALETTES, type Theme, toneFor } from "./parula";

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
  // Per-theme variables for each step: its colour, its past colour, and its dots.
  const vars = (theme: Theme) => {
    const { colours, past } = THEME_PALETTES[theme];
    return colours
      .map((c, i) => {
        const level = ditherLevelForStep(i);
        const dots = level === 0 ? "none" : `url(${ditherAssetPath(level, toneFor(c))})`;
        return `--cell-${i}:${c};--cell-past-${i}:${past[i]};--dots-${i}:${dots}`;
      })
      .join(";");
  };
  // Same structure as tokens.css: dark by default, light only when chosen.
  out.push(`:root{${vars("dark")}}`);
  out.push(`:root[data-theme="light"]{${vars("light")}}`);
  const tile = DOT_PX * 4;
  for (let i = 0; i < LEVELS; i++) {
    out.push(`.p${i}{background-color:var(--cell-${i});background-image:var(--dots-${i});background-size:${tile}px ${tile}px}`);
    // Past time: the same step, less saturated (the veil on top is in app.css).
    out.push(`.past.p${i}{background-color:var(--cell-past-${i})}`);
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
