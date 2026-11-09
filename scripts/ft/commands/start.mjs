// ./ft start (DEV-SPEC.md §3.2): both Workers in one terminal, plus the local router.
import { depsState, devVarsState, nodeOk } from "../checks.mjs";
import { readRepoFile, routePaths } from "../config.mjs";
import { exitFor, stopGroup } from "../lifecycle.mjs";
import { M } from "../messages.mjs";
import { mutedWhen, stripAnsi } from "../output.mjs";
import { createRouter as defaultRouter } from "../router.mjs";
import { WORKERS, portsWith } from "../workers.mjs";
import { localDatabase } from "./install.mjs";

/**
 * The wrangler dev arguments for one Worker.
 * @param {"site" | "accounts"} w @param {Record<string, number>} ports @param {boolean} live
 */
export function devArgs(w, ports, live) {
  const env = w === "site" && live ? ["--env="] : ["--env", "dev"];
  return [
    "dev",
    ...WORKERS[w].configArgs,
    ...env,
    "--ip",
    "127.0.0.1",
    "--port",
    String(ports[w]),
    "--inspector-port",
    String(ports[`${w}Inspector`]),
    "--show-interactive-dev-session=false",
  ];
}

/** start says itself how it stopped (cli.mjs). */
export const ownsInterrupt = true;

/** How many of a Worker's last lines are shown again when it stops on its own. */
const LAST_LINES = 12;

/** @param {import("../cli.mjs").Ctx} ctx */
export async function run(ctx) {
  const { deps } = ctx;
  /** @type {NodeJS.Signals | null} */
  let signalled = null;
  /** @type {((code: number) => void) | null} */
  let onSignal = null;
  // From here on a signal is start's to handle: before the Workers start it stops the
  // local migration; once they run, it stops both and the router (stopAll below).
  const off = deps.onInterrupt((sig, { forced } = { forced: false }) => {
    if (forced) return; // ft kills everything and exits.
    signalled = sig ?? "SIGINT";
    if (onSignal) onSignal(exitFor(signalled));
    else void deps.stopChildren?.();
  });
  try {
    return await runStart(ctx, {
      signalled: () => signalled,
      /** @param {(code: number) => void} f */
      setOnSignal: (f) => void (onSignal = f),
    });
  } finally {
    off();
  }
}

/**
 * @param {import("../cli.mjs").Ctx} ctx
 * @param {{ signalled: () => NodeJS.Signals | null, setOnSignal: (f: (code: number) => void) => void }} sig
 */
