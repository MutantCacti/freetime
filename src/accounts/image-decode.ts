// Image decoding for profile pictures (pictures.ts). Workers have no image
// decoder, so:
//   - PNG: inflated with DecompressionStream("deflate"), scanline filters undone
//     row by row (only two rows held at once). 1, 2, 4, 8 and 16 bits per
//     sample; greyscale, RGB, palette, grey + alpha, RGBA. Interlaced (Adam7)
//     PNGs are refused. An animated PNG gives its first (default) image.
//   - JPEGs at least 8 × PICTURE_SIZE on their short side (or over
//     FULL_JPEG_PIXELS): only the DC coefficient of each 8×8 block is decoded
//     (the block's average colour), which is the picture at 1/8 scale,
//     area-averaged, with no IDCT and little memory.
//   - Smaller JPEGs: decoded in full by the vendored jpeg-js. Huffman baseline and progressive (first
//     DC scan; refinement scans only add precision). Arithmetic coding,
//     lossless, 12-bit and CMYK are refused.
//   - WebP isn't decoded, so it isn't accepted.
// Every decoder writes straight into a Grid: the centre square of the picture,
// area-averaged down to at most PICTURE_SIZE pixels a side, in linear light,
// with alpha. A refusal or a broken file gives null.

import decodeFull from "../vendor/jpeg-js-decoder.js";

/** Side of the stored square picture, in pixels. Never more than 256. */
export const PICTURE_SIZE = 128;
/** Pictures with more pixels than this are refused (a 2 MB file can still claim huge sizes). */
export const MAX_PIXELS = 40_000_000;
/** Small JPEGs up to this many pixels are decoded in full; anything larger by its block averages. */
export const FULL_JPEG_PIXELS = 4_000_000;

const SRGB_TO_LINEAR = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

/**
 * The centre square of a source image, area-averaged into size × size cells.
 * Colours are linear light premultiplied by alpha; `a` is summed alpha and
 * `n` the number of source pixels that landed in each cell.
 */
export class Grid {
  readonly size: number;
  readonly r: Float64Array;
  readonly g: Float64Array;
  readonly b: Float64Array;
  readonly a: Float64Array;
  readonly n: Float64Array;
  private readonly side: number;
  private readonly ox: number;
  private readonly oy: number;

  constructor(srcWidth: number, srcHeight: number, maxSize = PICTURE_SIZE) {
    this.side = Math.min(srcWidth, srcHeight);
    this.ox = Math.floor((srcWidth - this.side) / 2);
    this.oy = Math.floor((srcHeight - this.side) / 2);
    this.size = Math.max(1, Math.min(this.side, maxSize));
    const cells = this.size * this.size;
    this.r = new Float64Array(cells);
    this.g = new Float64Array(cells);
    this.b = new Float64Array(cells);
    this.a = new Float64Array(cells);
    this.n = new Float64Array(cells);
  }

  /** Add one source pixel (8-bit sRGB, alpha 0–1) at source position (x, y); outside the square is ignored. */
  add8(x: number, y: number, r: number, g: number, b: number, alpha = 1): void {
    const cx = x - this.ox, cy = y - this.oy;
    if (cx < 0 || cy < 0 || cx >= this.side || cy >= this.side) return;
    const i = Math.floor((cy * this.size) / this.side) * this.size + Math.floor((cx * this.size) / this.side);
    this.r[i]! += SRGB_TO_LINEAR[r]! * alpha;
    this.g[i]! += SRGB_TO_LINEAR[g]! * alpha;
    this.b[i]! += SRGB_TO_LINEAR[b]! * alpha;
    this.a[i]! += alpha;
    this.n[i]! += 1;
  }

  /** Whether a source row or column is inside the square (decoders skip the rest). */
  wantsRow(y: number): boolean {
    return y >= this.oy && y < this.oy + this.side;
  }

  /** Every cell got at least one pixel (false for a picture cut short). */
  complete(): boolean {
    return this.n.every((v) => v > 0);
  }
}

/** On large images only every `step`-th pixel and row is added: still many samples per cell. */
function sampleStep(w: number, h: number): number {
  return Math.max(1, Math.floor(Math.min(w, h) / (PICTURE_SIZE * 8)));
}

