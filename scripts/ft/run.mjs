// The only module that starts processes (DEV-SPEC.md §2.4). Every wrangler, npm
// and git call goes through `isAllowed`, an allow-list of the subcommands ft uses.
import { spawn } from "node:child_process";
import { constants } from "node:os";
import { join } from "node:path";
import { Interrupted, childExit } from "./lifecycle.mjs";

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
 * The real runner. Every child starts in its own process group (`detached`), so a
 * stop reaches its own children too (wrangler's workerd, npm's vitest), and is
 * handed to `track`, which is how the lifecycle (lifecycle.mjs) knows what to stop.
 * Children never read ft's terminal: stdin is a pipe or closed.
 * @param {{ root: string, env: NodeJS.ProcessEnv, track?: (pid: number | undefined, done: Promise<number>) => void }} o
 * @returns {Runner}
 */
export function createRunner({ root, env, track = () => {} }) {
  /** @param {string} p */
  const bin = (p) => (p === "wrangler" ? join(root, "node_modules", ".bin", "wrangler") : p);
  /** @param {string} program @param {string[]} args */
  const check = (program, args) => {
    if (!isAllowed(program, args)) throw new NotAllowed(program, args);
  };
  /** @param {number | undefined} pid @param {NodeJS.Signals} sig */
  const signalGroup = (pid, sig) => {
    try {
      if (pid) process.kill(-pid, sig);
    } catch {
      // Already gone.
    }
  };
  /** @param {number | null} code @param {NodeJS.Signals | null} signal */
  const exitOf = (code, signal) => childExit(code, signal, constants.signals);

  /**
   * Starts one child and resolves with its exit code once it has exited and its output has ended.
   * @param {string} program @param {string[]} args
   * @param {{ input?: string, stdio: "pipe" | "inherit", onOut?: (d: Buffer) => void, onErr?: (d: Buffer) => void, onEnd?: () => void, timeoutMs?: number }} o
   */
  const start = (program, args, { input, stdio, onOut, onErr, onEnd, timeoutMs }) => {
    const child = spawn(bin(program), args, { cwd: root, env, detached: true, stdio: [input === undefined ? "ignore" : "pipe", stdio, stdio] });
    let timedOut = false;
    /** @type {NodeJS.Timeout | null} */
    let timer = null;
    if (timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        signalGroup(child.pid, "SIGTERM");
        setTimeout(() => signalGroup(child.pid, "SIGKILL"), 5_000).unref();
      }, timeoutMs);
    }
    if (onOut) child.stdout?.on("data", onOut);
    if (onErr) child.stderr?.on("data", onErr);
    if (input !== undefined) {
      child.stdin?.on("error", () => {}); // A child that exits before reading all of it.
      child.stdin?.end(input);
    }
    const done = /** @type {Promise<number>} */ (
      new Promise((resolve) => {
        child.on("error", () => {
          if (timer) clearTimeout(timer);
          resolve(127);
        });
        child.on("close", (code, signal) => {
          if (timer) clearTimeout(timer);
          onEnd?.();
          resolve(timedOut ? 124 : exitOf(code, signal));
        });
      })
    );
    track(child.pid, done);
    return { child, done, signal: (/** @type {NodeJS.Signals} */ sig) => signalGroup(child.pid, sig) };
  };

  return {
    capture(program, args, { input, timeoutMs } = {}) {
      check(program, args);
      let stdout = "";
      let stderr = "";
      let spawnError = "";
      const { child, done } = start(program, args, { input, timeoutMs, stdio: "pipe", onOut: (d) => void (stdout += d), onErr: (d) => void (stderr += d) });
      child.on("error", (e) => (spawnError = String(e.message)));
      return done.then((code) => ({ code, stdout, stderr: stderr + spawnError }));
    },

    stream(program, args, { onLine, input }) {
      check(program, args);
      const out = lineSplitter(onLine);
      const err = lineSplitter(onLine);
      return start(program, args, {
        input,
        stdio: "pipe",
        onOut: (d) => out.push(d),
        onErr: (d) => err.push(d),
        onEnd: () => (out.flush(), err.flush()),
      }).done;
    },

    // Output straight to the terminal. Ctrl+C reaches ft, not the child (its own
    // group); ft then stops the child's whole group, as for every other child.
    interactive(program, args) {
      check(program, args);
      return start(program, args, { stdio: "inherit" }).done;
    },

    long(program, args, { onLine }) {
      check(program, args);
      const out = lineSplitter(onLine);
      const err = lineSplitter(onLine);
      const { child, done, signal } = start(program, args, {
        stdio: "pipe",
        onOut: (d) => out.push(d),
        onErr: (d) => err.push(d),
        onEnd: () => (out.flush(), err.flush()),
      });
      return { pid: child.pid, done, signal };
    },
  };
}

/**
 * Wraps any runner (real or fake) with the allow-list, the `--verbose` echo, and the
 * rule that nothing new starts once ft has been told to stop (it throws `Interrupted`).
 * @param {Runner} runner @param {{ verbose: boolean, echo: (line: string) => void, interrupted?: () => string | null }} o
 * @returns {Runner}
 */
export function guarded(runner, { verbose, echo, interrupted = () => null }) {
  /** @param {string} program @param {string[]} args */
  const before = (program, args) => {
    if (!isAllowed(program, args)) throw new NotAllowed(program, args);
    const sig = interrupted();
    if (sig) throw new Interrupted(sig);
    if (verbose) echo(`$ ${program} ${args.join(" ")}`);
  };
  return {
    capture: (p, a, o) => (before(p, a), runner.capture(p, a, o)),
    stream: (p, a, o) => (before(p, a), runner.stream(p, a, o)),
    interactive: (p, a) => (before(p, a), runner.interactive(p, a)),
    long: (p, a, o) => (before(p, a), runner.long(p, a, o)),
  };
}
