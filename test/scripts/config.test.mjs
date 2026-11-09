import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLACEHOLDER_ID, databaseId, routePaths, senderDomain, siteHost, topLevel, topLevelVar, workerName } from "../../scripts/ft/config.mjs";
import { routeFor } from "../../scripts/ft/router.mjs";
import { WORKERS, WORKER_KEYS, allSecretNames } from "../../scripts/ft/workers.mjs";
import { ROOT } from "./helpers.mjs";

const read = (/** @type {string} */ f) => readFileSync(join(ROOT, f), "utf8");
const site = read("wrangler.toml");
const accounts = read("wrangler.accounts.toml");
const config = read("src/config.ts");

describe("the wrangler config readers, on the real files", () => {
  it("read the site's host from its route, matching SITE_HOST", () => {
    const host = siteHost(site);
    expect(config).toContain(`export const SITE_HOST = "${host}";`);
    expect(siteHost(accounts)).toBe(host);
  });

  it("read the accounts routes", () => {
    expect(routePaths(accounts)).toEqual(["/account*", "/u/*", "/@*", "/spaces*", "/s/*", "/auth/*"]);
    expect(routePaths(site)).toEqual(["/*"]);
  });

  it("read the Worker names, which match workers.mjs", () => {
    expect(workerName(site)).toBe(WORKERS.site.name);
    expect(workerName(accounts)).toBe(WORKERS.accounts.name);
  });

  it("read only the top-level database_id and RESEND_FROM", () => {
    const id = databaseId(accounts);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    // The env.dev copy is ignored even when it differs.
    const edited = accounts.replace(`database_id = "${PLACEHOLDER_ID}"`, 'database_id = "11111111-2222-3333-4444-555555555555"');
    expect(databaseId(edited)).toBe("11111111-2222-3333-4444-555555555555");
    expect(topLevel(accounts)).not.toContain("[env.dev]");
    const from = topLevelVar(accounts, "RESEND_FROM");
    expect(senderDomain(from)).toBeTruthy();
    expect(topLevelVar(accounts.replace(/^RESEND_FROM = .*$/m, ""), "RESEND_FROM")).toBeNull();
    expect(senderDomain("noreply@example.com")).toBeNull();
    expect(senderDomain("freetime <noreply@example.com>")).toBe("example.com");
  });
});

describe("workers.mjs", () => {
  it("lists every secret the Workers' Env types declare", () => {
    // Every optional string field in Env / AccountsEnv is a secret or a var ft knows.
    const fields = (/** @type {string} */ src, /** @type {string} */ iface) => {
      const body = src.match(new RegExp(`export interface ${iface} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
      return [...body.matchAll(/^\s+([A-Z][A-Z0-9_]*)\??:\s*string;/gm)].map((m) => m[1]);
    };
    const siteFields = fields(read("src/app.tsx"), "Env");
    const accountsFields = fields(read("src/accounts/app.tsx"), "AccountsEnv");
    expect(siteFields.length).toBeGreaterThan(0);
    expect(accountsFields.length).toBeGreaterThan(0);
    for (const f of siteFields) expect([...WORKERS.site.secrets, ...WORKERS.site.vars], f).toContain(f);
    for (const f of accountsFields) expect([...WORKERS.accounts.secrets, ...WORKERS.accounts.vars], f).toContain(f);
  });

  it("names each secret once", () => {
    expect(new Set(allSecretNames()).size).toBe(allSecretNames().length);
    expect(WORKER_KEYS).toEqual(["site", "accounts"]);
  });
});

describe("the local router's path table (DEV-SPEC.md §3.2.1)", () => {
  const paths = routePaths(accounts);
  it.each([
    ["/", "site"],
    ["/?view=week", "site"],
    ["/help", "site"],
    ["/css/app.css", "site"],
    ["/free-busy.ics", "site"],
    ["/sx", "site"],
    ["/u", "site"],
    ["/account", "accounts"],
    ["/account?done=welcome", "accounts"],
    ["/account/sign-in", "accounts"],
    ["/accounts", "accounts"],
    ["/u/someone", "accounts"],
    ["/@ada", "accounts"],
    ["/@ada?f=abc", "accounts"],
    ["/spaces", "accounts"],
    ["/spaces/1", "accounts"],
    ["/s/abc", "accounts"],
    ["/auth/google", "accounts"],
  ])("%s goes to %s", (path, worker) => {
    expect(routeFor(path, paths)).toBe(worker);
  });
});