// ---------------------------------------------------------------- PNG

export async function decodePng(bytes: Uint8Array): Promise<Grid | null> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  let ihdr: { w: number; h: number; depth: number; type: number; interlace: number } | null = null;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (pos + 8 <= bytes.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    if (data.length < len) return null;
    if (type === "IHDR") {
      ihdr = { w: view.getUint32(pos + 8), h: view.getUint32(pos + 12), depth: data[8]!, type: data[9]!, interlace: data[12]! };
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (!ihdr || ihdr.interlace !== 0 || !idat.length) return null;
  const { w, h, depth, type } = ihdr;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type as 0 | 2 | 3 | 4 | 6];
  if (!channels || !w || !h || w * h > MAX_PIXELS) return null;
  const okDepth = type === 0 || type === 3 ? [1, 2, 4, 8, 16].includes(depth) && !(type === 3 && depth === 16) : depth === 8 || depth === 16;
  if (!okDepth || (type === 3 && !palette)) return null;

  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const stride = Math.ceil((w * bitsPerPixel) / 8);
  const grid = new Grid(w, h);
  const step = sampleStep(w, h);
  const greyMax = (1 << Math.min(depth, 8)) - 1;

  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  let y = 0;
  const pixel = (row: Uint8Array, x: number): [number, number, number, number] => {
    if (depth < 8) {
      const bit = x * depth;
      const v = (row[bit >> 3]! >> (8 - depth - (bit & 7))) & greyMax;
      if (type === 3) return [palette![v * 3] ?? 0, palette![v * 3 + 1] ?? 0, palette![v * 3 + 2] ?? 0, trns && v < trns.length ? trns[v]! / 255 : 1];
      const g = Math.round((v * 255) / greyMax);
      return [g, g, g, 1];
    }
    const o = x * bpp;
    const s = depth === 16 ? 2 : 1; // 16-bit: the high byte is enough here.
    switch (type) {
      case 0: return [row[o]!, row[o]!, row[o]!, 1];
      case 2: return [row[o]!, row[o + s]!, row[o + 2 * s]!, 1];
      case 3: {
        const v = row[o]!;
        return [palette![v * 3] ?? 0, palette![v * 3 + 1] ?? 0, palette![v * 3 + 2] ?? 0, trns && v < trns.length ? trns[v]! / 255 : 1];
      }
      case 4: return [row[o]!, row[o]!, row[o]!, row[o + s]! / 255];
      default: return [row[o]!, row[o + s]!, row[o + 2 * s]!, row[o + 3 * s]! / 255];
    }
  };
  const unfilter = (filter: number): boolean => {
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      let add: number;
      switch (filter) {
        case 0: add = 0; break;
        case 1: add = a; break;
        case 2: add = b; break;
        case 3: add = (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: return false;
      }
      cur[i] = (cur[i]! + add) & 0xff;
    }
    return true;
  };

  // Inflate as a stream and undo filters a row at a time.
  const stream = new Blob(idat).stream().pipeThrough(new DecompressionStream("deflate"));
  const reader = stream.getReader();
  let pending = new Uint8Array(0);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const merged = new Uint8Array(pending.length + value.length);
      merged.set(pending);
      merged.set(value, pending.length);
      let off = 0;
      while (y < h && merged.length - off >= stride + 1) {
        const filter = merged[off]!;
        cur.set(merged.subarray(off + 1, off + 1 + stride));
        if (!unfilter(filter)) return null;
        if (y % step === 0 && grid.wantsRow(y)) {
          for (let x = 0; x < w; x += step) {
            const [r, g, b, a] = pixel(cur, x);
            grid.add8(x, y, r, g, b, a);
          }
        }
        [prev, cur] = [cur, prev];
        y++;
        off += stride + 1;
      }
      pending = merged.slice(off);
      if (y >= h) break;
    }
  } catch {
    return null;
  } finally {
    reader.cancel().catch(() => {});
  }
  return y >= h && grid.complete() ? grid : null;
}

// ---------------------------------------------------------------- JPEG (DC only)

interface Huffman {
  /** For each code length 1–16: the first code, and the index of its first value. */
  mincode: Int32Array;
  maxcode: Int32Array;
  valptr: Int32Array;
  values: Uint8Array;
}

