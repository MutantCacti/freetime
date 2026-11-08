// The only module that starts processes (DEV-SPEC.md §2.4). Every wrangler, npm
// and git call goes through `isAllowed`, an allow-list of the subcommands ft uses.
import { spawn } from "node:child_process";
import { join } from "node:path";

/** wrangler subcommands ft may run (the words before the first flag). */
export const WRANGLER_ALLOWED = [
  "whoami",
  "deploy",
  "dev",
  "tail",
  "d1 list",
  "d1 migrations list",
  "d1 migrations apply",
  "secret list",
  "secret put",
  "deployments list",
];

/** Words that are never run, whatever comes before or after them. */
export const FORBIDDEN_WORDS = ["delete", "rollback", "execute", "login", "logout", "bulk", "time-travel", "versions"];

const GIT_ALLOWED = ["status", "rev-parse", "rev-list", "log", "check-ignore"];

/** The words before the first flag: the subcommand, plus any positional argument. */
/** @param {string[]} args */
export function leading(args) {
  /** @type {string[]} */
  const out = [];
  for (const a of args) {
    if (a.startsWith("-")) break;
    out.push(a);
  }
  return out;
}

/** @param {string} program @param {string[]} args */
export function isAllowed(program, args) {
  const lead = leading(args);
  if (lead.some((w) => FORBIDDEN_WORDS.includes(w))) return false;
  if (program === "wrangler") {
    const s = lead.join(" ");
    return WRANGLER_ALLOWED.some((a) => s === a || s.startsWith(`${a} `));
  }
  if (program === "npm") {
    return (lead.length === 1 && lead[0] === "ci") || (lead.length === 1 && lead[0] === "test") || (lead.length === 2 && lead[0] === "run" && lead[1] === "typecheck");
  }
  if (program === "git") return GIT_ALLOWED.includes(lead[0] ?? "");
  return false;
}

export class NotAllowed extends Error {
  /** @param {string} program @param {string[]} args */
  constructor(program, args) {
    super(`ft refuses to run: ${program} ${leading(args).join(" ")}`);
  }
}

/**
 * The environment for every child: secrets ft knows about are removed (wrangler lets
 * the process environment override a secrets file), and wrangler's metrics are off.
 * @param {NodeJS.ProcessEnv} env @param {string[]} secretNames
 */
export function childEnv(env, secretNames) {
  const out = { ...env, WRANGLER_SEND_METRICS: "false" };
  for (const n of secretNames) delete out[n];
  return out;
}

/**
 * @typedef {{ input?: string, timeoutMs?: number }} CaptureOptions
 * @typedef {{ code: number, stdout: string, stderr: string }} Captured
 * @typedef {{ onLine: (line: string) => void, input?: string }} StreamOptions
 * @typedef {{ done: Promise<number>, signal: (sig: NodeJS.Signals) => void, pid: number | undefined }} LongChild
 * @typedef {object} Runner
 * @property {(program: string, args: string[], opts?: CaptureOptions) => Promise<Captured>} capture
 * @property {(program: string, args: string[], opts: StreamOptions) => Promise<number>} stream
 * @property {(program: string, args: string[]) => Promise<number>} interactive
 * @property {(program: string, args: string[], opts: StreamOptions) => LongChild} long
 */

/** Calls `onLine` once per whole line, across chunks. */
/** @param {(line: string) => void} onLine */
export function lineSplitter(onLine) {
  let buf = "";
  return {
    /** @param {Buffer | string} chunk */
    push(chunk) {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        onLine(buf.slice(0, i).replace(/\r$/, ""));
        buf = buf.slice(i + 1);
      }
    },
    flush() {
      if (buf) onLine(buf);
      buf = "";
    },
  };
}

/**
 * The real runner.
 * @param {{ root: string, env: NodeJS.ProcessEnv }} o
 * @returns {Runner}
 */
