// Builds test PNGs in any colour type, bit depth and filter, so the decoder
// can be checked against known pixels. Not a fixture: the pixels come from a function.

export interface PngSpec {
  w: number;
  h: number;
  /** 0 grey, 2 RGB, 3 palette, 4 grey + alpha, 6 RGBA. */
  type: 0 | 2 | 3 | 4 | 6;
  depth?: 1 | 2 | 4 | 8 | 16;
  interlace?: 0 | 1;
  palette?: number[][];
  trns?: number[];
  /** Raw sample values for pixel (x, y), one per channel (palette: the index). */
  pixel: (x: number, y: number) => number[];
  /** Filter for row y (0–4); defaults to cycling through all five. */
  filter?: (y: number) => number;
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as const;

export async function buildPng(spec: PngSpec): Promise<Uint8Array> {
  const depth = spec.depth ?? 8;
  const ch = CHANNELS[spec.type];
  const bitsPerPixel = ch * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const stride = Math.ceil((spec.w * bitsPerPixel) / 8);
  const raw = new Uint8Array((stride + 1) * spec.h);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < spec.h; y++) {
    const row = new Uint8Array(stride);
    for (let x = 0; x < spec.w; x++) {
      const values = spec.pixel(x, y);
      for (let c = 0; c < ch; c++) {
        const v = values[c]!;
        if (depth === 16) {
          row[(x * ch + c) * 2] = v >> 8;
          row[(x * ch + c) * 2 + 1] = v & 255;
        } else if (depth === 8) row[x * ch + c] = v;
        else {
          const bit = x * depth;
          row[bit >> 3]! |= v << (8 - depth - (bit & 7));
        }
      }
    }
    const f = spec.filter ? spec.filter(y) : y % 5;
    const out = y * (stride + 1);
    raw[out] = f;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp]! : 0, b = prev[i]!, c = i >= bpp ? prev[i - bpp]! : 0;
      let pred = 0;
      if (f === 1) pred = a;
      else if (f === 2) pred = b;
      else if (f === 3) pred = (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      raw[out + 1 + i] = (row[i]! - pred) & 255;
    }
    prev = row;
  }
  const idat = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, spec.w);
  new DataView(ihdr.buffer).setUint32(4, spec.h);
  ihdr.set([depth, spec.type, 0, 0, spec.interlace ?? 0], 8);
  const chunks = [chunk("IHDR", ihdr)];
  if (spec.palette) chunks.push(chunk("PLTE", new Uint8Array(spec.palette.flat())));
  if (spec.trns) chunks.push(chunk("tRNS", new Uint8Array(spec.trns)));
  // Split the data over two IDAT chunks, as encoders may.
  const half = idat.length >> 1;
  chunks.push(chunk("IDAT", idat.subarray(0, half)), chunk("IDAT", idat.subarray(half)), chunk("IEND", new Uint8Array(0)));
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const out = new Uint8Array(sig.length + chunks.reduce((s, c) => s + c.length, 0));
  out.set(sig);
  let off = sig.length;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  // The decoder doesn't check CRCs, but write a correct one anyway.
  let crc = 0xffffffff;
  for (let i = 4; i < 8 + data.length; i++) {
    crc ^= out[i]!;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  new DataView(out.buffer).setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0);
  return out;
}

/** Bytes of a binary fixture imported with `?inline` (a data: URL). */
export function inlineBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
