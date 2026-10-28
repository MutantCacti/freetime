import { calendarCss } from "../src/styles";
import { describe, expect, it } from "vitest";
import { BAYER_4X4, DITHER_MAX_LEVEL, DITHER_MIN_LEVEL, assertDitherConstants, cellClasses, ditherLevel, ditherLevelForStep, ditherSvg } from "../src/dither";
import { LEVELS, busyStep } from "../src/levels";
import { THEME_PALETTES, toneFor, PALETTE, PALETTE_PAST, PAST_CHROMA, PALETTE_CHROMA, PALETTE_L_MAX, PALETTE_L_MIN, PARULA_SOURCE, PARULA_TONED, rgbToOklch } from "../src/parula";

describe("dither", () => {
  it("uses the spec's range", () => {
    expect(DITHER_MIN_LEVEL).toBe(0);
    expect(DITHER_MAX_LEVEL).toBe(12);
  });

  it("maps each step linearly onto the level range", () => {
    expect(ditherLevel(0)).toBe(0);
    expect(ditherLevel(0.5)).toBe(6);
    expect(ditherLevel(1)).toBe(12);
    for (let step = 0; step < LEVELS; step++) {
      expect(ditherLevelForStep(step)).toBe(Math.round(DITHER_MIN_LEVEL + (step / (LEVELS - 1)) * (DITHER_MAX_LEVEL - DITHER_MIN_LEVEL)));
    }
    expect(Array.from({ length: LEVELS }, (_, s) => ditherLevelForStep(s))).toEqual([0, 2, 3, 5, 6, 8, 9, 11, 12]);
  });

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
  it("has 9 steps", () => expect(LEVELS).toBe(9));

  it("quantises busy fractions into steps 0, 1/8, … 1", () => {
    expect(busyStep(0)).toBe(0);
    expect(busyStep(1 / 8)).toBe(1);
    expect(busyStep(0.5)).toBe(4);
    expect(busyStep(0.55)).toBe(4);
    expect(busyStep(0.57)).toBe(5);
    expect(busyStep(7 / 8)).toBe(7);
    expect(busyStep(1)).toBe(8);
    expect(busyStep(-1)).toBe(0);
    expect(busyStep(2)).toBe(8);
  });

  it("never shows busy time as free, or part-free time as fully busy", () => {
    expect(busyStep(0.001)).toBe(1);
    expect(busyStep(0.999)).toBe(7);
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
    expect(PALETTE[LEVELS - 1]).toBe(PARULA_TONED[63]);
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

  it("light mode inverts the colours, not the dither: free is yellow, busy is dark", () => {
    const { light, dark } = THEME_PALETTES;
    expect(dark.colours).toEqual(PALETTE);
    for (let i = 0; i < LEVELS; i++) {
      expect(light.colours[i]).toBe(PALETTE[LEVELS - 1 - i]);
      expect(light.past[i]).toBe(PALETTE_PAST[LEVELS - 1 - i]);
    }
    const css = calendarCss();
    const darkBlock = /^:root\{([^}]*)\}/m.exec(css)![1]!;
    const lightBlock = /:root\[data-theme="light"\]\{([^}]*)\}/.exec(css)![1]!;
    expect(lightBlock).toContain(`--cell-0:${PALETTE[LEVELS - 1]}`);
    expect(lightBlock).toContain(`--cell-${LEVELS - 1}:${PALETTE[0]}`);
    expect(darkBlock).toContain(`--cell-0:${PALETTE[0]}`);
    // Same dither level per step in both themes; the tone follows the colour.
    for (let i = 0; i < LEVELS; i++) {
      const level = ditherLevelForStep(i);
      const dots = (block: string) => new RegExp(`--dots-${i}:([^;]*)`).exec(block)![1];
      for (const [block, colour] of [[lightBlock, light.colours[i]!], [darkBlock, dark.colours[i]!]] as const) {
        expect(dots(block)).toBe(level === 0 ? "none" : `url(/img/dither/${level}${toneFor(colour)}.svg)`);
      }
    }
  });

  it("gets lighter from free to busy", () => {
    const ls = PALETTE.map((h) => rgbToOklch(rgb(h))[0]);
    for (let i = 1; i < ls.length; i++) expect(ls[i]!).toBeGreaterThan(ls[i - 1]!);
  });
});
