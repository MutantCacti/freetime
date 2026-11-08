import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Two projects, one per Worker, each running in its own Worker config:
// the read-only site (wrangler.toml) and the accounts Worker (wrangler.accounts.toml).
export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    // Tests import files from public/ directly (head.js, app.js, CSS as text).
    publicDir: false as const,
    test: {
      projects: [
        {
          plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.toml" } })],
          publicDir: false as const,
          test: {
            name: "site",
            include: ["test/*.test.ts"],
            // Let `?raw` imports of CSS return the file's text.
            css: true,
          },
        },
        {
          plugins: [
            cloudflareTest({
              wrangler: { configPath: "./wrangler.accounts.toml" },
              miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
            }),
          ],
          publicDir: false as const,
          test: {
            name: "accounts",
            include: ["test/accounts/*.test.ts"],
            setupFiles: ["./test/accounts/apply-migrations.ts"],
            css: true,
          },
        },
      ],
    },
  };
});
