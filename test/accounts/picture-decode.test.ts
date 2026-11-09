// Decoding, resizing and the accent colour (image-decode.ts, accent.ts, pictures.ts).
import { describe, expect, it } from "vitest";
import tokens from "../../public/css/tokens.css?raw";
import { ACCENT_LUMINANCE, CHROMA_PREFERENCE, MAP_HUE_MIN_CHROMA, MID_STEP, KAWASE_WEIGHTS, snapAccent, snapStep, SATURATION_BOOST, accentOf, accentText, blurToPixel, clampAccent, gridImage, kawaseOffset, pictureColour, saturate } from "../../src/accounts/accent";
import { Grid, PICTURE_SIZE, decodeJpeg, decodePng } from "../../src/accounts/image-decode";
import { processPicture } from "../../src/accounts/pictures";
import { PALETTES, PALETTE_NAMES, hexToRgb, luminance, rgbToOklch } from "../../src/parula";
import baselineUrl from "../fixtures/pic-baseline-420.jpg?inline";
import progressiveUrl from "../fixtures/pic-progressive-420.jpg?inline";
import greyUrl from "../fixtures/pic-grey.jpg?inline";
import { buildPng, inlineBytes } from "./png-builder";

const toGamma8 = (c: number) => Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
/** A grid cell back in 8-bit sRGB, and its alpha. */
function cell(g: Grid, x: number, y: number): number[] {
  const i = y * g.size + x;
  const a = g.a[i]!;
  return [toGamma8(g.r[i]! / a), toGamma8(g.g[i]! / a), toGamma8(g.b[i]! / a), Math.round((255 * a) / g.n[i]!)];
}
const close = (got: number[], want: number[], tol = 1) => got.every((v, i) => Math.abs(v - want[i]!) <= tol);

describe("PNG decoding", () => {
  // A 6×4 picture whose every pixel is different, cropped to its centre 4×4.
  const rgb = (x: number, y: number) => [x * 40, y * 60, 255 - x * 20];

  it.each([0, 1, 2, 3, 4])("undoes filter %d", async (f) => {
    const g = (await decodePng(await buildPng({ w: 6, h: 4, type: 2, pixel: rgb, filter: () => f })))!;
    expect(g.size).toBe(4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) expect(close(cell(g, x, y), [...rgb(x + 1, y), 255]), `${x},${y}`).toBe(true);
  });

  it("reads RGBA, grey, grey + alpha, 16-bit and palette pictures", async () => {
    const rgba = (await decodePng(await buildPng({ w: 4, h: 4, type: 6, pixel: (x, y) => [...rgb(x, y), 255] })))!;
    expect(close(cell(rgba, 2, 1), [...rgb(2, 1), 255])).toBe(true);
    const grey = (await decodePng(await buildPng({ w: 4, h: 4, type: 0, pixel: (x) => [x * 80] })))!;
    expect(close(cell(grey, 3, 0), [240, 240, 240, 255])).toBe(true);
    const greyA = (await decodePng(await buildPng({ w: 4, h: 4, type: 4, pixel: (x) => [100, x === 0 ? 0 : 255] })))!;
    expect(greyA.a[0]).toBe(0);
    expect(close(cell(greyA, 1, 0), [100, 100, 100, 255])).toBe(true);
    const deep = (await decodePng(await buildPng({ w: 4, h: 4, type: 2, depth: 16, pixel: () => [0x1234, 0xabcd, 0xff00] })))!;
    expect(close(cell(deep, 0, 0), [0x12, 0xab, 0xff, 255])).toBe(true);
    const palette = [[200, 10, 10], [10, 200, 10], [10, 10, 200]];
    const pal = (await decodePng(await buildPng({ w: 5, h: 5, type: 3, depth: 2, palette, pixel: (x) => [x % 3] })))!;
    expect(close(cell(pal, 0, 0), [200, 10, 10, 255])).toBe(true);
    expect(close(cell(pal, 4, 0), [10, 200, 10, 255])).toBe(true);
    const pal1 = (await decodePng(await buildPng({ w: 8, h: 8, type: 3, depth: 1, palette, trns: [0], pixel: (x) => [x & 1] })))!;
    expect(pal1.a[0]).toBe(0);
    expect(close(cell(pal1, 1, 0), [10, 200, 10, 255])).toBe(true);
  });

  it("refuses interlaced, truncated and broken pictures", async () => {
    expect(await decodePng(await buildPng({ w: 4, h: 4, type: 2, interlace: 1, pixel: rgb }))).toBeNull();
    const ok = await buildPng({ w: 40, h: 40, type: 2, pixel: rgb });
    expect(await decodePng(ok.subarray(0, ok.length - 40))).toBeNull();
    expect(await decodePng(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]))).toBeNull();
  });
});