function buildHuffman(counts: Uint8Array, values: Uint8Array): Huffman {
  const mincode = new Int32Array(17), maxcode = new Int32Array(18).fill(-1), valptr = new Int32Array(17);
  let code = 0, k = 0;
  for (let len = 1; len <= 16; len++) {
    valptr[len] = k;
    mincode[len] = code;
    code += counts[len - 1]!;
    k += counts[len - 1]!;
    maxcode[len] = counts[len - 1] ? code - 1 : -1;
    code <<= 1;
  }
  return { mincode, maxcode, valptr, values };
}

interface Component {
  id: number;
  h: number;
  v: number;
  tq: number;
  blocksX: number;
  blocksY: number;
  ownX: number;
  ownY: number;
  dc: Int32Array;
  pred: number;
  td: number;
  ta: number;
}

class JpegError extends Error {}

export function decodeJpeg(bytes: Uint8Array): Grid | null {
  try {
    const size = jpegSize(bytes);
    if (!size || size.w * size.h > MAX_PIXELS) return null;
    // Block averages are already area-averaged at 1/8 scale; use them whenever they're
    // at least the stored size. Smaller pictures are decoded in full (capped in pixels).
    if (Math.min(size.w, size.h) < 8 * PICTURE_SIZE && size.w * size.h <= FULL_JPEG_PIXELS) {
      const img = decodeFull(bytes, { useTArray: true, formatAsRGBA: true, tolerantDecoding: false, maxResolutionInMP: FULL_JPEG_PIXELS / 1e6, maxMemoryUsageInMB: 96 });
      const grid = new Grid(img.width, img.height);
      const step = sampleStep(img.width, img.height);
      for (let y = 0; y < img.height; y += step) {
        if (!grid.wantsRow(y)) continue;
        for (let x = 0; x < img.width; x += step) {
          const o = (y * img.width + x) * 4;
          grid.add8(x, y, img.data[o]!, img.data[o + 1]!, img.data[o + 2]!);
        }
      }
      return grid.complete() ? grid : null;
    }
    return decodeJpegDc(bytes);
  } catch {
    return null;
  }
}

/** Width and height from the first SOF marker, without decoding. */
export function jpegSize(data: Uint8Array): { w: number; h: number } | null {
  let pos = 2;
  while (pos + 9 < data.length) {
    if (data[pos] !== 0xff) return null;
    const marker = data[pos + 1]!;
    if (marker === 0xff) { pos++; continue; }
    const len = (data[pos + 2]! << 8) | data[pos + 3]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: (data[pos + 5]! << 8) | data[pos + 6]!, w: (data[pos + 7]! << 8) | data[pos + 8]! };
    }
    pos += 2 + len;
  }
  return null;
}

