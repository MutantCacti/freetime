import { describe, expect, it } from "vitest";
import {
  commitOfMessage,
  depsState,
  isUnsafeMigration,
  parseD1List,
  parseLatestDeployment,
  parseMigrationsList,
  parseSecretList,
  parseVersionId,
  parseWhoami,
} from "../../scripts/ft/checks.mjs";
import { ROOT, fixture, makeRepo } from "./helpers.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

describe("parsers for wrangler 4.154.0 output", () => {
  it("whoami", () => {
    expect(parseWhoami(fixture("whoami-logged-out.txt"))).toEqual({ loggedIn: false, email: null });
    // Logged-in wording (unverified: not capturable without logging in).
    expect(parseWhoami("👋 You are logged in with an OAuth Token, associated with the email maxence@example.com.")).toEqual({ loggedIn: true, email: "maxence@example.com" });
    expect(parseWhoami("✘ [ERROR] fetch failed")).toEqual({ loggedIn: null, email: null });
  });

  it("d1 migrations list (captured locally)", () => {
    expect(parseMigrationsList(fixture("migrations-list-pending.txt"))).toEqual(["0001_accounts.sql"]);
    expect(parseMigrationsList(fixture("migrations-list-none.txt"))).toEqual([]);
    expect(parseMigrationsList("✘ [ERROR] something")).toBeNull();
  });

  it("secret list keeps names and drops everything else", () => {
    const names = parseSecretList('[{"name":"ICAL_URL","type":"secret_text","value":"FAKE-PLANTED-VALUE"}]');
    expect(names).toEqual(["ICAL_URL"]);
    expect(JSON.stringify(names)).not.toContain("FAKE-PLANTED-VALUE");
    expect(parseSecretList("[]")).toEqual([]);
    expect(parseSecretList("✘ [ERROR] This Worker does not exist")).toBeNull();
  });

  it("d1 list, deployments list and the deploy output", () => {
    expect(parseD1List('[{"uuid":"abc","name":"freetime-accounts"}]')).toEqual([{ id: "abc", name: "freetime-accounts" }]);
    const d = parseLatestDeployment(
      JSON.stringify([
        { created_on: "2026-11-01T10:00:00Z", annotations: { "workers/message": "1111111 main" } },
        { created_on: "2026-11-08T14:03:00Z", annotations: { "workers/message": "5795eac main" } },
      ]),
    );
    expect(d).toEqual({ when: "2026-11-08T14:03:00Z", message: "5795eac main" });
    expect(commitOfMessage(d?.message ?? null)).toBe("5795eac");
    expect(commitOfMessage("deployed from the dashboard")).toBeNull();
    expect(parseVersionId("Uploaded freetime (3.2 sec)\nCurrent Version ID: 1a2b3c4d-0000-4000-8000-000000000000")).toBe("1a2b3c4d-0000-4000-8000-000000000000");
  });
});

describe("migration safety (DEV-SPEC.md §5.2)", () => {
  it.each([
    "DROP TABLE users;",
    "drop index idx_x;",
    "DELETE FROM sessions WHERE 1;",
    "ALTER TABLE users RENAME TO people;",
    "ALTER TABLE users RENAME COLUMN a TO b;",
    "ALTER TABLE users DROP COLUMN bio;",
  ])("stops on %s", (sql) => {
    expect(isUnsafeMigration(sql)).toBe(true);
  });

  it.each([
    "CREATE TABLE x (id INTEGER PRIMARY KEY);",
    "ALTER TABLE users ADD COLUMN bio TEXT;",
    "CREATE INDEX i ON users (email);",
    "CREATE TABLE s (user_id INTEGER REFERENCES users ON DELETE CASCADE);",
    "-- DROP TABLE users; (a comment)\nCREATE TABLE y (id INTEGER);",
  ])("passes %s", (sql) => {
    expect(isUnsafeMigration(sql)).toBe(false);
  });

  it("passes every migration in the repository", () => {
    const dir = join(ROOT, "migrations");
    for (const f of readdirSync(dir)) expect(isUnsafeMigration(readFileSync(join(dir, f), "utf8")), f).toBe(false);
  });
});

describe("the deps check", () => {
  it("passes on this checkout's node_modules", () => {
    expect(depsState(ROOT)).toEqual({ ok: true, problems: [] });
  });

  it("fails without wrangler", () => {
    const dir = makeRepo();
    expect(depsState(join(dir, "nowhere")).ok).toBe(false);
  });
});
