// Profile pictures (ACCOUNTS-SPEC.md §8): PNG, JPEG or WebP, at most 2 MB,
// recognised by their first bytes (never by name or claimed type), stored in R2
// under a random key.

export const PICTURE_MAX_BYTES = 2 * 1024 * 1024;

export type PictureType = "image/png" | "image/jpeg" | "image/webp";

/** The image type from the file's first bytes, or null. */
export function sniffPicture(bytes: Uint8Array): PictureType | null {
  const at = (i: number, ...values: number[]) => values.every((v, j) => bytes[i + j] === v);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp"; // "RIFF" … "WEBP"
  return null;
}

/** Where a user's picture is served; the key in the query changes with each upload, so it can be cached for good. */
export function pictureUrl(publicId: string, key: string): string {
  return `/u/${publicId}/picture?v=${encodeURIComponent(key.slice(-8))}`;
}
