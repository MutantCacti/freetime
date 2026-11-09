import { env } from "cloudflare:test";
import { expect, it } from "vitest";

it("has the accounts tables", async () => {
  const rows = await (env as unknown as { DB: D1Database }).DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all<{ name: string }>();
  expect(rows.results.map((r) => r.name)).toEqual(expect.arrayContaining(["users", "sessions", "email_tokens", "attempts"]));
});
