import { execFileSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SIGNAL_EXIT, childExit, createLifecycle, exitFor, stopGroup } from "../../scripts/ft/lifecycle.mjs";
import { createRunner } from "../../scripts/ft/run.mjs";
import { makeRepo } from "./helpers.mjs";

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * A lifecycle with fake process.kill, exit and timers. `group(pid, stopsOn)` makes a
 * fake child that exits when its group gets one of the signals in `stopsOn`.
 */
function setup(o = {}) {
  /** @type {[number, string][]} */
  const kills = [];
  /** @type {number[]} */
  const exits = [];
  /** @type {string[]} */
  const said = [];
  /** @type {{ fn: () => void, ms: number }[]} */
  const timers = [];
  /** @type {Map<number, { stopsOn: string[], exit: (code: number) => void, done: Promise<number> }>} */
  const groups = new Map();
  const life = createLifecycle({
    kill: (pid, sig) => {
      kills.push([pid, sig]);
      const g = groups.get(-pid);
      if (!g) throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
      if (g.stopsOn.includes(sig)) g.exit(128 + (sig === "SIGKILL" ? 9 : sig === "SIGTERM" ? 15 : 2));
    },
    exit: (code) => void exits.push(code),
    say: (s) => void said.push(s),
    sleep: async () => {
      await tick();
    },
    later: (fn, ms) => void timers.push({ fn, ms }),
    graceMs: 10,
    ...o,
  });
  /** @param {number} pid @param {string[]} stopsOn */
  const group = (pid, stopsOn) => {
    /** @type {(code: number) => void} */
    let exit = () => {};
    const done = /** @type {Promise<number>} */ (new Promise((r) => (exit = r)));
    groups.set(pid, { stopsOn, exit: (c) => (groups.delete(pid), exit(c)), done });
    life.track(pid, done);
    return { exit: (/** @type {number} */ c) => groups.get(pid)?.exit(c), done };
  };
  const settle = async () => {
    for (let i = 0; i < 50; i++) await tick();
  };
  // In time order, as they'd fire.
  const runTimers = () =>
    timers
      .splice(0)
      .sort((a, b) => a.ms - b.ms)
      .forEach((t) => t.fn());
  return { life, kills, exits, said, group, settle, runTimers };
}

describe("exit codes", () => {
  it("is 128 + the signal number for each signal ft handles", () => {
    expect(SIGNAL_EXIT).toEqual({ SIGHUP: 129, SIGINT: 130, SIGTERM: 143 });
    expect(exitFor("SIGTERM")).toBe(143);
    expect(exitFor(null)).toBe(130);
    expect(childExit(0, null)).toBe(0);
    expect(childExit(null, "SIGKILL", { SIGKILL: 9 })).toBe(137);
    expect(childExit(null, null)).toBe(1);
  });
});

