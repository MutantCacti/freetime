// Types for the vendored jpeg-js decoder (jpeg-js-decoder.js), for the options this project uses.
export interface DecodeOptions {
  useTArray?: boolean;
  formatAsRGBA?: boolean;
  tolerantDecoding?: boolean;
  maxResolutionInMP?: number;
  maxMemoryUsageInMB?: number;
}
export interface DecodedJpeg {
  width: number;
  height: number;
  data: Uint8Array;
}
export default function decode(data: Uint8Array | ArrayBuffer, opts?: DecodeOptions): DecodedJpeg;
