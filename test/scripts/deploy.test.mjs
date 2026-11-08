import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HASHES_FILE, loadHashes, recordDeployed, saveHashes } from "../../scripts/ft/secrets.mjs";
import { GOOD_SECRETS, SECRET_VALUES, ft, healthy, liveFetch, makeRepo } from "./helpers.mjs";

/** Write calls: anything that changes production. */
const writes = (/** @type {{ program: string, args: string[] }[]} */ calls) =>
  calls.filter((c) => c.program === "wrangler" && ((c.args[0] === "deploy" && !c.args.includes("--dry-run")) || (c.args[1] === "migrations" && c.args[2] === "apply" && c.args.includes("--remote")) || (c.args[0] === "secret" && c.args[1] === "put")));

const noSecretsAnywhere = (/** @type {{ output: string, calls: { args: string[] }[] }} */ r) => {
  for (const v of SECRET_VALUES) {
    expect(r.output, "output").not.toContain(v);
    for (const c of r.calls) expect(c.args.join(" "), "arguments").not.toContain(v);
  }
};

describe("./ft deploy --dry-run", () => {
  it("runs every check, prints the plan and writes nothing", async () => {
    const dir = makeRepo({ secrets: GOOD_SECRETS });
    const r = await ft(["deploy", "--dry-run"], { root: dir, handler: healthy({ pending: ["0002_profiles.sql"] }), deps: { fetch: liveFetch() } });
    expect(r.code, r.output).toBe(0);
    expect(writes(r.calls)).toEqual([]);
    expect(r.output).toContain("Dry run: nothing was changed.");
    expect(r.output).toMatch(/1 {2}migrate {3}freetime-accounts \(remote\): 0002_profiles\.sql/);
    expect(r.output.indexOf("deploy    freetime-accounts")).toBeLessThan(r.output.indexOf("deploy    freetime "));
    // Both Workers were built, with their secrets on stdin only.
    const builds = r.calls.filter((c) => c.args[0] === "deploy");
    expect(builds).toHaveLength(2);
    for (const b of builds) {
      expect(b.args).toContain("--dry-run");
      expect(b.args.slice(-2)).toEqual(["--secrets-file", "/dev/stdin"]);
    }
    expect(Object.keys(JSON.parse(builds[0]?.input ?? "{}"))).toEqual(["RESEND_API_KEY", "ACCOUNTS_KEY"]);
    expect(Object.keys(JSON.parse(builds[1]?.input ?? "{}"))).toEqual(["ICAL_URL"]);
    noSecretsAnywhere(r);
  });

  it("--only site touches neither D1 nor the accounts Worker", async () => {
    const dir = makeRepo({ databaseId: "00000000-0000-0000-0000-000000000000", secrets: "[site]\nICAL_URL=https://calendar.example/FAKE-ICAL-SECRET-1.ics\n" });
    const r = await ft(["deploy", "--only", "site", "--dry-run"], { root: dir, handler: healthy() });
    expect(r.code, r.output).toBe(0);
    expect(r.calls.filter((c) => c.args[0] === "d1" || c.args.includes("wrangler.accounts.toml"))).toEqual([]);
  });
});

