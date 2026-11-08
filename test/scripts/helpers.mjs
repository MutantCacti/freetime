// Test helpers for ft: a fake runner (no real wrangler, npm or git), fake deps,
// and a throwaway copy of the repository's config files.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { main } from "../../scripts/ft/cli.mjs";
import { isAllowed } from "../../scripts/ft/run.mjs";

export const ROOT = resolve(import.meta.dirname, "..", "..");
export const FIXTURES = join(import.meta.dirname, "fixtures");

/** @param {string} name */
export const fixture = (name) => readFileSync(join(FIXTURES, name), "utf8");

export const REAL_DB_ID = "3f2b9c1e-6a7d-4e21-9b0f-1c2d3e4f5a6b";

/**
 * A fake runner. `handler(call)` returns `{ code, stdout }` (or undefined for success
 * with no output). Every call is recorded, input included, so tests can check what
 * would have been run and what went to stdin.
 * @param {(call: { program: string, args: string[], input?: string, kind: string }) => ({ code?: number, stdout?: string, stderr?: string } | undefined)} handler
 */
export function fakeRunner(handler = () => undefined) {
  /** @type {{ program: string, args: string[], input?: string, kind: string }[]} */
  const calls = [];
  /** @param {string} kind @param {string} program @param {string[]} args @param {string} [input] */
  const call = (kind, program, args, input) => {
    if (!isAllowed(program, args)) throw new Error(`fake runner: not allowed: ${program} ${args.join(" ")}`);
    const c = { kind, program, args, input };
    calls.push(c);
    const r = handler(c) ?? {};
    return { code: r.code ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
  return {
    calls,
    /** @type {import("../../scripts/ft/run.mjs").Runner} */
    runner: {
      async capture(program, args, opts = {}) {
        return call("capture", program, args, opts.input);
      },
      async stream(program, args, opts) {
        const r = call("stream", program, args, opts.input);
        for (const l of (r.stdout + r.stderr).split("\n").filter(Boolean)) opts.onLine(l);
        return r.code;
      },
      async interactive(program, args) {
        return call("interactive", program, args).code;
      },
      long(program, args, opts) {
        call("long", program, args);
        /** @type {(code: number) => void} */
        let resolveDone = () => {};
        const done = new Promise((r) => (resolveDone = r));
        /** @type {string[]} */
        const signals = [];
        const child = { program, args, signals, onLine: opts.onLine, exit: (/** @type {number} */ code) => resolveDone(code) };
        longChildren.push(child);
        return {
          pid: 1,
          done: /** @type {Promise<number>} */ (done),
          signal(sig) {
            signals.push(sig);
            child.onSignal?.(sig);
          },
        };
      },
    },
  };
}

/** @type {any[]} */
export const longChildren = [];

/**
 * Runs ft with fake everything. Returns the exit code, the output and the recorded calls.
 * @param {string[]} argv
 * @param {{ root?: string, handler?: Parameters<typeof fakeRunner>[0], deps?: Partial<import("../../scripts/ft/cli.mjs").Deps> }} [o]
 */
export async function ft(argv, { root = ROOT, handler, deps = {} } = {}) {
  const { runner, calls } = fakeRunner(handler);
  let output = "";
  // A fake clock: sleeping moves it on, so retries end without waiting.
  let t = 0;
  const code = await main(argv, {
    root,
    write: (s) => (output += s),
    color: false,
    runner,
    nodeVersion: "22.22.0",
    stdinIsTTY: false,
    ask: async () => "n",
    readHidden: async () => null,
    fetch: /** @type {any} */ (async () => new Response("", { status: 599 })),
    sleep: async (ms) => void (t += ms),
    now: () => t,
    resolves: async () => true,
    portBusy: async () => false,
    waitHttp: async () => true,
    onInterrupt: () => () => {},
    ...deps,
  });
  return { code, output, calls };
}

/**
 * A throwaway repository: the real configs and migrations, a package-lock with no
 * packages and a stub wrangler, so the deps check passes without node_modules.
 * @param {{ databaseId?: string, secrets?: string | null, migrations?: Record<string, string> }} [o]
 */
export function makeRepo({ databaseId = REAL_DB_ID, secrets = null, migrations = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ft-test-"));
  for (const f of ["wrangler.toml", "wrangler.accounts.toml", ".secrets.example", ".dev.vars.example"]) cpSync(join(ROOT, f), join(dir, f));
  cpSync(join(ROOT, "migrations"), join(dir, "migrations"), { recursive: true });
  for (const [name, sql] of Object.entries(migrations)) writeFileSync(join(dir, "migrations", name), sql);
  const accounts = readFileSync(join(dir, "wrangler.accounts.toml"), "utf8");
  const i = accounts.search(/^\[env\./m);
  writeFileSync(join(dir, "wrangler.accounts.toml"), accounts.slice(0, i).replace(/database_id = "[^"]*"/, `database_id = "${databaseId}"`) + accounts.slice(i));
  writeFileSync(join(dir, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "": {} } }));
  mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(dir, "node_modules", ".bin", "wrangler"), "");
  if (secrets !== null) writeFileSync(join(dir, ".secrets"), secrets);
  return dir;
}

export const GOOD_SECRETS = `[site]
ICAL_URL=https://calendar.example/ical/FAKE-ICAL-SECRET-1/basic.ics https://calendar.example/ical/FAKE-ICAL-SECRET-2/basic.ics
[accounts]
RESEND_API_KEY=re_FAKE_RESEND_SECRET_123456
ACCOUNTS_KEY=FAKE_ACCOUNTS_KEY_abcdefghijklmnopqrstuvwxyz0123
`;

export const SECRET_VALUES = ["FAKE-ICAL-SECRET-1", "FAKE-ICAL-SECRET-2", "re_FAKE_RESEND_SECRET_123456", "FAKE_ACCOUNTS_KEY_abcdefghijklmnopqrstuvwxyz0123"];

/** A handler answering like a healthy Cloudflare account, logged in, with one pending migration. */
/** @param {{ pending?: string[], fail?: (c: { program: string, args: string[] }) => boolean, branch?: string, dirty?: boolean }} [o] */
export function healthy({ pending = [], fail = () => false, branch = "main", dirty = false } = {}) {
  /** @param {{ program: string, args: string[] }} c */
  return (c) => {
    if (fail(c)) return { code: 1, stdout: "✘ [ERROR] something went wrong" };
    const a = c.args.join(" ");
    if (c.program === "git") {
      if (a === "status --porcelain") return { stdout: dirty ? " M src/app.tsx\n" : "" };
      if (a === "rev-parse --abbrev-ref HEAD") return { stdout: `${branch}\n` };
      if (a.startsWith("log -1")) return { stdout: "abc1234\tA commit\n" };
      if (a.includes("@{u}") && a.startsWith("rev-parse")) return { stdout: `origin/${branch}\n` };
      if (a.startsWith("rev-list --count")) return { stdout: "0\n" };
      if (a.startsWith("check-ignore")) return { code: 0 };
    }
    if (c.program === "npm") return { stdout: " Tests  300 passed (300)\n" };
    if (c.program === "wrangler") {
      if (a === "whoami") return { stdout: "You are logged in with an OAuth Token, associated with the email maxence@example.com.\n" };
      if (a === "d1 list --json") return { stdout: JSON.stringify([{ uuid: REAL_DB_ID, name: "freetime-accounts" }]) };
      if (a.startsWith("d1 migrations list")) return { stdout: pending.length ? `Migrations to be applied:\n│ ${pending.join(" │\n│ ")} │\n` : "✅ No migrations to apply!\n" };
      if (a.startsWith("deploy") && !a.includes("--dry-run")) return { stdout: "Uploaded freetime\nCurrent Version ID: 1a2b3c4d-0000-4000-8000-000000000000\n" };
    }
    return undefined;
  };
}

/** A fetch that answers like the live site, both Workers healthy. */
export function liveFetch(overrides = /** @type {Record<string, () => Response>} */ ({})) {
  const sec = {
    "strict-transport-security": "max-age=31536000",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin",
    "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
    "cache-control": "no-store",
  };
  /** @param {string} body @param {number} status @param {Record<string, string>} headers */
  const html = (body, status = 200, headers = {}) => new Response(body, { status, headers: { "content-type": "text/html; charset=UTF-8", ...sec, ...headers } });
  /** @type {Record<string, () => Response>} */
  const routes = {
    "GET /": () => html('<a class="pill round tb-account" href="/account" aria-label="Account"></a>'),
    "HEAD /": () => html(""),
    "POST /": () => html("", 405),
    "GET /free-busy.ics": () => new Response("BEGIN:VCALENDAR", { headers: { "content-type": "text/calendar", "content-disposition": 'attachment; filename="mutantcacti-busy.ics"' } }),
    "GET /css/app.css": () => new Response("", { headers: { "content-type": "text/css" } }),
    "GET /css/calendar.css": () => new Response("", { headers: { "content-type": "text/css" } }),
    "GET /help": () => html("help"),
    "GET /account": () => html('<a class="pill pill-primary" href="/account/sign-in">Sign in</a>'),
    "GET /account/sign-in": () => html("sign in"),
    "GET /account/sign-up": () => html("sign up"),
    "GET /account/ft-missing": () => html('<h1>Page not found</h1><a href="/account">Go to calendar</a>', 404),
    "GET /u/ft-missing": () => html('<h1>Page not found</h1><a href="/account">Go to calendar</a>', 404),
    ...overrides,
  };
  /** @type {string[]} */
  const seen = [];
  /** @param {URL} url @param {RequestInit} init */
  const f = async (url, init) => {
    const key = `${init.method} ${new URL(url).pathname}`;
    seen.push(key);
    const r = routes[key];
    return r ? r() : new Response("", { status: 500 });
  };
  return Object.assign(f, { seen });
}
