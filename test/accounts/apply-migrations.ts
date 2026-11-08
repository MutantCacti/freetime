import { applyD1Migrations, env } from "cloudflare:test";

type Migrations = Parameters<typeof applyD1Migrations>[1];

// Each test file starts from the migrations in migrations/, as production does.
const testEnv = env as unknown as { DB: D1Database; TEST_MIGRATIONS: Migrations };
await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
