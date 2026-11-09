import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FORBIDDEN_WORDS, NotAllowed, childEnv, createRunner, guarded, isAllowed, lineSplitter } from "../../scripts/ft/run.mjs";
import { ROOT, fakeRunner } from "./helpers.mjs";

describe("the allow-list (DEV-SPEC.md §2.4)", () => {
  it.each([
    ["wrangler", ["delete"]],
    ["wrangler", ["delete", "-c", "wrangler.accounts.toml"]],
    ["wrangler", ["d1", "delete", "freetime-accounts"]],
    ["wrangler", ["secret", "delete", "ICAL_URL"]],
    ["wrangler", ["secret", "bulk"]],
    ["wrangler", ["rollback"]],
    ["wrangler", ["d1", "execute", "freetime-accounts", "--remote", "--command", "SELECT 1"]],
    ["wrangler", ["d1", "time-travel", "restore", "freetime-accounts"]],
    ["wrangler", ["login"]],
    ["wrangler", ["logout"]],
    ["wrangler", ["versions", "deploy"]],
    ["wrangler", ["r2", "bucket", "delete", "x"]],
    ["npm", ["install", "left-pad"]],
    ["npm", ["update"]],
    ["npm", ["run", "dev"]],
    ["git", ["commit", "-m", "x"]],
    ["git", ["push"]],
    ["git", ["checkout", "main"]],
    ["git", ["reset", "--hard"]],
    ["git", ["stash"]],
    ["rm", ["-rf", "node_modules"]],
    ["sh", ["-c", "anything"]],
  ])("refuses %s %j", (program, args) => {
    expect(isAllowed(program, args)).toBe(false);
  });

  it.each([
    ["wrangler", ["deploy", "-c", "wrangler.accounts.toml", "--env=", "--message", "abc1234 main", "--secrets-file", "/dev/stdin"]],
    ["wrangler", ["deploy", "--env=", "--dry-run", "--secrets-file", "/dev/stdin"]],
    ["wrangler", ["d1", "migrations", "apply", "freetime-accounts", "--remote", "-c", "wrangler.accounts.toml"]],
    ["wrangler", ["secret", "put", "ICAL_URL"]],
    ["wrangler", ["tail", "--format", "pretty", "--search", "7K2Q9M"]],
    ["npm", ["ci"]],
    ["npm", ["test", "--", "--project", "site"]],
    ["npm", ["run", "typecheck"]],
    ["git", ["status", "--porcelain"]],
  ])("allows %s %j", (program, args) => {
    expect(isAllowed(program, args)).toBe(true);
  });

  it("is enforced by the real runner and by guarded()", async () => {
    const real = createRunner({ root: ROOT, env: {} });
    expect(() => real.capture("wrangler", ["delete"])).toThrow(NotAllowed);
    expect(() => real.long("wrangler", ["rollback"], { onLine: () => {} })).toThrow(NotAllowed);
    const { runner, calls } = fakeRunner();
    const g = guarded(runner, { verbose: false, echo: () => {} });
    expect(() => g.capture("wrangler", ["d1", "delete", "x"])).toThrow(NotAllowed);
    expect(calls).toEqual([]);
  });

  it("forbids each listed word", () => {
    for (const w of FORBIDDEN_WORDS) expect(isAllowed("wrangler", [w])).toBe(false);
  });

  it("only run.mjs starts processes", () => {
    const dir = join(ROOT, "scripts");
    const files = [join(dir, "ft.mjs"), ...readdirSync(join(dir, "ft")).filter((f) => f.endsWith(".mjs")).map((f) => join(dir, "ft", f)), ...readdirSync(join(dir, "ft", "commands")).map((f) => join(dir, "ft", "commands", f))];
    const offenders = files.filter((f) => !f.endsWith("run.mjs") && /child_process/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("echoes commands with --verbose, never stdin", async () => {
    const { runner } = fakeRunner();
    /** @type {string[]} */
    const lines = [];
    const g = guarded(runner, { verbose: true, echo: (l) => lines.push(l) });
    await g.capture("wrangler", ["secret", "put", "ICAL_URL"], { input: "FAKE-VALUE-123" });
    expect(lines).toEqual(["$ wrangler secret put ICAL_URL"]);
  });
});

describe("the runner", () => {
  it("splits output into whole lines across chunks", () => {
    /** @type {string[]} */
    const lines = [];
    const s = lineSplitter((l) => lines.push(l));
    s.push("one\ntw");
    s.push("o\r\nthr");
    s.flush();
    expect(lines).toEqual(["one", "two", "thr"]);
  });

  it("removes secrets from the children's environment and turns metrics off", () => {
    const env = childEnv({ PATH: "/bin", ICAL_URL: "x", RESEND_API_KEY: "y" }, ["ICAL_URL", "RESEND_API_KEY"]);
    expect(env).toEqual({ PATH: "/bin", WRANGLER_SEND_METRICS: "false" });
  });

  it("captures a real git command (read-only)", async () => {
    const real = createRunner({ root: ROOT, env: process.env });
    const r = await real.capture("git", ["rev-parse", "--is-inside-work-tree"]);
    expect(r).toMatchObject({ code: 0, stdout: "true\n" });
  });
});
