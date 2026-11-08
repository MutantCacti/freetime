import { describe, expect, it } from "vitest";
import tokens from "../public/css/tokens.css?raw";
import { PALETTE, PALETTES, PALETTE_NAMES, averagedCell, dotTone, rgbToOklch } from "../src/parula";
import { ditherLevelForStep } from "../src/dither";

const ALLOWED = new Set(["/public/css/tokens.css", "/src/parula.ts"]);
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9A-Za-z_-])/g;

const files = {
  // Text files only: binary fonts and PNGs can contain "#" followed by hex digits by chance.
  ...import.meta.glob(["/src/**/*.{ts,tsx}", "/public/**/*.{css,js,svg,txt,html}", "/test/**/*.{ts,ics}"], { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob(["/README.md", "/wrangler.toml", "/vitest.config.ts", "/tsconfig.json", "/package.json"], { query: "?raw", import: "default", eager: true }),
} as Record<string, string>;

describe("colour rule", () => {
  it("scans the repository", () => {
    expect(Object.keys(files)).toContain("/public/css/app.css");
    expect(Object.keys(files)).toContain("/public/js/app.js");
    expect(Object.keys(files)).toContain("/src/views/topbar.tsx");
    expect(files["/public/css/app.css"]!.length).toBeGreaterThan(100);
  });

  it("has no hex colours outside tokens.css and src/parula.ts", () => {
    const offenders: string[] = [];
    for (const [path, text] of Object.entries(files)) {
      if (ALLOWED.has(path)) continue;
      for (const m of text.matchAll(HEX)) offenders.push(`${path}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it("component CSS uses only var(--…) colours", () => {
    const css = files["/public/css/app.css"]!;
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch)\(/);
    expect(css).not.toMatch(/:\s*(black|white|red|blue|green|yellow|gray|grey)\b/);
  });
});

// ------------------------------------------------------------------ contrast

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!);
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

const raw = Object.fromEntries([...tokens.matchAll(/(--raw-[a-z0-9-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]));

function semanticSet(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--color-[a-z0-9-]+):\s*var\((--raw-[a-z0-9-]+)\)/g)) out[m[1]!] = raw[m[2]!]!;
  return out;
}

const darkChosen = semanticSet(tokens.slice(tokens.indexOf("semantic: dark (default)"), tokens.indexOf("semantic: light (chosen)")));
const light = semanticSet(tokens.slice(tokens.indexOf("semantic: light (chosen)")));

describe("contrast (WCAG AA) in both modes", () => {
  it("grid lines are the page colour in light mode and a dark neutral in dark mode", () => {
    expect(light["--color-grid"]).toBe(light["--color-bg"]);
    const dark = darkChosen["--color-grid"]!;
    expect(luminance(dark)).toBeLessThan(0.05);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(dark.slice(i, i + 2), 16));
    expect(Math.max(r!, g!, b!) - Math.min(r!, g!, b!)).toBeLessThan(16);
  });

  it("defines the same tokens for dark (default) and light (chosen)", () => {
    expect(Object.keys(light).length).toBeGreaterThan(10);
    expect(Object.keys(light).sort()).toEqual(Object.keys(darkChosen).sort());
  });

  it.each([
    ["light", light],
    ["dark", darkChosen],
  ])("%s", (_name, t) => {
    const text: [string, string][] = [
      ["--color-text", "--color-bg"],
      ["--color-text", "--color-surface"],
      ["--color-text", "--color-surface-2"],
      ["--color-text-muted", "--color-bg"],
      ["--color-text-muted", "--color-surface"],
      ["--color-link", "--color-bg"],
      ["--color-link", "--color-surface"],
      ["--color-error", "--color-surface"],
      ["--color-on-accent", "--color-link"],
    ];
    for (const [fg, bg] of text) expect(contrast(t[fg]!, t[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    // Non-text: focus ring, current-time line, severity borders and icons.
    for (const fg of ["--color-focus", "--color-now", "--color-warning", "--color-error"]) {
      expect(contrast(t[fg]!, t["--color-bg"]!), `${fg} on bg`).toBeGreaterThanOrEqual(3);
      expect(contrast(t[fg]!, t["--color-surface"]!), `${fg} on surface`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("dither in greyscale", () => {
  it.each(PALETTE_NAMES.flatMap((n) => [[n, "dark"], [n, "light"]] as const))("%s (%s): dots differ in lightness from the colour under them at every step", (name, theme) => {
    const OPACITY = 0.42;
    const { colours, past } = PALETTES[name][theme];
    for (const [kind, ramp] of [["now", colours], ["past", past]] as const) {
      for (let i = 0; i < ramp.length; i++) {
        const base = ramp[i]!;
        // Past cells use the current step's dots.
        const dot = PALETTES[name][theme].tones[i] === "k" ? 0 : 255;
        const blended = [1, 3, 5].map((k) => Math.round(parseInt(base.slice(k, k + 2), 16) * (1 - OPACITY) + dot * OPACITY));
        const hex = "#" + blended.map((v) => v.toString(16).padStart(2, "0")).join("");
        expect(contrast(base, hex), `${kind} step ${i}`).toBeGreaterThanOrEqual(1.4);
      }
    }
  });

  it("dots differ in lightness from the colour under them at every step of the ramp", () => {
    const OPACITY = 0.42;
    for (let i = 0; i < PALETTE.length; i++) {
      const base = PALETTE[i]!;
      const dot = dotTone(i) === "k" ? 0 : 255;
      const blended = [1, 3, 5].map((k) => Math.round(parseInt(base.slice(k, k + 2), 16) * (1 - OPACITY) + dot * OPACITY));
      const hex = "#" + blended.map((v) => v.toString(16).padStart(2, "0")).join("");
      expect(contrast(base, hex), `step ${i}`).toBeGreaterThanOrEqual(1.4);
    }
  });
});

describe("cells read steadily busier from free to busy", () => {
  // From arm's length a cell is its colour with its dots averaged in; past cells also have a
  // 50% veil of page colour on top, composited in sRGB. That averaged lightness must move
  // towards busy at every step: lighter in the dark theme, darker in the light theme.
  const bg = { dark: darkChosen["--color-bg"]!, light: light["--color-bg"]! };
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  it.each(PALETTE_NAMES.flatMap((n) => (["dark", "light"] as const).flatMap((t) => (["now", "past"] as const).map((k) => [n, t, k] as const))))(
    "%s, %s theme, %s",
    (name, theme, kind) => {
      const ramp = PALETTES[name][theme];
      const page = rgb(bg[theme]);
      const ls = (kind === "now" ? ramp.colours : ramp.past).map((hex, i) => {
        let c = averagedCell(hex, ramp.tones[i]!, ditherLevelForStep(i)) as number[];
        if (kind === "past") c = c.map((v, k) => 0.5 * v + 0.5 * page[k]!);
        return rgbToOklch(c as [number, number, number])[0];
      });
      for (let i = 1; i < ls.length; i++) {
        const step = theme === "dark" ? ls[i]! - ls[i - 1]! : ls[i - 1]! - ls[i]!;
        expect(step, `step ${i}: ${ls.map((l) => l.toFixed(3)).join(" ")}`).toBeGreaterThan(0.005);
      }
    },
  );
});

