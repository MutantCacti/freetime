// How ft stops (DEV-SPEC.md §2.6): one place that knows every child process ft
// started, and what SIGINT, SIGTERM, SIGHUP, a crash and the process exiting do
// to them. It starts nothing (run.mjs does) and prints only through `say`.
import { M } from "./messages.mjs";

/** The exit code for each signal ft handles: 128 + the signal's number. */
/** @type {Record<string, number>} */
export const SIGNAL_EXIT = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 };

export const HANDLED_SIGNALS = /** @type {const} */ (["SIGINT", "SIGTERM", "SIGHUP"]);

/** @param {string | null | undefined} sig */
export const exitFor = (sig) => SIGNAL_EXIT[sig ?? "SIGINT"] ?? 130;

/** A child's exit code, or 128 + n when a signal ended it. */
/** @param {number | null} code @param {NodeJS.Signals | null} signal @param {Record<string, number>} [numbers] */
export function childExit(code, signal, numbers = {}) {
  if (code !== null) return code;
  const n = signal ? numbers[signal] : undefined;
  return n ? 128 + n : 1;
}

/**
 * @typedef {{ signal: (sig: NodeJS.Signals) => void, done: Promise<number> }} Stoppable
 */

/**
 * Stops one child and everything in its process group: SIGINT (what Ctrl+C would
 * send), then SIGTERM, then SIGKILL, waiting `graceMs` after each. Resolves once it
 * has exited, or after the SIGKILL whatever happens, so it never hangs.
 * @param {Stoppable} child @param {{ graceMs: number, sleep: (ms: number) => Promise<void> }} o
 */
export async function stopGroup(child, { graceMs, sleep }) {
  for (const sig of /** @type {const} */ (["SIGINT", "SIGTERM", "SIGKILL"])) {
    child.signal(sig);
    const done = await Promise.race([child.done.then(() => true), sleep(graceMs).then(() => false)]);
    if (done) return true;
  }
  return false;
}

/** Thrown by the runner when ft has been told to stop: nothing new starts after a signal. */
export class Interrupted extends Error {
  /** @param {string} sig */
  constructor(sig) {
    super(`stopped by ${sig}`);
    this.signal = sig;
  }
}

/**
 * @typedef {(sig: NodeJS.Signals, o: { forced: boolean }) => void} InterruptHandler
 * @typedef {object} LifecycleOptions
 * @property {(pid: number, sig: NodeJS.Signals) => void} kill   process.kill (a negative pid is a group)
 * @property {(code: number) => void} exit                        process.exit
 * @property {(s: string) => void} say                            one line of ft's own text
 * @property {(ms: number) => Promise<void>} sleep
 * @property {(fn: () => void, ms: number) => void} later         a timer that doesn't keep ft alive
 * @property {number} [graceMs]      how long each stop step waits (default 3 s)
 * @property {number} [forceAfterMs] after the first signal, exit anyway after this long (default 30 s)
 * @property {number} [settleMs]     with no command handling the signal: how long to wait for ft to finish by itself once its children are stopped (default 1 s)
 */

/** @param {LifecycleOptions} o */
export function createLifecycle({ kill, exit, say, sleep, later, graceMs = 3_000, forceAfterMs = 30_000, settleMs = 1_000 }) {
  /** @type {Set<{ pid: number } & Stoppable>} */
  const children = new Set();
  /** @type {Set<InterruptHandler>} */
  const handlers = new Set();
  /** @type {NodeJS.Signals | null} */
  let interrupted = null;
  let exiting = false;

  /** @param {number} pid @param {NodeJS.Signals} sig */
  const killGroup = (pid, sig) => {
    try {
      kill(-pid, sig);
    } catch {
      // The group is already gone.
    }
  };

  /** SIGKILL to every group still running, synchronously: the last resort. */
  const killAllNow = () => {
    for (const c of children) killGroup(c.pid, "SIGKILL");
  };

  /** @param {number} code */
  const finish = (code) => {
    if (exiting) return;
    exiting = true;
    killAllNow();
    exit(code);
  };

  const stopAll = () => Promise.all([...children].map((c) => stopGroup(c, { graceMs, sleep }))).then(() => undefined);

  /** A second signal, or the first taking too long: kill everything now and exit. */
  /** @param {NodeJS.Signals} sig */
  const force = (sig) => {
    if (exiting) return;
    say(M.lifecycle.forced(sig));
    for (const h of handlers) {
      try {
        h(sig, { forced: true });
      } catch {
        // Exiting regardless.
      }
    }
    finish(exitFor(interrupted ?? sig));
  };

  return {
    /** Signals the group of a child as it stops. Exported for the runner. */
    killGroup,

    /**
     * Records a child ft started (in its own process group), until it exits.
     * @param {number | undefined} pid @param {Promise<number>} done
     */
    track(pid, done) {
      if (!pid) return;
      const entry = { pid, done, signal: (/** @type {NodeJS.Signals} */ sig) => killGroup(pid, sig) };
      children.add(entry);
      void done.then(() => {
        children.delete(entry);
        // The leader has exited; anything it left in its group (workerd) goes too.
        killGroup(pid, "SIGKILL");
      });
    },

    /** How many children are running now. */
    get running() {
      return children.size;
    },

    /** The first signal received, or null. */
    interrupted: () => interrupted,

    /**
     * A command that handles stopping itself (start, deploy) registers here: on the first
     * signal it gets the signal and does its own stopping; on a second it gets
     * `{ forced: true }` just before ft kills everything and exits.
     * @param {InterruptHandler} h
     */
    onInterrupt(h) {
      handlers.add(h);
      return () => void handlers.delete(h);
    },

    stopAll,

    /** @param {NodeJS.Signals} sig */
    signal(sig) {
      if (exiting) return;
      if (interrupted) return force(sig);
      interrupted = sig;
      later(() => force(sig), forceAfterMs);
      if (handlers.size) {
        for (const h of handlers) h(sig, { forced: false });
        return;
      }
      // No command is handling it: stop every child; if ft doesn't then finish by itself, end it.
      say("");
      void stopAll().then(() =>
        later(() => {
          if (exiting) return;
          say(M.lifecycle.stopped(sig));
          finish(exitFor(sig));
        }, settleMs),
      );
    },

    /**
     * An error nothing caught. Says so, stops every child, exits 1.
     * @param {unknown} e @param {boolean} verbose
     */
    async crash(e, verbose) {
      if (exiting) return;
      const err = e instanceof Error ? e : new Error(String(e));
      say(M.common.internal(err.message));
      if (verbose && err.stack) say(err.stack);
      if (children.size) say(M.lifecycle.stoppingChildren);
      later(() => finish(1), graceMs * 3 + 1_000);
      await stopAll();
      finish(1);
    },

    /** Stops what's left (normally nothing), then exits with `code`. */
    /** @param {number} code */
    async end(code) {
      if (exiting) return;
      if (children.size) await stopAll();
      finish(interrupted ? exitFor(interrupted) : code);
    },

    /** For process.on("exit"): whatever is still running dies with ft. */
    onExit: killAllNow,
  };
}

/** @typedef {ReturnType<typeof createLifecycle>} Lifecycle */
