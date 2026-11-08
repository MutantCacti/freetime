// Types for the vendored Emscripten factory (webp_dec.js), for what src/accounts/webp.ts uses.
export interface WebPModule {
  decode(data: BufferSource): { data: Uint8ClampedArray; width: number; height: number } | null;
  version(): number;
}
export default function factory(options: {
  noInitialRun?: boolean;
  instantiateWasm?: (imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance) => void) => WebAssembly.Exports;
}): Promise<WebPModule>;
