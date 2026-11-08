// Wrangler (and the Workers test pool) import .wasm files as compiled modules.
declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
