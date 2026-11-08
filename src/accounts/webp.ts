// WebP decoding for profile pictures, with libwebp's decoder compiled to
// WebAssembly (vendored from @jsquash/webp: src/vendor/webp/). The module is
// compiled into the Worker by Wrangler and instantiated once, on first use.
// The header is read first, so a picture claiming a huge size is refused
// before any decoding; the decoded pixels go into the same Grid as PNG and
// JPEG (centre square, area-averaged, linear light, alpha).

import factory, { type WebPModule } from "../vendor/webp/webp_dec.js";
import wasm from "../vendor/webp/webp_dec.wasm";
import { Grid, PICTURE_SIZE } from "./image-decode";

/** Decoding needs width × height × 4 bytes inside the module, so WebP is capped lower than PNG and JPEG. */
export const MAX_WEBP_PIXELS = 12_000_000;

let module: Promise<WebPModule> | null = null;
function webp(): Promise<WebPModule> {
  module ??= factory({
    noInitialRun: true,
    instantiateWasm: (imports, done) => {
      const instance = new WebAssembly.Instance(wasm, imports);
      done(instance);
      return instance.exports;
    },
  });
  return module;
}

/** Width and height from a WebP header (lossy "VP8 ", lossless "VP8L" or extended "VP8X"), or null. */
export function webpSize(b: Uint8Array): { w: number; h: number } | null {
  const tag = (i: number) => String.fromCharCode(b[i]!, b[i + 1]!, b[i + 2]!, b[i + 3]!);
  if (b.length < 30 || tag(0) !== "RIFF" || tag(8) !== "WEBP") return null;
  const chunk = tag(12);
  if (chunk === "VP8 ") {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { w: (b[26]! | (b[27]! << 8)) & 0x3fff, h: (b[28]! | (b[29]! << 8)) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return null;
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    return { w: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), h: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)) };
  }
  return null;
}

/** The picture as a Grid, or null if it can't be decoded or is too big. Animated WebP isn't decoded (libwebp's simple decoder refuses it), so it's refused. */
export async function decodeWebp(bytes: Uint8Array): Promise<Grid | null> {
  const size = webpSize(bytes);
  if (!size || !size.w || !size.h || size.w * size.h > MAX_WEBP_PIXELS) return null;
  try {
    const img = (await webp()).decode(bytes);
    if (!img || img.width !== size.w || img.height !== size.h || img.data.length !== img.width * img.height * 4) return null;
    const grid = new Grid(img.width, img.height);
    const step = Math.max(1, Math.floor(Math.min(img.width, img.height) / (PICTURE_SIZE * 8)));
    for (let y = 0; y < img.height; y += step) {
      if (!grid.wantsRow(y)) continue;
      for (let x = 0; x < img.width; x += step) {
        const o = (y * img.width + x) * 4;
        grid.add8(x, y, img.data[o]!, img.data[o + 1]!, img.data[o + 2]!, img.data[o + 3]! / 255);
      }
    }
    return grid.complete() ? grid : null;
  } catch {
    return null;
  }
}