describe("resizing", () => {
  it("a large PNG comes back as exactly the chosen size, centre-cropped and area-averaged", async () => {
    // 1024 × 768: the left and right 128 columns are red, the rest a checkerboard of black and white.
    // The centre square is 768 wide, so each of the 128 cells averages exactly 6 × 6 pixels.
    const png = await buildPng({ w: 1024, h: 768, type: 2, filter: () => 4, pixel: (x, y) => (x < 128 || x >= 896 ? [255, 0, 0] : (x + y) % 2 ? [255, 255, 255] : [0, 0, 0]) });
    const g = (await decodePng(png))!;
    expect(g.size).toBe(PICTURE_SIZE);
    // No red survives the crop, and the checkerboard averages (in linear light) to mid-grey: 188 in sRGB.
    for (const [x, y] of [[0, 0], [127, 0], [64, 64], [0, 127], [127, 127]] as const) expect(close(cell(g, x, y), [188, 188, 188, 255], 2), `${x},${y}`).toBe(true);
  });

  it.each([
    ["baseline 4:2:0, 800 × 600, decoded in full", baselineUrl],
    ["progressive 4:2:0, 2400 × 1800, decoded by block averages", progressiveUrl],
  ])("a large JPEG (%s) comes back as exactly the chosen size, centre-cropped", (_name, url) => {
    const g = decodeJpeg(inlineBytes(url))!;
    expect(g.size).toBe(PICTURE_SIZE);
    // The red and blue side bands are outside the centre square; inside it's green, lighter towards the bottom.
    for (const x of [0, 64, 127]) {
      const [r, gr, b] = cell(g, x, 64);
      expect(gr, `x ${x}`).toBeGreaterThan(r! + 60);
      expect(gr).toBeGreaterThan(b! + 60);
    }
    expect(cell(g, 64, 127)[1]).toBeGreaterThan(cell(g, 64, 0)[1]!);
  });

  it("a small greyscale JPEG is cropped to its own short side, never enlarged", () => {
    const g = decodeJpeg(inlineBytes(greyUrl))!;
    expect(g.size).toBe(PICTURE_SIZE); // 300 × 200 → the centre 200 × 200 → 128
    const [r, gr, b] = cell(g, 64, 64);
    expect(r).toBe(gr);
    expect(gr).toBe(b);
    const tiny = decodePng(new Uint8Array(0));
    return expect(tiny).resolves.toBeNull();
  });

  it("pictures smaller than the chosen size keep their own size", async () => {
    const g = (await decodePng(await buildPng({ w: 50, h: 30, type: 2, pixel: () => [1, 2, 3] })))!;
    expect(g.size).toBe(30);
  });

  it("re-encodes as a PNG of the chosen size, which decodes back to the same pixels", async () => {
    const src = await buildPng({ w: 300, h: 300, type: 2, pixel: (x, y) => [x % 256, y % 256, 90] });
    const out = (await processPicture(src, "image/png"))!;
    const back = (await decodePng(out.png))!;
    expect(back.size).toBe(PICTURE_SIZE);
    const first = (await decodePng(src))!;
    for (const [x, y] of [[0, 0], [100, 20], [127, 127]] as const) expect(close(cell(back, x, y), cell(first, x, y), 1)).toBe(true);
  });

  it("refuses what it can't decode", async () => {
    expect(decodeJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]))).toBeNull();
    expect(await processPicture(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), "image/jpeg")).toBeNull();
  });
});