export function createRunner({ root, env }) {
  /** @param {string} p */
  const bin = (p) => (p === "wrangler" ? join(root, "node_modules", ".bin", "wrangler") : p);
  /** @param {string} program @param {string[]} args */
  const check = (program, args) => {
    if (!isAllowed(program, args)) throw new NotAllowed(program, args);
  };

  return {
    capture(program, args, { input, timeoutMs } = {}) {
      check(program, args);
      return new Promise((resolve) => {
        const child = spawn(bin(program), args, { cwd: root, env, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        const timer = timeoutMs ? setTimeout(() => ((timedOut = true), child.kill("SIGTERM")), timeoutMs) : null;
        child.stdout?.on("data", (d) => (stdout += d));
        child.stderr?.on("data", (d) => (stderr += d));
        if (input !== undefined) child.stdin?.end(input);
        child.on("error", (e) => {
          if (timer) clearTimeout(timer);
          resolve({ code: 127, stdout, stderr: stderr + String(e.message) });
        });
        child.on("close", (code) => {
          if (timer) clearTimeout(timer);
          resolve({ code: timedOut ? 124 : (code ?? 1), stdout, stderr });
        });
      });
    },

    stream(program, args, { onLine, input }) {
      check(program, args);
      return new Promise((resolve) => {
        const child = spawn(bin(program), args, { cwd: root, env, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
        const out = lineSplitter(onLine);
        const err = lineSplitter(onLine);
        child.stdout?.on("data", (d) => out.push(d));
        child.stderr?.on("data", (d) => err.push(d));
        if (input !== undefined) child.stdin?.end(input);
        child.on("error", () => resolve(127));
        child.on("close", (code) => {
          out.flush();
          err.flush();
          resolve(code ?? 1);
        });
      });
    },

    interactive(program, args) {
      check(program, args);
      return new Promise((resolve) => {
        // Ctrl+C goes to the child too; ft waits for it to finish instead of dying first.
        const ignore = () => {};
        process.on("SIGINT", ignore);
        const child = spawn(bin(program), args, { cwd: root, env, stdio: "inherit" });
        const done = (/** @type {number} */ code) => {
          process.off("SIGINT", ignore);
          resolve(code);
        };
        child.on("error", () => done(127));
        child.on("close", (code, signal) => done(signal === "SIGINT" ? 130 : (code ?? 1)));
      });
    },

    long(program, args, { onLine }) {
      check(program, args);
      // Its own process group, so a stop reaches wrangler's workerd children too.
      const child = spawn(bin(program), args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
      const out = lineSplitter(onLine);
      const err = lineSplitter(onLine);
      child.stdout?.on("data", (d) => out.push(d));
      child.stderr?.on("data", (d) => err.push(d));
      const done = new Promise((resolve) => {
        child.on("error", () => resolve(127));
        child.on("close", (code, signal) => {
          out.flush();
          err.flush();
          resolve(code ?? (signal ? 128 : 1));
        });
      });
      return {
        pid: child.pid,
        done: /** @type {Promise<number>} */ (done),
        signal(sig) {
          try {
            if (child.pid) process.kill(-child.pid, sig);
          } catch {
            // Already gone.
          }
        },
      };
    },
  };
}

/**
 * Wraps any runner (real or fake) with the allow-list and `--verbose` echo.
 * @param {Runner} runner @param {{ verbose: boolean, echo: (line: string) => void }} o
 * @returns {Runner}
 */
export function guarded(runner, { verbose, echo }) {
  /** @param {string} program @param {string[]} args */
  const before = (program, args) => {
    if (!isAllowed(program, args)) throw new NotAllowed(program, args);
    if (verbose) echo(`$ ${program} ${args.join(" ")}`);
  };
  return {
    capture: (p, a, o) => (before(p, a), runner.capture(p, a, o)),
    stream: (p, a, o) => (before(p, a), runner.stream(p, a, o)),
    interactive: (p, a) => (before(p, a), runner.interactive(p, a)),
    long: (p, a, o) => (before(p, a), runner.long(p, a, o)),
  };
}
