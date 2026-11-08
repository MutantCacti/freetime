import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRedactor } from "../../scripts/ft/output.mjs";
import {
  HASHES_FILE,
  SECRETS_FILE,
  changesSince,
  generateKey,
  loadHashes,
  parseSecrets,
  recordDeployed,
  saveHashes,
  secretsJson,
  setSecretText,
} from "../../scripts/ft/secrets.mjs";
import { WORKERS } from "../../scripts/ft/workers.mjs";
import { GOOD_SECRETS, ROOT, SECRET_VALUES, ft, makeRepo } from "./helpers.mjs";

describe("the .secrets file", () => {
  it("is ignored by git, and its example isn't", () => {
    const ignored = (/** @type {string} */ p) => {
      try {
        execFileSync("git", ["check-ignore", "-q", p], { cwd: ROOT });
        return true;
      } catch {
        return false;
      }
    };
    expect(ignored(SECRETS_FILE)).toBe(true);
    expect(ignored(HASHES_FILE)).toBe(true);
    expect(ignored(".secrets.bak")).toBe(true);
    expect(ignored(".secrets.example")).toBe(false);
  });

  it("is never read by anything in src/ or public/", () => {
    /** @param {string} dir @returns {string[]} */
    const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
    const files = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "public"))];
    expect(files.length).toBeGreaterThan(30);
    const offenders = files.filter((f) => /\.secrets/.test(readFileSync(f, "latin1")));
    expect(offenders).toEqual([]);
  });

  it("parses sections, comments and quotes; reports problems by line", () => {
    const { values, problems } = parseSecrets(`# comment
TOP=1
[site]
ICAL_URL="https://a.example/x.ics https://b.example/y.ics"
[accounts]
RESEND_API_KEY=re_abc=def
[nope]
X=1
not a line
`);
    expect(values.site).toEqual({ ICAL_URL: "https://a.example/x.ics https://b.example/y.ics" });
    expect(values.accounts).toEqual({ RESEND_API_KEY: "re_abc=def" });
    expect(problems).toEqual([
      { line: 2, kind: "outside", name: "TOP" },
      { line: 7, kind: "section", name: "nope" },
      { line: 8, kind: "outside", name: "X" },
      { line: 9, kind: "syntax" },
    ]);
  });

  it("sets one value and keeps everything else", () => {
    const example = readFileSync(join(ROOT, ".secrets.example"), "utf8");
    const once = setSecretText(example, "accounts", "ACCOUNTS_KEY", "k1");
    expect(parseSecrets(once).values.accounts.ACCOUNTS_KEY).toBe("k1");
    expect(once.replace("ACCOUNTS_KEY=k1", "ACCOUNTS_KEY=")).toBe(example);
    const twice = setSecretText(once, "site", "ICAL_URL", "https://x.example/a.ics");
    expect(parseSecrets(twice).values).toEqual({ site: { ICAL_URL: "https://x.example/a.ics" }, accounts: { RESEND_API_KEY: "", ACCOUNTS_KEY: "k1" } });
    expect(parseSecrets(setSecretText("", "accounts", "ACCOUNTS_KEY", "k2")).values.accounts).toEqual({ ACCOUNTS_KEY: "k2" });
    expect(() => setSecretText("", "site", "ICAL_URL", "a\nb")).toThrow();
  });

  it("generates 32 random bytes as base64url", () => {
    const k = generateKey(32);
    expect(k).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(k, "base64url")).toHaveLength(32);
    expect(generateKey(32)).not.toBe(k);
  });

  it("keeps keyed hashes of deployed values, never the values", () => {
    const dir = makeRepo();
    const hashes = loadHashes(dir);
    const values = { ICAL_URL: "https://x.example/a.ics" };
    expect(changesSince(hashes, "site", values, ["ICAL_URL"])).toEqual({ ICAL_URL: "new" });
    recordDeployed(hashes, "site", values, ["ICAL_URL"]);
    saveHashes(dir, hashes);
    const again = loadHashes(dir);
    expect(changesSince(again, "site", values, ["ICAL_URL"])).toEqual({ ICAL_URL: "same" });
    expect(changesSince(again, "site", { ICAL_URL: "https://y.example/b.ics" }, ["ICAL_URL"])).toEqual({ ICAL_URL: "changed" });
    const raw = readFileSync(join(dir, HASHES_FILE), "utf8");
    expect(raw).not.toContain("x.example");
    expect((statSync(join(dir, HASHES_FILE)).mode & 0o777).toString(8)).toBe("600");
  });

  it("builds the JSON for wrangler's stdin with only that Worker's secrets", () => {
    const { values } = parseSecrets(GOOD_SECRETS);
    expect(Object.keys(JSON.parse(secretsJson(values.accounts, WORKERS.accounts.secrets)))).toEqual(["RESEND_API_KEY", "ACCOUNTS_KEY"]);
    expect(Object.keys(JSON.parse(secretsJson(values.site, WORKERS.site.secrets)))).toEqual(["ICAL_URL"]);
  });

  it("redacts each value, and each address in a list", () => {
    const r = createRedactor();
    r.add("ICAL_URL", "https://a.example/s1.ics https://b.example/s2.ics");
    expect(r.apply("fetch https://b.example/s2.ics failed")).toBe("fetch [ICAL_URL] failed");
  });
});