describe("accent", () => {
  const solid = (rgb: number[], size = 64) => {
    const g = new Grid(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) g.add8(x, y, rgb[0]!, rgb[1]!, rgb[2]!);
    return g;
  };
  const to8 = (c: number[]) => c.map((v) => Math.round(v * 255));

  it("uses Intel's offsets and normalised, overlaid kernels", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(kawaseOffset)).toEqual([0, 1, 2, 2, 3, 3, 4]);
    const { centre, diagonal, axial } = KAWASE_WEIGHTS;
    expect(centre + 4 * diagonal + 4 * axial).toBeCloseTo(1, 12);
    expect(blurToPixel(gridImage(solid([1, 2, 3], 128))).passes).toBe(7);
  });

  it("a solid colour gives that colour", () => {
    for (const c of [[30, 140, 200], [250, 250, 250], [12, 12, 12], [200, 60, 20]]) expect(close(to8(pictureColour(solid(c))!), c, 1), String(c)).toBe(true);
  });

  it("a one-pixel bright outlier barely moves it", () => {
    const base = [40, 90, 160];
    const g = new Grid(128, 128);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) (x === 64 && y === 64 ? g.add8(x, y, 255, 255, 0) : g.add8(x, y, base[0]!, base[1]!, base[2]!));
    expect(close(to8(pictureColour(g)!), base, 2)).toBe(true);
  });

  it("transparent areas don't count; a fully transparent picture has none", () => {
    const g = new Grid(32, 32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) (x < 16 ? g.add8(x, y, 0, 200, 0, 0) : g.add8(x, y, 200, 30, 30));
    expect(close(to8(pictureColour(g)!), [200, 30, 30], 1)).toBe(true);
    const clear = new Grid(8, 8);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) clear.add8(x, y, 9, 9, 9, 0);
    expect(accentOf(clear)).toBeNull();
  });

  // The page and surface colours of both themes, from tokens.css.
  const raw = Object.fromEntries([...tokens.matchAll(/(--raw-[a-z0-9-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]));
  const themeBlock = (from: string, to?: string) => tokens.slice(tokens.indexOf(from), to ? tokens.indexOf(to) : undefined);
  const semantic = (block: string, name: string) => raw[new RegExp(`${name}:\\s*var\\((--raw-[a-z0-9-]+)\\)`).exec(block)![1]!]!;
  const dark = themeBlock("semantic: dark (default)", "semantic: light (chosen)");
  const light = themeBlock("semantic: light (chosen)");
  const backgrounds = [dark, light].flatMap((b) => [semantic(b, "--color-bg"), semantic(b, "--color-surface")]);
  const contrast = (a: string, b: string) => {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
    return (x + 0.05) / (y + 0.05);
  };

  it.each([
    ["near black", [0.02, 0.02, 0.03]],
    ["near white", [0.98, 0.97, 0.99]],
    ["saturated yellow", [1, 0.95, 0]],
    ["deep blue", [0.05, 0.05, 0.5]],
    ["mid grey", [0.5, 0.5, 0.5]],
    ["pink", [1, 0.4, 0.7]],
  ])("clamps %s so it works in both themes, keeping its hue", (_n, rgb) => {
    const hex = clampAccent(rgb as [number, number, number]);
    const y = luminance(hex);
    expect(y).toBeGreaterThanOrEqual(ACCENT_LUMINANCE.min);
    expect(y).toBeLessThanOrEqual(ACCENT_LUMINANCE.max);
    for (const bg of backgrounds) expect(contrast(hex, bg), `on ${bg}`).toBeGreaterThanOrEqual(3);
    const text = accentText(hex) === "dark" ? raw["--raw-black"]! : raw["--raw-white"]!;
    expect(contrast(hex, text)).toBeGreaterThanOrEqual(4.5);
    const [, C0, h0] = rgbToOklch(rgb as [number, number, number]);
    const [, C, h] = rgbToOklch([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]);
    if (C0 > 0.05 && C > 0.03) expect(Math.abs(Math.atan2(Math.sin(h - h0), Math.cos(h - h0)))).toBeLessThan(0.15);
  });

  const hsl = ([r, g, b]: number[]) => {
    const max = Math.max(r!, g!, b!), min = Math.min(r!, g!, b!), l = (max + min) / 2, d = max - min;
    const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let h = d === 0 ? 0 : max === r ? ((g! - b!) / d) % 6 : max === g ? (b! - r!) / d + 2 : (r! - g!) / d + 4;
    if (h < 0) h += 6;
    return [h, sat, l];
  };

  it("raises HSL saturation, keeping hue and lightness", () => {
    for (const c of [[0.45, 0.48, 0.52], [0.63, 0.52, 0.47], [0.2, 0.5, 0.3], [0.8, 0.2, 0.2]]) {
      const [h, s0, l] = hsl(c);
      const [h2, s2, l2] = hsl(saturate(c as [number, number, number]));
      expect(h2).toBeCloseTo(h!, 6);
      expect(l2).toBeCloseTo(l!, 6);
      expect(s2).toBeGreaterThan(s0!);
      expect(s2).toBeLessThanOrEqual(s0! + (1 - s0!) * SATURATION_BOOST + 1e-9);
    }
  });

  it("leaves grey and near-grey neutral rather than inventing a hue", () => {
    for (const c of [[0.5, 0.5, 0.5], [0.1, 0.1, 0.1], [0.5, 0.505, 0.51]]) expect(saturate(c as [number, number, number])).toEqual(c);
  });

  it("the boosted accent still meets the clamp's contrast in both themes", () => {
    const g = new Grid(32, 32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) (x < 16 ? g.add8(x, y, 40, 150, 160) : g.add8(x, y, 230, 120, 40));
    const hex = accentOf(g)!;
    for (const bg of backgrounds) expect(contrast(hex, bg)).toBeGreaterThanOrEqual(3);
    const text = accentText(hex) === "dark" ? raw["--raw-black"]! : raw["--raw-white"]!;
    expect(contrast(hex, text)).toBeGreaterThanOrEqual(4.5);
    // More colourful than clamping the plain average.
    const plain = clampAccent(pictureColour(g)!);
    const sat = (h: string) => hsl([1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255))[1]!;
    expect(sat(hex)).toBeGreaterThan(sat(plain) + 0.05);
  });

  it("leaves a colour that already fits alone", () => {
    const rgb: [number, number, number] = [0.25, 0.5, 0.75];
    const hex = clampAccent(rgb);
    expect(close(to8([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)), to8(rgb), 1)).toBe(true);
  });
});

