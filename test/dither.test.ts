import { calendarCss } from "../src/styles";
import { describe, expect, it } from "vitest";
import { BAYER_4X4, DITHER_LAYERS, DITHER_MAX_LEVEL, assertDitherLayers, DITHER_MIN_LEVEL, assertDitherConstants, cellClasses, ditherLevel, ditherLevelForStep, ditherSvg, fineLevelForStep, stepPosition } from "../src/dither";
import { LEVELS, busyStep } from "../src/levels";
import { PALETTES, PALETTE_NAMES, PALETTE_SOURCES, THEME_PALETTES, isPaletteName, toneFor, PALETTE, PALETTE_PAST, PAST_CHROMA, PALETTE_CHROMA, PALETTE_L_MAX, PALETTE_L_MIN, PARULA_SOURCE, PARULA_TONED, rgbToOklch, toneTable, DOT_TONES } from "../src/parula";

describe("dither", () => {
  it("uses the spec's range", () => {
    expect(DITHER_MIN_LEVEL).toBe(0);
    expect(DITHER_MAX_LEVEL).toBe(12);
  });

  it("maps each step onto the level range along an S-curve, so more steps sit near the ends", () => {
    expect(ditherLevel(0)).toBe(0);
    expect(ditherLevel(0.5)).toBe(6);
    expect(ditherLevel(1)).toBe(12);
    for (let step = 0; step < LEVELS; step++) {
      const t = step / (LEVELS - 1);
      expect(stepPosition(step)).toBeCloseTo(t * t * (3 - 2 * t), 12);
    }
    const levels = Array.from({ length: LEVELS }, (_, s) => ditherLevelForStep(s));
    // The approved sketch: round 4's fine levels snapped to the nearest layer, ties down, never 0 when busy.
    expect(Array.from({ length: LEVELS }, (_, s) => fineLevelForStep(s))).toEqual([0, 1, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 11, 11, 12]);
    expect(levels).toEqual([0, 2, 2, 2, 2, 2, 4, 4, 6, 6, 9, 9, 9, 12, 12, 12, 12]);
    // Any busy step has dots, and levels never go down. (Steps 13–15 share the full pattern with
    // a fully busy slot: the sketch's choice; colour tells them apart.)
    expect(levels.slice(1).every((l) => l >= 1)).toBe(true);
    for (let step = 1; step < LEVELS; step++) expect(levels[step]).toBeGreaterThanOrEqual(levels[step - 1]!);
  });

  it("has six dot layers, none included, and every one is used", () => {
    expect(DITHER_LAYERS).toEqual([0, 2, 4, 6, 9, 12]);
    const used = new Set(Array.from({ length: LEVELS }, (_, s) => ditherLevelForStep(s)));
    expect([...used].sort((a, b) => a - b)).toEqual([...DITHER_LAYERS]);
  });

  it.each([[[1, 2, 12]], [[0, 4, 2, 12]], [[0, 2, 11]], [[0, 12]], [[0, 2.5, 12]]])("rejects invalid layers %j", (layers) => {
    expect(() => assertDitherLayers(layers, 0, 12)).toThrow(/Invalid dither layers/);
  });

  it("accepts valid layers", () => expect(() => assertDitherLayers([0, 2, 12], 0, 12)).not.toThrow());

  it("a fully busy cell is at DITHER_MAX_LEVEL and never solid", () => {
    expect(ditherLevel(1)).toBe(DITHER_MAX_LEVEL);
    const dots = ditherSvg(DITHER_MAX_LEVEL, "k").match(/<rect /g)?.length;
    expect(dots).toBe(12);
    expect(dots).toBeLessThan(16);
    expect(cellClasses(1)).toBe(`p${LEVELS - 1}`);
    expect(ditherLevelForStep(LEVELS - 1)).toBe(DITHER_MAX_LEVEL);
  });

  it("a free cell has no dots", () => {
    expect(cellClasses(0)).toBe("p0");
  });

  it("level n fills exactly the n lowest Bayer thresholds", () => {
    expect(BAYER_4X4.flat().sort((a, b) => a - b)).toEqual([...Array(16).keys()]);
    for (let n = 1; n <= DITHER_MAX_LEVEL; n++) expect(ditherSvg(n, "w").match(/<rect /g)?.length).toBe(n);
  });

  it.each([
    [-1, 12],
    [0, 16],
    [12, 12],
    [13, 12],
    [0.5, 12],
  ])("rejects invalid constants MIN=%d MAX=%d", (min, max) => {
    expect(() => assertDitherConstants(min, max)).toThrow(/Invalid dither constants/);
  });

  it("accepts valid constants", () => {
    expect(() => assertDitherConstants(0, 15)).not.toThrow();
    expect(() => assertDitherConstants(2, 9)).not.toThrow();
  });

});

