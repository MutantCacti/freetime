import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// One project per Worker, each running in its own Worker config: the read-only
// site (wrangler.toml) and the accounts Worker (wrangler.accounts.toml). A third,
// `scripts`, tests ./ft in plain Node.
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
              // A fixed test key: 32 bytes, base64url. Production's is a secret.
              miniflare: { bindings: { TEST_MIGRATIONS: migrations, ACCOUNTS_KEY: "dGVzdC1rZXktdGVzdC1rZXktdGVzdC1rZXktdGVzdDE" } },
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
        {
          // ft, the developer script (DEV-SPEC.md): plain Node, a fake runner, no network.
          test: {
            name: "scripts",
            include: ["test/scripts/*.test.mjs"],
            environment: "node",
          },
        },
      ],
    },
  };
});