function decodeJpegDc(data: Uint8Array): Grid | null {
  const q: Uint16Array[] = [];
  const dcTables: Huffman[] = [];
  const acTables: Huffman[] = [];
  let comps: Component[] = [];
  let width = 0, height = 0, hmax = 1, vmax = 1, mcusX = 0, mcusY = 0;
  let progressive = false;
  let restart = 0;
  let adobeTransform = -1;
  let pos = 2;
  const u16 = (i: number) => (data[i]! << 8) | data[i + 1]!;

  while (pos < data.length) {
    if (data[pos] !== 0xff) { pos++; continue; }
    const marker = data[pos + 1]!;
    pos += 2;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) { if (marker === 0xff) pos--; continue; }
    if (marker === 0xd9) break;
    const len = u16(pos);
    const seg = data.subarray(pos + 2, pos + len);
    if (seg.length < len - 2) throw new JpegError("truncated");
    switch (marker) {
      case 0xdb: { // DQT
        let i = 0;
        while (i < seg.length) {
          const pq = seg[i]! >> 4, tq = seg[i]! & 15;
          const t = new Uint16Array(64);
          for (let k = 0; k < 64; k++) t[k] = pq ? (seg[i + 1 + 2 * k]! << 8) | seg[i + 2 + 2 * k]! : seg[i + 1 + k]!;
          q[tq] = t;
          i += 1 + (pq ? 128 : 64);
        }
        break;
      }
      case 0xc4: { // DHT
        let i = 0;
        while (i < seg.length) {
          const tc = seg[i]! >> 4, th = seg[i]! & 15;
          const counts = seg.subarray(i + 1, i + 17);
          const total = counts.reduce((s, n) => s + n, 0);
          const table = buildHuffman(counts, seg.slice(i + 17, i + 17 + total));
          (tc === 0 ? dcTables : acTables)[th] = table;
          i += 17 + total;
        }
        break;
      }
      case 0xc0: case 0xc1: case 0xc2: { // SOF: baseline, extended, progressive (Huffman)
        if (seg[0] !== 8) return null;
        progressive = marker === 0xc2;
        height = u16(pos + 3);
        width = u16(pos + 5);
        const n = seg[5]!;
        if (!width || !height || width * height > MAX_PIXELS || (n !== 1 && n !== 3)) return null;
        comps = [];
        for (let c = 0; c < n; c++) {
          const o = 6 + 3 * c;
          comps.push({ id: seg[o]!, h: seg[o + 1]! >> 4, v: seg[o + 1]! & 15, tq: seg[o + 2]!, blocksX: 0, blocksY: 0, ownX: 0, ownY: 0, dc: new Int32Array(0), pred: 0, td: 0, ta: 0 });
        }
        hmax = Math.max(...comps.map((c) => c.h));
        vmax = Math.max(...comps.map((c) => c.v));
        mcusX = Math.ceil(width / (8 * hmax));
        mcusY = Math.ceil(height / (8 * vmax));
        for (const c of comps) {
          if (!c.h || !c.v) return null;
          c.blocksX = mcusX * c.h;
          c.blocksY = mcusY * c.v;
          // A single-component scan codes only the component's own blocks, not the MCU padding.
          c.ownX = Math.ceil(Math.ceil((width * c.h) / hmax) / 8);
          c.ownY = Math.ceil(Math.ceil((height * c.v) / vmax) / 8);
          c.dc = new Int32Array(c.blocksX * c.blocksY);
        }
        break;
      }
      case 0xc3: case 0xc5: case 0xc6: case 0xc7: case 0xc9: case 0xca: case 0xcb: case 0xcd: case 0xce: case 0xcf:
        return null; // lossless, hierarchical or arithmetic-coded
      case 0xdd: restart = u16(pos + 2); break;
      case 0xee: // Adobe APP14: its transform flag says whether 3 components are YCbCr
        if (seg.length >= 12 && String.fromCharCode(...seg.subarray(0, 5)) === "Adobe") adobeTransform = seg[11]!;
        break;
      case 0xda: { // SOS
        if (!comps.length) return null;
        const ns = seg[0]!;
        const scomps: Component[] = [];
        for (let i = 0; i < ns; i++) {
          const c = comps.find((x) => x.id === seg[1 + 2 * i]);
          if (!c) return null;
          c.td = seg[2 + 2 * i]! >> 4;
          c.ta = seg[2 + 2 * i]! & 15;
          scomps.push(c);
        }
        const ss = seg[1 + 2 * ns]!, se = seg[2 + 2 * ns]!, ah = seg[3 + 2 * ns]! >> 4, al = seg[3 + 2 * ns]! & 15;
        pos += len;
        // Progressive: only the first DC scan matters. Everything else is skipped to the next marker.
        const useful = progressive ? ss === 0 && ah === 0 : true;
        pos = useful ? decodeScan(data, pos, scomps, progressive, al, se, restart, mcusX, mcusY, dcTables, acTables) : skipScan(data, pos);
        continue;
      }
    }
    pos += len;
  }
  if (!comps.length || comps.some((c) => !q[c.tq])) return null;
  if (comps.length === 3 && adobeTransform === 0) return null; // RGB-coded JPEG: rare, not worth a branch

  // One output pixel per luma-sized block: the block's average.
  const bw = Math.ceil(width / 8), bh = Math.ceil(height / 8);
  const grid = new Grid(bw, bh);
  const level = (c: Component, bx: number, by: number) => {
    const x = Math.min(c.blocksX - 1, Math.floor((bx * c.h) / hmax));
    const y = Math.min(c.blocksY - 1, Math.floor((by * c.v) / vmax));
    return (c.dc[y * c.blocksX + x]! * q[c.tq]![0]!) / 8 + 128;
  };
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  for (let by = 0; by < bh; by++) {
    if (!grid.wantsRow(by)) continue;
    for (let bx = 0; bx < bw; bx++) {
      const Y = level(comps[0]!, bx, by);
      if (comps.length === 1) {
        const g = clamp(Y);
        grid.add8(bx, by, g, g, g);
        continue;
      }
      const cb = level(comps[1]!, bx, by) - 128, cr = level(comps[2]!, bx, by) - 128;
      grid.add8(bx, by, clamp(Y + 1.402 * cr), clamp(Y - 0.344136 * cb - 0.714136 * cr), clamp(Y + 1.772 * cb));
    }
  }
  return grid.complete() ? grid : null;
}