describe("levels", () => {
  it("has 17 steps", () => expect(LEVELS).toBe(17));

  it("quantises busy fractions into steps 0, 1/16, … 1", () => {
    expect(busyStep(0)).toBe(0);
    expect(busyStep(1 / 16)).toBe(1);
    expect(busyStep(0.5)).toBe(8);
    expect(busyStep(0.52)).toBe(8);
    expect(busyStep(0.54)).toBe(9);
    expect(busyStep(15 / 16)).toBe(15);
    expect(busyStep(1)).toBe(16);
    expect(busyStep(-1)).toBe(0);
    expect(busyStep(2)).toBe(16);
  });

  it("never shows busy time as free, or part-free time as fully busy", () => {
    expect(busyStep(0.001)).toBe(1);
    expect(busyStep(0.999)).toBe(LEVELS - 2);
  });

  it("colour and dither use the same step", () => {
    for (let f = 0; f <= 1.0001; f += 0.01) {
      const step = busyStep(f);
      expect(cellClasses(f)).toBe(`p${step}`);
    }
  });
});

describe("palette", () => {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];

  it("keeps the source table and derives the toned one from it", () => {
    expect(PARULA_SOURCE.length).toBe(64);
    expect(PARULA_TONED.length).toBe(64);
    expect(PALETTE.length).toBe(LEVELS);
    expect(PALETTE[0]).toBe(PARULA_TONED[0]);
    // The fully busy end keeps the table's hue; its lightness may move just enough for its dots to show.
    const [L, , h] = rgbToOklch(rgb(PALETTE[LEVELS - 1]!));
    const [L0, , h0] = rgbToOklch(rgb(PARULA_TONED[63]!));
    expect(Math.abs(Math.atan2(Math.sin(h - h0), Math.cos(h - h0)))).toBeLessThan(0.05);
    expect(Math.abs(L - L0)).toBeLessThan(0.2);
  });

  it("compresses lightness into [L_MIN, L_MAX], reduces chroma, and keeps the hue path", () => {
    expect(PALETTE_CHROMA).toBe(0.85);
    expect([PALETTE_L_MIN, PALETTE_L_MAX]).toEqual([0.36, 0.9]);
    PARULA_TONED.forEach((hex, i) => {
      const [L, C, h] = rgbToOklch(rgb(hex));
      const [, C0, h0] = rgbToOklch(rgb(PARULA_SOURCE[i]!));
      expect(L).toBeGreaterThanOrEqual(PALETTE_L_MIN - 0.005);
      expect(L).toBeLessThanOrEqual(PALETTE_L_MAX + 0.005);
      expect(C).toBeLessThanOrEqual(C0 * PALETTE_CHROMA + 0.01);
      const dh = Math.abs(Math.atan2(Math.sin(h - h0), Math.cos(h - h0)));
      expect(dh, `hue ${i}`).toBeLessThan(0.08);
    });
  });

  it("the past palette keeps each step's lightness and hue with less chroma", () => {
    PALETTE.forEach((hex, i) => {
      const [L, C, h] = rgbToOklch(rgb(hex));
      const [Lp, Cp, hp] = rgbToOklch(rgb(PALETTE_PAST[i]!));
      expect(Lp).toBeCloseTo(L, 1);
      expect(Cp).toBeLessThanOrEqual(C * PAST_CHROMA + 0.01);
      if (C > 0.02) expect(Math.abs(Math.atan2(Math.sin(hp - h), Math.cos(hp - h)))).toBeLessThan(0.1);
    });
  });

  it("light mode inverts the map, not the dither: free is yellow, busy is dark", () => {
    const { light, dark } = THEME_PALETTES;
    expect(dark.colours).toEqual(PALETTE);
    expect(dark.past).toEqual(PALETTE_PAST);
    // Free is the map's own end colour in both themes, swapped; the steps between follow the map backwards.
    expect(light.colours[0]).toBe(PARULA_TONED[63]);
    expect(dark.colours[0]).toBe(PARULA_TONED[0]);
    for (let i = 0; i < LEVELS; i++) {
      const [, C, h] = rgbToOklch(rgb(light.colours[i]!));
      const [, C2, h2] = rgbToOklch(rgb(dark.colours[LEVELS - 1 - i]!));
      if (C > 0.03 && C2 > 0.03) expect(Math.abs(Math.atan2(Math.sin(h - h2), Math.cos(h - h2))), `step ${i}`).toBeLessThan(0.1);
    }
    const css = calendarCss();
    const darkBlock = /^:root\{([^}]*)\}/m.exec(css)![1]!;
    const lightBlock = /:root\[data-theme="light"\]\{([^}]*)\}/.exec(css)![1]!;
    expect(lightBlock).toContain(`--cell-0:${light.colours[0]}`);
    expect(darkBlock).toContain(`--cell-0:${PALETTE[0]}`);
    // Same dither level per step in both themes; each theme has its own dot tone per step.
    for (let i = 0; i < LEVELS; i++) {
      const level = ditherLevelForStep(i);
      const dots = (block: string) => new RegExp(`--dots-${i}:([^;]*)`).exec(block)![1];
      for (const [block, tone] of [[lightBlock, light.tones[i]!], [darkBlock, dark.tones[i]!]] as const) {
        expect(dots(block)).toBe(level === 0 ? "none" : `url(/img/dither/${level}${tone}.svg)`);
      }
    }
  });
});

