import { describe, expect, it } from "vitest";
import { BAYER_4X4, DITHER_MAX_LEVEL, DITHER_MIN_LEVEL, assertDitherConstants, cellClasses, ditherLevel, ditherSvg } from "../src/dither";
import { PARULA, parulaIndex } from "../src/parula";

describe("dither", () => {
  it("uses the spec's range", () => {
    expect(DITHER_MIN_LEVEL).toBe(0);
    expect(DITHER_MAX_LEVEL).toBe(12);
  });

  it("maps the fraction linearly onto the level range", () => {
    expect(ditherLevel(0)).toBe(0);
    expect(ditherLevel(0.5)).toBe(6);
    expect(ditherLevel(1)).toBe(12);
    for (let f = 0; f <= 1; f += 0.01) {
      expect(ditherLevel(f)).toBe(Math.round(DITHER_MIN_LEVEL + f * (DITHER_MAX_LEVEL - DITHER_MIN_LEVEL)));
    }
  });

  it("a fully busy cell is at DITHER_MAX_LEVEL and never solid", () => {
    expect(ditherLevel(1)).toBe(DITHER_MAX_LEVEL);
    const dots = ditherSvg(DITHER_MAX_LEVEL, "k").match(/<rect /g)?.length;
    expect(dots).toBe(12);
    expect(dots).toBeLessThan(16);
    expect(cellClasses(1)).toContain(`d${DITHER_MAX_LEVEL}`);
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

  it("maps fractions onto the 64-entry parula table, low to high", () => {
    expect(PARULA.length).toBe(64);
    expect(parulaIndex(0)).toBe(0);
    expect(parulaIndex(1)).toBe(63);
    expect(parulaIndex(-1)).toBe(0);
    expect(parulaIndex(2)).toBe(63);
  });
});
