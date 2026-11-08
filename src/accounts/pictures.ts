// Profile pictures (ACCOUNTS-SPEC.md §8): PNG or JPEG, at most 2 MB uploaded,
// recognised by their first bytes (never by name or claimed type). What's
// stored in R2, under a random key, is never the upload: it's the centre
// square, area-averaged to at most 128 × 128 and re-encoded as PNG.

import { accentOf } from "./accent";
import { type Grid, decodeJpeg, decodePng } from "./image-decode";

export const PICTURE_MAX_BYTES = 2 * 1024 * 1024;

export type PictureType = "image/png" | "image/jpeg";

/** The image type from the file's first bytes, or null. */
export function sniffPicture(bytes: Uint8Array): PictureType | null {
  const at = (i: number, ...values: number[]) => values.every((v, j) => bytes[i + j] === v);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  // WebP ("RIFF" … "WEBP") isn't accepted: there's no decoder for it here, and an undecoded picture can't be resized.
  return null;
}

/** Where a user's picture is served; the key in the query changes with each upload, so it can be cached for good. */
export function pictureUrl(publicId: string, key: string): string {
  return `/u/${publicId}/picture?v=${encodeURIComponent(key.slice(-8))}`;
}

// ---------------------------------------------------------------- resize and re-encode

/**
 * Decode a picture, keep its centre square area-averaged to at most
 * PICTURE_SIZE pixels a side, and pick its accent. Returns the PNG to store
 * (never the original) and the accent, or null if it can't be decoded.
 */
export async function processPicture(bytes: Uint8Array, type: PictureType): Promise<{ png: Uint8Array; accent: string | null } | null> {
  const grid = type === "image/png" ? await decodePng(bytes) : type === "image/jpeg" ? decodeJpeg(bytes) : null;
  if (!grid) return null;
  return { png: await encodePng(grid), accent: accentOf(grid) };
}

const toGamma8 = (c: number) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)));

/** The grid as an 8-bit RGBA PNG (RGB when fully opaque), each row Sub-filtered, deflated with CompressionStream. */
export async function encodePng(grid: Grid): Promise<Uint8Array> {
  const size = grid.size;
  const opaque = grid.a.every((a, i) => a >= grid.n[i]! - 1e-9);
  const ch = opaque ? 3 : 4;
  const stride = size * ch;
  const raw = new Uint8Array((stride + 1) * size);
  const row = new Uint8Array(stride);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const alpha = grid.a[i]!;
      const n = grid.n[i]! || 1;
      const o = x * ch;
      row[o] = alpha > 0 ? toGamma8(grid.r[i]! / alpha) : 0;
      row[o + 1] = alpha > 0 ? toGamma8(grid.g[i]! / alpha) : 0;
      row[o + 2] = alpha > 0 ? toGamma8(grid.b[i]! / alpha) : 0;
      if (!opaque) row[o + 3] = Math.round((255 * alpha) / n);
    }
    const out = y * (stride + 1);
    raw[out] = 1; // Sub: each byte minus the one a pixel to its left
    for (let k = 0; k < stride; k++) raw[out + 1 + k] = (row[k]! - (k >= ch ? row[k - ch]! : 0)) & 0xff;
  }
  const idat = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, size);
  dv.setUint32(4, size);
  ihdr.set([8, opaque ? 2 : 6, 0, 0, 0], 8);
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let off = 0;
  for (const p of parts) {
    png.set(p, off);
    off += p.length;
  }
  return png;
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < 8 + data.length; i++) crc = CRC_TABLE[(crc ^ out[i]!) & 0xff]! ^ (crc >>> 8);
  dv.setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0);
  return out;
}