describe("./ft deploy pre-flight stops before any write", () => {
  it.each([
    ["a dirty tree", { handler: healthy({ dirty: true }) }, 1, "tree"],
    ["another branch", { handler: healthy({ branch: "feature" }) }, 1, "You're on feature, not main"],
    ["a failing test", { handler: healthy({ fail: (c) => c.program === "npm" && c.args[0] === "test" }) }, 1, "npm test failed"],
    ["a failing build", { handler: healthy({ fail: (c) => c.args.includes("--dry-run") }) }, 1, "doesn't build"],
    ["not logged in", { handler: (/** @type {any} */ c) => (c.args[0] === "whoami" ? { stdout: "You are not authenticated." } : healthy()(c)) }, 3, "npx wrangler login"],
    ["an unsafe migration", { handler: healthy({ pending: ["0002_drop.sql"] }), repo: { migrations: { "0002_drop.sql": "DROP TABLE sessions;" } } }, 1, "removes or renames data"],
    ["a database id Cloudflare doesn't know", { handler: (/** @type {any} */ c) => (c.args.join(" ") === "d1 list --json" ? { stdout: "[]" } : healthy()(c)) }, 3, "No D1 database has the id"],
    ["no DNS", { handler: healthy(), deps: { resolves: async () => false } }, 3, "doesn't resolve"],
  ])("%s", async (_, o, code, text) => {
    const dir = makeRepo({ secrets: GOOD_SECRETS, ...(/** @type {any} */ (o).repo ?? {}) });
    const r = await ft(["deploy", "--yes"], { root: dir, handler: o.handler, deps: /** @type {any} */ (o).deps });
    expect(r.code, r.output).toBe(code);
    expect(r.output).toContain(text);
    expect(writes(r.calls)).toEqual([]);
    noSecretsAnywhere(r);
  });

  it("the placeholder database_id is a setup step (exit 3)", async () => {
    const dir = makeRepo({ databaseId: "00000000-0000-0000-0000-000000000000", secrets: GOOD_SECRETS });
    const r = await ft(["deploy", "--yes"], { root: dir, handler: healthy() });
    expect(r.code).toBe(3);
    expect(r.output).toContain("npx wrangler d1 create freetime-accounts");
    expect(writes(r.calls)).toEqual([]);
  });

  it("no .secrets, or a missing value, is a setup step (exit 3)", async () => {
    const none = await ft(["deploy", "--yes"], { root: makeRepo(), handler: healthy() });
    expect(none.code).toBe(3);
    expect(none.output).toContain("Copy .secrets.example to .secrets");
    const partial = await ft(["deploy", "--yes"], { root: makeRepo({ secrets: GOOD_SECRETS.replace(/^ACCOUNTS_KEY=.*$/m, "") }), handler: healthy() });
    expect(partial.code).toBe(3);
    expect(partial.output).toContain("./ft secrets --generate ACCOUNTS_KEY");
    expect(writes(partial.calls)).toEqual([]);
  });

  it("a .secrets that git doesn't ignore stops it", async () => {
    const dir = makeRepo({ secrets: GOOD_SECRETS });
    const r = await ft(["deploy", "--yes"], { root: dir, handler: (c) => (c.args[0] === "check-ignore" ? { code: 1 } : healthy()(c)) });
    expect(r.code).toBe(1);
    expect(r.output).toContain("isn't ignored by git");
  });

  it("a changed ACCOUNTS_KEY stops it", async () => {
    const dir = makeRepo({ secrets: GOOD_SECRETS });
    const hashes = loadHashes(dir);
    recordDeployed(hashes, "accounts", { ACCOUNTS_KEY: "the-old-key-value" }, ["ACCOUNTS_KEY"]);
    saveHashes(dir, hashes);
    const r = await ft(["deploy", "--yes"], { root: dir, handler: healthy() });
    expect(r.code).toBe(1);
    expect(r.output).toContain("ft never replaces it");
    expect(writes(r.calls)).toEqual([]);
  });

  it("no terminal and no --yes: stops before asking", async () => {
    const dir = makeRepo({ secrets: GOOD_SECRETS });
    const r = await ft(["deploy"], { root: dir, handler: healthy() });
    expect(r.code).toBe(1);
    expect(r.output).toContain("there's no terminal to ask");
    expect(writes(r.calls)).toEqual([]);
  });

  it("answering no deploys nothing (exit 130)", async () => {
    const dir = makeRepo({ secrets: GOOD_SECRETS });
    const r = await ft(["deploy"], { root: dir, handler: healthy(), deps: { stdinIsTTY: true, ask: async () => "" } });
    expect(r.code).toBe(130);
    expect(writes(r.calls)).toEqual([]);
  });
});