/** Position just after the entropy-coded data that starts at `pos`. */
function skipScan(data: Uint8Array, pos: number): number {
  while (pos < data.length - 1) {
    if (data[pos] === 0xff && data[pos + 1] !== 0 && !(data[pos + 1]! >= 0xd0 && data[pos + 1]! <= 0xd7)) return pos;
    pos++;
  }
  return data.length;
}

function decodeScan(
  data: Uint8Array, start: number, scomps: Component[], progressive: boolean, al: number, se: number,
  restart: number, mcusX: number, mcusY: number, dcTables: Huffman[], acTables: Huffman[],
): number {
  let pos = start, bitBuf = 0, bitCount = 0;
  const readBit = (): number => {
    if (bitCount === 0) {
      if (pos >= data.length) return 0;
      let b = data[pos]!;
      if (b === 0xff) {
        const next = data[pos + 1]!;
        if (next === 0) pos += 2;
        else return 0; // a marker: pad with zeros
      } else pos++;
      bitBuf = b;
      bitCount = 8;
    }
    bitCount--;
    return (bitBuf >> bitCount) & 1;
  };
  const receive = (n: number): number => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | readBit();
    return v;
  };
  const extend = (v: number, n: number) => (n && v < 1 << (n - 1) ? v - (1 << n) + 1 : v);
  const decode = (t: Huffman | undefined): number => {
    if (!t) throw new JpegError("missing table");
    let code = 0;
    for (let len = 1; len <= 16; len++) {
      code = (code << 1) | readBit();
      if (code <= t.maxcode[len]!) return t.values[t.valptr[len]! + code - t.mincode[len]!]!;
    }
    throw new JpegError("bad code");
  };
  const block = (c: Component, bx: number, by: number) => {
    const s = decode(dcTables[c.td]);
    c.pred += extend(receive(s), s);
    if (bx < c.blocksX && by < c.blocksY) c.dc[by * c.blocksX + bx] = c.pred << al;
    if (progressive) return; // a DC scan has no AC data
    for (let k = 1; k <= se; ) {
      const rs = decode(acTables[c.ta]);
      const r = rs >> 4, sz = rs & 15;
      if (sz === 0) {
        if (r !== 15) break;
        k += 16;
        continue;
      }
      k += r;
      receive(sz);
      k++;
    }
  };
  const single = scomps.length === 1;
  const c0 = scomps[0]!;
  const across = single ? c0.ownX : mcusX;
  const total = single ? c0.ownX * c0.ownY : mcusX * mcusY;
  for (const c of scomps) c.pred = 0;
  for (let n = 0; n < total; n++) {
    if (restart && n > 0 && n % restart === 0) {
      // Byte-align and step over the RSTn marker; predictions start again.
      bitCount = 0;
      while (pos < data.length - 1 && !(data[pos] === 0xff && data[pos + 1]! >= 0xd0 && data[pos + 1]! <= 0xd7)) pos++;
      pos += 2;
      for (const c of scomps) c.pred = 0;
    }
    const mx = n % across, my = (n / across) | 0;
    if (single) block(c0, mx, my);
    else for (const c of scomps) for (let v = 0; v < c.v; v++) for (let h = 0; h < c.h; h++) block(c, mx * c.h + h, my * c.v + v);
  }
  return skipScan(data, pos);
}