describe("palette presets", () => {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];

  it("offers parula first, as the default, and the map tables are 64 entries", () => {
    expect(PALETTE_NAMES[0]).toBe("parula");
    expect(PALETTES.parula).toBe(THEME_PALETTES);
    for (const name of PALETTE_NAMES) expect(PALETTE_SOURCES[name].length, name).toBe(64);
    expect(isPaletteName("viridis")).toBe(true);
    expect(isPaletteName("jet")).toBe(false);
    expect(isPaletteName(undefined)).toBe(false);
  });

  it.each(PALETTE_NAMES.map((n) => [n]))("%s: ends inside the lightness range; past keeps each step's lightness", (name) => {
    const { dark, light } = PALETTES[name];
    expect(dark.colours.length).toBe(LEVELS);
    expect(rgbToOklch(rgb(dark.colours[0]!))[0]).toBeGreaterThanOrEqual(PALETTE_L_MIN - 0.005);
    expect(rgbToOklch(rgb(dark.colours[LEVELS - 1]!))[0]).toBeLessThanOrEqual(PALETTE_L_MAX + 0.005);
    for (const ramp of [dark, light]) {
      for (let i = 0; i < LEVELS; i++) {
        const [L, C] = rgbToOklch(rgb(ramp.colours[i]!));
        const [Lp, Cp] = rgbToOklch(rgb(ramp.past[i]!));
        expect(Lp).toBeCloseTo(L, 1);
        expect(Cp).toBeLessThanOrEqual(C * PAST_CHROMA + 0.01);
      }
    }
  });

  it.each(PALETTE_NAMES.map((n) => [n]))("%s: keeps the sketch's dot tones, and the solve fits every rule with them", (name) => {
    for (const theme of ["dark", "light"] as const) {
      const ramp = PALETTES[name][theme];
      expect(ramp.tones.join(""), theme).toBe(DOT_TONES[name][theme]);
      expect(ramp.issues?.filter((i) => i.rule !== "target"), theme).toEqual([]);
    }
  });

  it("only the dark theme's step 1 misses its curve target, by under 0.01 (its colour is at black)", () => {
    for (const name of PALETTE_NAMES) {
      expect(PALETTES[name].light.issues).toEqual([]);
      const misses = PALETTES[name].dark.issues!.filter((i) => i.rule === "target");
      expect(misses.map((i) => i.step), name).toEqual([1]);
      expect(misses[0]!.short).toBeLessThan(0.01);
    }
  });

  it("the tones are round 4's: light dots on the dark theme's early steps", () => {
    expect(DOT_TONES.parula).toEqual({ dark: "wwwwwwwwwkkkkkkkw", light: "kkkkkkkkwkkkkkkkk" });
    for (const name of PALETTE_NAMES) expect(DOT_TONES[name].dark.slice(1, 9)).toBe("wwwwwwww");
  });

  it.each(PALETTE_NAMES.map((n) => [n]))("%s: its free colour in both themes is in calendar.css for the theme switch, outside the theme blocks", (name) => {
    const css = calendarCss();
    const esc = name.replace(/[-]/g, "\\-");
    const darkBlock = new RegExp(`^\\[data-palette="${esc}"\\]\\{([^}]*)\\}`, "m").exec(css)![1]!;
    const { dark, light } = PALETTES[name];
    expect(darkBlock).toContain(`--map-free-dark:${dark.colours[0]};--map-on-free-dark:var(--raw-white)`);
    expect(darkBlock).toContain(`--map-free-light:${light.colours[0]};--map-on-free-light:var(--raw-black)`);
    expect(css.match(/--map-free-dark:/g)?.length).toBe(1 + PALETTE_NAMES.length);
    for (const line of css.split("\n").filter((l) => l.startsWith(':root[data-theme="light"]'))) expect(line).not.toContain("--map-free");
    expect(css).toContain(".map-free-dark{background-color:var(--map-free-dark);color:var(--map-on-free-dark)}");
    expect(css).toContain(".map-free-light{background-color:var(--map-free-light);color:var(--map-on-free-light)}");
  });

  it.each(PALETTE_NAMES.map((n) => [n]))("%s has its own scoped block in calendar.css, in both themes", (name) => {
    const css = calendarCss();
    const esc = name.replace(/[-]/g, "\\-");
    const darkBlock = new RegExp(`^\\[data-palette="${esc}"\\]\\{([^}]*)\\}`, "m").exec(css)![1]!;
    const lightBlock = new RegExp(`^:root\\[data-theme="light"\\]\\[data-palette="${esc}"\\],:root\\[data-theme="light"\\] \\[data-palette="${esc}"\\]\\{([^}]*)\\}`, "m").exec(css)![1]!;
    const { dark, light } = PALETTES[name];
    for (let i = 0; i < LEVELS; i++) {
      const level = ditherLevelForStep(i);
      expect(darkBlock).toContain(`--cell-${i}:${dark.colours[i]};`);
      expect(lightBlock).toContain(`--cell-${i}:${light.colours[i]};`);
      const dots = (block: string) => new RegExp(`--dots-${i}:([^;}]*)`).exec(block)![1];
      for (const [block, tone] of [[lightBlock, light.tones[i]!], [darkBlock, dark.tones[i]!]] as const) {
        expect(dots(block)).toBe(level === 0 ? "none" : `url(/img/dither/${level}${tone}.svg)`);
      }
    }
  });
});