async function runStart(ctx, sig) {
  const { out, runner, flags, root, deps } = ctx;
  /** @type {("site" | "accounts")[]} */
  const which = flags.only ? [flags.only] : ["site", "accounts"];
  const ports = portsWith(flags["port-offset"] ?? 0);
  const useRouter = !flags.only && !flags["no-router"];
  const live = Boolean(flags.live) && which.includes("site");
  const grace = deps.stopGraceMs ?? 3_000;

  if (!nodeOk(deps.nodeVersion)) {
    out.check("fail", "node", M.node.old(deps.nodeVersion));
    return 1;
  }
  if (!depsState(root).ok) {
    out.check("fail", "deps", M.common.needInstall);
    return 1;
  }
  if (live) {
    const dv = devVarsState(root);
    if (dv.state !== "ok") {
      out.check("fail", "dev-vars", dv.state === "absent" ? M.devVars.neededForLive : dv.state === "no-key" ? M.devVars.noKey : M.devVars.placeholder, [M.devVars.forLive]);
      return 3;
    }
    for (const [name, value] of Object.entries(dv.values)) out.redactor.add(name, value);
  }

  const needed = [...which.flatMap((w) => [ports[w], ports[`${w}Inspector`]]), ...(useRouter ? [ports.router] : [])];
  let busy = false;
  for (const p of needed) {
    if (p !== undefined && (await deps.portBusy(p))) {
      out.check("fail", "ports", M.start.portBusy(p));
      busy = true;
    }
  }
  if (busy) {
    out.text(M.start.portBusyHint);
    return 1;
  }

  if (which.includes("accounts")) {
    const ok = await localDatabase({ ...ctx, out: mutedWhen(out, () => sig.signalled() !== null) });
    const early = sig.signalled();
    if (early) {
      out.text(M.lifecycle.stopped(early));
      return exitFor(early);
    }
    if (!ok) return 1;
  }

  /** @type {Record<string, string[]>} */
  const recent = {};
  /** @param {"site" | "accounts"} w */
  const lineTo = (w) => (/** @type {string} */ l) => {
    out.prefixed(w, l);
    const plain = stripAnsi(l).trimEnd();
    if (!plain.trim()) return;
    const r = (recent[w] ??= []);
    r.push(plain);
    if (r.length > LAST_LINES) r.shift();
  };

  /** @type {{ w: "site" | "accounts", child: import("../run.mjs").LongChild }[]} */
  const children = which.map((w) => ({ w, child: runner.long("wrangler", devArgs(w, ports, live), { onLine: lineTo(w) }) }));

  /** @type {import("node:http").Server | null} */
  let server = null;
  if (useRouter) {
    const accountsPaths = routePaths(readRepoFile(root, WORKERS.accounts.config));
    server = (deps.createRouter ?? defaultRouter)({ accountsPaths, ports });
    const srv = server;
    await new Promise((resolve, reject) => {
      srv.once("error", reject);
      srv.listen(ports.router, "127.0.0.1", () => resolve(undefined));
    }).catch(() => {
      out.check("fail", "ports", M.start.portBusy(ports.router ?? 0));
      server = null;
    });
  }

  let stopping = false;
  /** @type {(code: number) => void} */
  let finish = () => {};
  const finished = /** @type {Promise<number>} */ (new Promise((resolve) => (finish = resolve)));
  // Stops the readiness checks as soon as anything stops.
  const waiting = new AbortController();

  /** @param {number} code @param {() => void} [say] */
  const stopAll = async (code, say) => {
    if (stopping) return;
    stopping = true;
    waiting.abort();
    say?.();
    await Promise.all(children.map((c) => stopGroup(c.child, { graceMs: grace, sleep: deps.sleep })));
    const srv = server;
    if (srv) {
      // close() alone waits for every open connection (a browser's keep-alive) to end.
      await new Promise((resolve) => {
        srv.close(() => resolve(undefined));
        srv.closeAllConnections?.();
      });
    }
    out.text(M.start.stopped(which));
    for (const p of needed) if (p !== undefined && (await deps.portBusy(p))) out.check("warn", "ports", M.start.stillBusy(p));
    finish(code);
  };

  sig.setOnSignal((code) => {
    const s = sig.signalled() ?? "SIGINT";
    void stopAll(code, () => (out.text(""), out.text(M.start.stopping(s))));
  });

  for (const { w, child } of children) {
    child.done.then((code) => {
      if (stopping) return;
      const others = which.filter((x) => x !== w);
      void stopAll(1, () => {
        out.text(M.start.crashed(w, code, others));
        const last = recent[w] ?? [];
        out.text(last.length ? M.start.lastLines(w) : M.start.noOutput(w));
        for (const l of last) out.prefixed(w, l);
      });
    });
  }

  if (useRouter && !server) void stopAll(1);
  else {
    // Ready once each Worker answers; given up as soon as anything stops. The router, if any, is already listening.
    const ready = Promise.all(which.map((w) => deps.waitHttp(ports[w] ?? 0, 60_000, waiting.signal)));
    const r = await Promise.race([ready, finished.then(() => null)]);
    if (r && !stopping) {
      if (r.every(Boolean)) out.block(M.start.ready(ports, Boolean(server), which));
      else void stopAll(1, () => out.text(M.start.notReady(which.filter((_, i) => !r[i]))));
    }
  }

  return finished;
}