describe("./ft deploy writes", () => {
  it("migrates, deploys accounts then the site with their secrets on stdin, then checks the live site", async () => {
    const dir = makeRepo({ secrets: GOOD_SECRETS });
    const fetch = liveFetch();
    const r = await ft(["deploy", "--yes"], { root: dir, handler: healthy({ pending: ["0002_profiles.sql"] }), deps: { fetch } });
    expect(r.code, r.output).toBe(0);
    const w = writes(r.calls);
    expect(w.map((c) => c.args.slice(0, 3).join(" "))).toEqual(["d1 migrations apply", "deploy -c wrangler.accounts.toml", "deploy --env= --message"]);
    expect(w[1]?.args).toEqual(["deploy", "-c", "wrangler.accounts.toml", "--env=", "--message", "abc1234 main", "--secrets-file", "/dev/stdin"]);
    expect(JSON.parse(w[1]?.input ?? "")).toEqual({ RESEND_API_KEY: "re_FAKE_RESEND_SECRET_123456", ACCOUNTS_KEY: "FAKE_ACCOUNTS_KEY_abcdefghijklmnopqrstuvwxyz0123" });
    expect(Object.keys(JSON.parse(w[2]?.input ?? ""))).toEqual(["ICAL_URL"]);
    expect(fetch.seen).toHaveLength(12);
    expect(r.output).toContain("12 of 12 checks passed");
    expect(r.output).toContain("Now check by hand");
    noSecretsAnywhere(r);
    // The hashes of what was deployed are kept, not the values.
    const hashes = readFileSync(join(dir, HASHES_FILE), "utf8");
    for (const v of SECRET_VALUES) expect(hashes).not.toContain(v);
  });

  it("a failed accounts deploy leaves the site untouched; with no migration, nothing changed (exit 1)", async () => {
    const dir = makeRepo({ secrets: GOOD_SECRETS });
    const r = await ft(["deploy", "--yes"], { root: dir, handler: healthy({ fail: (c) => c.args[0] === "deploy" && !c.args.includes("--dry-run") && c.args.includes("wrangler.accounts.toml") }) });
    expect(r.code).toBe(1);
    expect(r.output).toContain("Nothing in production was changed.");
    expect(writes(r.calls).filter((c) => !c.args.includes("wrangler.accounts.toml"))).toEqual([]);
  });

  it("a failed site deploy after accounts: DEPLOY INCOMPLETE, exit 4, rollback printed not run", async () => {
    const dir = makeRepo({ secrets: GOOD_SECRETS });
    const r = await ft(["deploy", "--yes"], { root: dir, handler: healthy({ fail: (c) => c.args[0] === "deploy" && !c.args.includes("--dry-run") && !c.args.includes("wrangler.accounts.toml") }) });
    expect(r.code).toBe(4);
    expect(r.output).toContain("DEPLOY INCOMPLETE: The deploy of freetime failed.");
    expect(r.output).toContain("freetime-accounts   new version 1a2b3c4d");
    expect(r.output).toContain("freetime            unchanged (the previous version)");
    expect(r.output).toContain("./ft deploy --only site");
    expect(r.output).toContain("npx wrangler rollback -c wrangler.accounts.toml");
    expect(r.calls.some((c) => c.args.includes("rollback"))).toBe(false);
  });

  it("a failed migration: exit 4, no Worker deployed", async () => {
    const dir = makeRepo({ secrets: GOOD_SECRETS });
    const r = await ft(["deploy", "--yes"], { root: dir, handler: healthy({ pending: ["0002_x.sql"], fail: (c) => c.args[2] === "apply" }) });
    expect(r.code).toBe(4);
    expect(r.output).toContain("DEPLOY INCOMPLETE: The migration failed.");
    expect(writes(r.calls).filter((c) => c.args[0] === "deploy")).toEqual([]);
  });

  it("a failed smoke check: exit 4 and the failing checks, with the custom-domain hint", async () => {
    const dir = makeRepo({ secrets: GOOD_SECRETS });
    const site404 = () => new Response('<a href="/?view=week#h08">Go to calendar</a>', { status: 404, headers: { "content-type": "text/html" } });
    const r = await ft(["deploy", "--yes"], { root: dir, handler: healthy(), deps: { fetch: liveFetch({ "GET /account": site404, "GET /account/ft-missing": site404 }) } });
    expect(r.code).toBe(4);
    expect(r.output).toContain("FAIL  smoke 8");
    expect(r.output).toContain("answered by the site Worker");
    expect(r.output).toContain("custom domain, it takes precedence over routes");
    expect(r.output).toContain("npx wrangler rollback");
  });
});
