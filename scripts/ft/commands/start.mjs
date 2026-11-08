// ./ft start (DEV-SPEC.md §3.2): both Workers in one terminal, plus the local router.
import { depsState, devVarsState, nodeOk } from "../checks.mjs";
import { readRepoFile, routePaths } from "../config.mjs";
import { M } from "../messages.mjs";
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

/** @param {import("../cli.mjs").Ctx} ctx */
export async function run(ctx) {
  const { out, runner, flags, root, deps } = ctx;
  /** @type {("site" | "accounts")[]} */
  const which = flags.only ? [flags.only] : ["site", "accounts"];
  const ports = portsWith(flags["port-offset"] ?? 0);
  const useRouter = !flags.only && !flags["no-router"];
  const live = Boolean(flags.live) && which.includes("site");
  const grace = deps.stopGraceMs ?? 5_000;

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

  if (which.includes("accounts") && !(await localDatabase(ctx))) return 1;

  /** @type {{ w: "site" | "accounts", child: import("../run.mjs").LongChild }[]} */
  const children = which.map((w) => ({ w, child: runner.long("wrangler", devArgs(w, ports, live), { onLine: (l) => out.prefixed(w, l) }) }));

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
  const finished = new Promise((resolve) => (finish = resolve));

  /** @param {import("../run.mjs").LongChild} child */
  const stopChild = async (child) => {
    const steps = /** @type {const} */ (["SIGINT", "SIGTERM", "SIGKILL"]);
    for (const sig of steps) {
      child.signal(sig);
      const done = await Promise.race([child.done.then(() => true), deps.sleep(grace).then(() => false)]);
      if (done) return;
    }
  };

  /** @param {number} code @param {string} [why] */
  const stopAll = async (code, why) => {
    if (stopping) return;
    stopping = true;
    if (why) out.text(why);
    await Promise.all(children.map((c) => stopChild(c.child)));
    await new Promise((resolve) => (server ? server.close(() => resolve(undefined)) : resolve(undefined)));
    out.text(M.start.stopped(which));
    for (const p of needed) if (p !== undefined && (await deps.portBusy(p))) out.check("warn", "ports", M.start.stillBusy(p));
    finish(code);
  };

  const offInterrupt = deps.onInterrupt(() => {
    out.text("");
    void stopAll(130);
  });

  for (const { w, child } of children) {
    child.done.then((code) => {
      if (stopping) return;
      const others = which.filter((x) => x !== w);
      void stopAll(1, M.start.crashed(w, code, others));
    });
  }

  if (useRouter && !server) void stopAll(1);
  else {
    // Ready once each Worker answers. The router, if any, is already listening.
    const ready = await Promise.all(which.map((w) => deps.waitHttp(ports[w] ?? 0, 60_000)));
    if (!stopping) {
      if (ready.every(Boolean)) out.block(M.start.ready(ports, Boolean(server), which));
      else void stopAll(1, M.start.notReady(which.filter((_, i) => !ready[i])));
    }
  }

  const code = /** @type {number} */ (await finished);
  offInterrupt();
  return code;
}