describe("accent snapped to the colour map", () => {
  const raw = Object.fromEntries([...tokens.matchAll(/(--raw-[a-z0-9-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]));
  const themeBlock = (from: string, to?: string) => tokens.slice(tokens.indexOf(from), to ? tokens.indexOf(to) : undefined);
  const semantic = (block: string, name: string) => raw[new RegExp(`${name}:\\s*var\\((--raw-[a-z0-9-]+)\\)`).exec(block)![1]!]!;
  const blocks = { dark: themeBlock("semantic: dark (default)", "semantic: light (chosen)"), light: themeBlock("semantic: light (chosen)") };
  const pages = (theme: "dark" | "light") => [semantic(blocks[theme], "--color-bg"), semantic(blocks[theme], "--color-surface")];
  const contrast = (a: string, b: string) => {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
    return (x + 0.05) / (y + 0.05);
  };
  const hueGap = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  // Stored accents as the picture pipeline leaves them (clampAccent keeps the hue), plus a grey and none.
  const accents: [string, string | null][] = [
    ["orange", clampAccent([0.9, 0.47, 0.08])],
    ["teal", clampAccent([0.16, 0.6, 0.63])],
    ["slate blue", clampAccent([0.44, 0.53, 0.79])],
    ["plum", clampAccent([0.6, 0.42, 0.77])],
    ["green", clampAccent([0.3, 0.7, 0.3])],
    ["red", clampAccent([0.8, 0.15, 0.15])],
    ["grey", clampAccent([0.54, 0.57, 0.62])],
    ["none", null],
  ];
  const cases = PALETTE_NAMES.flatMap((map) => (["dark", "light"] as const).flatMap((theme) => accents.map(([n, a]) => [map, theme, n, a] as const)));

  it.each(cases)("%s, %s theme, %s: 3:1 on the page, readable text, the map's own hue", (map, theme, _n, accent) => {
    const hex = snapAccent(accent, map, theme);
    for (const bg of pages(theme)) expect(contrast(hex, bg), `on ${bg}`).toBeGreaterThanOrEqual(3);
    const text = accentText(hex) === "dark" ? raw["--raw-black"]! : raw["--raw-white"]!;
    expect(contrast(hex, text)).toBeGreaterThanOrEqual(4.5);
    // The colour is the chosen step's, with only its lightness moved.
    const cell = PALETTES[map][theme].colours[snapStep(accent, map, theme)]!;
    const [, Cc, hc] = rgbToOklch(hexToRgb(cell));
    const [, C, h] = rgbToOklch(hexToRgb(hex));
    if (Cc > 0.03 && C > 0.03) expect(hueGap(h, hc)).toBeLessThan(0.1);
    if (hex !== cell) expect(theme === "dark" ? luminance(hex) > luminance(cell) : luminance(hex) < luminance(cell)).toBe(true);
  });

  it.each(cases)("%s, %s theme, %s: the step nearest the picture's hue, or the middle step for grey", (map, theme, _n, accent) => {
    const step = snapStep(accent, map, theme);
    const source = accent ? rgbToOklch(hexToRgb(accent)) : null;
    if (!source || source[1] < 0.03) return expect(step).toBe(MID_STEP);
    const cells = PALETTES[map][theme].colours.map((c) => rgbToOklch(hexToRgb(c)));
    const hued = cells.filter(([, C]) => C >= MAP_HUE_MIN_CHROMA);
    const nearest = Math.min(...hued.map(([, , h]) => hueGap(h, source[2])));
    const maxC = Math.max(...hued.map(([, C]) => C));
    expect(cells[step]![1]).toBeGreaterThanOrEqual(MAP_HUE_MIN_CHROMA);
    // Nearest in hue, give or take the small preference for colourful steps.
    expect(hueGap(cells[step]![2], source[2])).toBeLessThanOrEqual(nearest + CHROMA_PREFERENCE * maxC + 1e-9);
  });

  it("the middle step is the middle of the 17", () => expect(MID_STEP).toBe(8));

  it("keeps a map colour that already stands 3:1 off the page as it is", () => {
    // Parula's busiest dark-theme colour is light enough already.
    const cell = PALETTES.parula.dark.colours[16]!;
    const yellowish = clampAccent([0.95, 0.85, 0.1]);
    const step = snapStep(yellowish, "parula", "dark");
    const hex = snapAccent(yellowish, "parula", "dark");
    if (step === 16) expect(hex).toBe(cell);
    expect(contrast(hex, pages("dark")[0]!)).toBeGreaterThanOrEqual(3);
  });

  it("different hues land on different steps of a colourful map", () => {
    const steps = new Set(accents.slice(0, 6).map(([, a]) => snapStep(a, "plasma", "dark")));
    expect(steps.size).toBeGreaterThanOrEqual(3);
  });
});