describe("the lifecycle (lifecycle.mjs)", () => {
  for (const [sig, code] of /** @type {const} */ ([["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]])) {
    it(`${sig}: stops every child's process group, then exits ${code}`, async () => {
      const t = setup();
      t.group(100, ["SIGINT"]);
      t.group(200, ["SIGINT"]);
      expect(t.life.running).toBe(2);
      t.life.signal(sig);
      await t.settle();
      expect(t.kills).toContainEqual([-100, "SIGINT"]);
      expect(t.kills).toContainEqual([-200, "SIGINT"]);
      expect(t.life.running).toBe(0);
      expect(t.life.interrupted()).toBe(sig);
      // ft didn't finish by itself: after the settle time, it says so and exits.
      t.runTimers();
      expect(t.exits).toEqual([code]);
      expect(t.said.at(-1)).toMatch(/^Stopped by /);
    });
  }

  it("escalates to SIGKILL for a child that ignores SIGINT and SIGTERM, and never hangs", async () => {
    const t = setup();
    t.group(100, ["SIGKILL"]);
    t.life.signal("SIGTERM");
    await t.settle();
    expect(t.kills.filter(([p]) => p === -100).map(([, s]) => s)).toEqual(["SIGINT", "SIGTERM", "SIGKILL", "SIGKILL"]);
    expect(t.life.running).toBe(0);
  });

  it("stopGroup gives up after SIGKILL even if the child never reports exiting", async () => {
    /** @type {string[]} */
    const sent = [];
    const never = new Promise(() => {});
    const r = await stopGroup({ signal: (s) => void sent.push(s), done: /** @type {Promise<number>} */ (never) }, { graceMs: 1, sleep: async () => {} });
    expect(r).toBe(false);
    expect(sent).toEqual(["SIGINT", "SIGTERM", "SIGKILL"]);
  });

  it("a second signal kills every group at once and exits immediately", async () => {
    const t = setup();
    t.group(100, []); // ignores everything but SIGKILL, and is slow about it
    /** @type {any[]} */
    const seen = [];
    t.life.onInterrupt((sig, o) => void seen.push([sig, o.forced]));
    t.life.signal("SIGINT");
    expect(t.exits).toEqual([]);
    t.life.signal("SIGINT");
    expect(t.kills).toContainEqual([-100, "SIGKILL"]);
    expect(t.exits).toEqual([130]);
    expect(seen).toEqual([
      ["SIGINT", false],
      ["SIGINT", true],
    ]);
    expect(t.said.join("\n")).toContain("Ctrl+C again");
    // Idempotent: nothing more happens after the exit.
    t.life.signal("SIGTERM");
    expect(t.exits).toEqual([130]);
  });

  it("a command handling the signal does its own stopping; the lifecycle doesn't touch its children", async () => {
    const t = setup();
    t.group(100, ["SIGINT"]);
    /** @type {string[]} */
    const seen = [];
    const off = t.life.onInterrupt((sig) => void seen.push(sig));
    t.life.signal("SIGTERM");
    await t.settle();
    expect(seen).toEqual(["SIGTERM"]);
    expect(t.kills).toEqual([]);
    off();
  });

  it("forces the exit if stopping takes too long after the first signal", async () => {
    const t = setup();
    t.group(100, []);
    t.life.onInterrupt(() => {}); // a handler that never finishes
    t.life.signal("SIGTERM");
    t.runTimers(); // the force-after timer
    expect(t.kills).toContainEqual([-100, "SIGKILL"]);
    expect(t.exits).toEqual([143]);
  });

  it("an error nothing caught: says so, stops every child, exits 1", async () => {
    const t = setup();
    t.group(100, ["SIGINT"]);
    await t.life.crash(new Error("boom"), false);
    expect(t.said[0]).toBe("ft: internal error (FT_INTERNAL): boom");
    expect(t.kills).toContainEqual([-100, "SIGINT"]);
    expect(t.exits).toEqual([1]);
  });

  it("sweeps a child's group when its leader exits, so nothing it started outlives it", async () => {
    const t = setup();
    const c = t.group(100, []);
    c.exit(0);
    await t.settle();
    expect(t.kills).toEqual([[-100, "SIGKILL"]]);
  });

  it("on process exit, SIGKILLs whatever is still running", () => {
    const t = setup();
    t.group(100, []);
    t.group(200, []);
    t.life.onExit();
    expect(t.kills).toEqual([
      [-100, "SIGKILL"],
      [-200, "SIGKILL"],
    ]);
  });

  it("end(): stops what's left, and a signal's code wins over the command's", async () => {
    const t = setup();
    await t.life.end(0);
    expect(t.exits).toEqual([0]);
    const u = setup();
    u.life.onInterrupt(() => {});
    u.life.signal("SIGHUP");
    await u.life.end(1);
    expect(u.exits).toEqual([129]);
  });
});

/** `ps` state of a process: "" once it's gone, "Z" while it's a zombie (dead, not yet reaped). */
const state = (/** @type {number} */ pid) => {
  try {
    return execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};
const dead = (/** @type {number} */ pid) => state(pid) === "" || state(pid).startsWith("Z");

describe("real processes: the runner and the lifecycle together", () => {
  /** A stub wrangler that starts a grandchild (as wrangler starts workerd), optionally ignoring SIGINT and SIGTERM. */
  const stub = (/** @type {boolean} */ stubborn) => {
    const dir = makeRepo();
    const bin = join(dir, "node_modules", ".bin", "wrangler");
    writeFileSync(bin, `#!/bin/sh\n${stubborn ? "trap '' INT TERM\n" : ""}sleep 300 &\necho "grandchild $!"\nwait\n`);
    chmodSync(bin, 0o755);
    return dir;
  };

  for (const stubborn of [false, true]) {
    it(`SIGTERM stops a child and its grandchild${stubborn ? ", even when both ignore SIGINT and SIGTERM" : ""}`, async () => {
      /** @type {number[]} */
      const exits = [];
      const life = createLifecycle({
        kill: (pid, sig) => process.kill(pid, sig),
        exit: (code) => void exits.push(code),
        say: () => {},
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        later: (fn, ms) => void setTimeout(fn, ms),
        graceMs: 100,
        settleMs: 10,
      });
      const root = stub(stubborn);
      const runner = createRunner({ root, env: process.env, track: life.track });
      /** @type {string[]} */
      const lines = [];
      const child = runner.long("wrangler", ["dev"], { onLine: (l) => void lines.push(l) });
      for (let i = 0; i < 200 && !lines.length; i++) await new Promise((r) => setTimeout(r, 10));
      const grandchild = Number(lines[0]?.split(" ")[1]);
      expect(grandchild).toBeGreaterThan(0);
      expect(dead(grandchild)).toBe(false);
      life.signal("SIGTERM");
      const code = await child.done;
      expect(code).toBe(stubborn ? 137 : 130);
      for (let i = 0; i < 100 && !dead(grandchild); i++) await new Promise((r) => setTimeout(r, 20));
      expect(dead(grandchild)).toBe(true);
      for (let i = 0; i < 50 && !exits.length; i++) await new Promise((r) => setTimeout(r, 20));
      expect(exits).toEqual([143]);
    });
  }
});
