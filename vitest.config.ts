import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
    }),
  ],
  // Tests import files from public/ directly (head.js, app.js, CSS as text).
  publicDir: false,
  test: {
    // Let `?raw` imports of CSS return the file's text.
    css: true,
  },
});