describe("./ft secrets", () => {
  it("--generate writes ACCOUNTS_KEY into .secrets, owner-only, and never prints it", async () => {
    const dir = makeRepo();
    const r = await ft(["secrets", "--generate", "ACCOUNTS_KEY"], { root: dir });
    expect(r.code).toBe(0);
    const text = readFileSync(join(dir, SECRETS_FILE), "utf8");
    const key = parseSecrets(text).values.accounts.ACCOUNTS_KEY ?? "";
    expect(Buffer.from(key, "base64url")).toHaveLength(32);
    expect(r.output).not.toContain(key);
    expect(r.output).toContain("Generated ACCOUNTS_KEY");
    expect((statSync(join(dir, SECRETS_FILE)).mode & 0o777).toString(8)).toBe("600");
    // Starts from the example, comments included.
    expect(text).toContain("# Copy to .secrets");
  });

  it("--generate refuses to replace an existing key, or to make anything else", async () => {
    const dir = makeRepo({ secrets: GOOD_SECRETS });
    expect((await ft(["secrets", "--generate", "ACCOUNTS_KEY"], { root: dir })).code).toBe(1);
    expect(readFileSync(join(dir, SECRETS_FILE), "utf8")).toBe(GOOD_SECRETS);
    expect((await ft(["secrets", "--generate", "ICAL_URL"], { root: dir })).code).toBe(2);
  });

  it("--set reads the value hidden, saves it, and puts it on stdin (never as an argument)", async () => {
    const dir = makeRepo({ secrets: GOOD_SECRETS });
    const value = "https://calendar.example/ical/NEW-FAKE-SECRET/basic.ics";
    const r = await ft(["secrets", "--set", "ICAL_URL", "--yes"], {
      root: dir,
      handler: (c) => (c.args[0] === "whoami" ? { stdout: "You are logged in with an OAuth Token, associated with the email m@example.com." } : undefined),
      deps: { stdinIsTTY: true, readHidden: async () => value },
    });
    expect(r.code).toBe(0);
    expect(parseSecrets(readFileSync(join(dir, SECRETS_FILE), "utf8")).values.site.ICAL_URL).toBe(value);
    const put = r.calls.find((c) => c.args[0] === "secret");
    expect(put).toMatchObject({ program: "wrangler", args: ["secret", "put", "ICAL_URL"], input: value });
    for (const c of r.calls) expect(c.args.join(" ")).not.toContain("NEW-FAKE-SECRET");
    expect(r.output).not.toContain("NEW-FAKE-SECRET");
    expect(changesSince(loadHashes(dir), "site", { ICAL_URL: value }, ["ICAL_URL"])).toEqual({ ICAL_URL: "same" });
  });

  it("--set never replaces ACCOUNTS_KEY", async () => {
    const dir = makeRepo({ secrets: GOOD_SECRETS });
    const r = await ft(["secrets", "--set", "ACCOUNTS_KEY"], { root: dir, deps: { stdinIsTTY: true, readHidden: async () => "other" } });
    expect(r.code).toBe(1);
    expect(r.calls.filter((c) => c.program === "wrangler")).toEqual([]);
  });

  it("--set needs a terminal", async () => {
    const dir = makeRepo({ secrets: GOOD_SECRETS });
    expect((await ft(["secrets", "--set", "ICAL_URL"], { root: dir })).code).toBe(1);
  });

  it("lists names only, and exits 3 when a value is missing locally", async () => {
    const dir = makeRepo({ secrets: GOOD_SECRETS.replace(/^RESEND_API_KEY=.*$/m, "RESEND_API_KEY=") });
    const r = await ft(["secrets"], { root: dir, handler: (c) => (c.args[0] === "whoami" ? { stdout: "You are not authenticated." } : undefined) });
    expect(r.code).toBe(3);
    expect(r.output).toContain("RESEND_API_KEY");
    for (const v of SECRET_VALUES) expect(r.output).not.toContain(v);
  });
});
