import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createRouter } from "../../scripts/ft/router.mjs";
import { devArgs } from "../../scripts/ft/commands/start.mjs";
import { tailArgs } from "../../scripts/ft/commands/logs.mjs";
import { PORTS } from "../../scripts/ft/workers.mjs";
import { ft, longChildren, makeRepo } from "./helpers.mjs";

afterEach(() => {
  longChildren.length = 0;
});

/** Runs ./ft start with fake children; `script(children, interrupt)` drives them once they've started. */
async function start(/** @type {string[]} */ argv, /** @type {(children: any[], interrupt: (sig?: string, o?: { forced: boolean }) => void) => Promise<void> | void} */ script, deps = {}) {
  /** @type {(sig?: string, o?: { forced: boolean }) => void} */
  let interrupt = () => {};
  const run = ft(["start", ...argv], {
    root: makeRepo(),
    deps: {
      sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 20))),
      stopGraceMs: 20,
      onInterrupt: (h) => ((interrupt = /** @type {any} */ (h)), () => {}),
      ...deps,
    },
  });
  // Wait until ft has started its children.
  for (let i = 0; i < 100 && longChildren.length < (argv.includes("--only") ? 1 : 2); i++) await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setTimeout(r, 10));
  await script(longChildren, interrupt);
  return run;
}

describe("./ft start", () => {
  it("starts both Workers with fixed ports and prefixes their lines", async () => {
    const r = await start(["--no-router"], (children, interrupt) => {
      children[0].onLine("Ready on http://127.0.0.1:8787");
      children[1].onLine("--- email to you@example.com");
      for (const c of children) c.onSignal = () => c.exit(0);
      interrupt();
    });
    expect(r.code).toBe(130);
    expect(r.output).toContain("site     | Ready on http://127.0.0.1:8787");
    expect(r.output).toContain("accounts | --- email to you@example.com");
    expect(r.output).toContain("Stopped site and accounts.");
    const longs = r.calls.filter((c) => c.kind === "long");
    expect(longs.map((c) => c.args)).toEqual([devArgs("site", PORTS, false), devArgs("accounts", PORTS, false)]);
    // Local migrations first.
    expect(r.calls[0]?.args.slice(0, 5)).toEqual(["d1", "migrations", "apply", "freetime-accounts-dev", "--local"]);
  });

  it("escalates SIGINT, SIGTERM, SIGKILL for a child that won't stop", async () => {
    /** @type {any[]} */
    let kids = [];
    const r = await start(["--no-router"], (children, interrupt) => {
      kids = children;
      children[0].onSignal = (/** @type {string} */ s) => s === "SIGKILL" && children[0].exit(137);
      children[1].onSignal = () => children[1].exit(0);
      interrupt();
    });
    expect(r.code).toBe(130);
    expect(kids[0].signals).toEqual(["SIGINT", "SIGTERM", "SIGKILL"]);
    expect(kids[1].signals).toEqual(["SIGINT"]);
  });

  it("stops the other Worker when one stops on its own, and never restarts it", async () => {
    const r = await start(["--no-router"], (children) => {
      children[1].onSignal = () => children[1].exit(0);
      children[0].exit(1);
    });
    expect(r.code).toBe(1);
    expect(r.output).toContain("site stopped unexpectedly (exit 1). Stopping accounts too.");
    expect(r.calls.filter((c) => c.kind === "long")).toHaveLength(2);
  });

  for (const [sig, code] of /** @type {const} */ ([["SIGTERM", 143], ["SIGHUP", 129]])) {
    it(`${sig} stops both Workers and exits ${code}`, async () => {
      /** @type {any[]} */
      let kids = [];
      const r = await start(["--no-router"], (children, interrupt) => {
        kids = children;
        for (const c of children) c.onSignal = () => c.exit(0);
        interrupt(sig);
      });
      expect(r.code).toBe(code);
      expect(kids.map((k) => k.signals)).toEqual([["SIGINT"], ["SIGINT"]]);
      expect(r.output).toContain(`${sig}${sig === "SIGHUP" ? " (the terminal closed)" : ""}: stopping.`);
      expect(r.output).toContain("Stopped site and accounts.");
    });
  }

  it("a Worker that stops on its own: names it, shows its last lines, stops the other, exit 1", async () => {
    /** @type {any[]} */
    let kids = [];
    const r = await start(["--no-router"], (children) => {
      kids = children;
      children[0].onLine("site is fine");
      children[1].onLine("\x1b[31m✘ [ERROR] Address already in use (127.0.0.1:8788).\x1b[0m");
      children[1].onLine("");
      children[0].onSignal = () => children[0].exit(0);
      children[1].exit(1);
    });
    expect(r.code).toBe(1);
    expect(kids[0].signals).toEqual(["SIGINT"]);
    const after = r.output.slice(r.output.indexOf("accounts stopped unexpectedly (exit 1). Stopping site too."));
    expect(after).toContain("Last lines from accounts:\naccounts | ✘ [ERROR] Address already in use (127.0.0.1:8788).");
    expect(after).not.toContain("site is fine");
    expect(after).toContain("Stopped site and accounts.");
  });

  it("a Worker that stops while starting ends the wait for it at once", async () => {
    /** @type {AbortSignal[]} */
    const signals = [];
    const r = await start(
      ["--no-router"],
      (children) => {
        children[1].onSignal = () => children[1].exit(0);
        children[0].exit(1);
      },
      {
        // Never ready by itself: only the abort ends it.
        waitHttp: (_p, _t, /** @type {AbortSignal} */ signal) => (signals.push(signal), new Promise((res) => signal.addEventListener("abort", () => res(false)))),
      },
    );
    expect(r.code).toBe(1);
    expect(signals.length).toBe(2);
    expect(signals.every((s) => s.aborted)).toBe(true);
    expect(r.output).not.toContain("didn't answer");
    expect(r.output).not.toContain("Ready.");
  });

  it("a Worker that never answers: stops both, exit 1", async () => {
    const r = await start(
      ["--no-router"],
      (children) => {
        for (const c of children) c.onSignal = () => c.exit(0);
      },
      { waitHttp: async (/** @type {number} */ p) => p === 8787 },
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("accounts didn't answer within 60 seconds. Stopping.");
    expect(r.output).toContain("Stopped site and accounts.");
  });

  it("a signal during the local migration stops it, starts nothing, and doesn't report the cut-short migration", async () => {
    /** @type {(sig?: string) => void} */
    let interrupt = () => {};
    let stopped = 0;
    const r = await ft(["start"], {
      root: makeRepo(),
      handler: (c) => {
        if (c.args.includes("freetime-accounts-dev")) {
          interrupt("SIGTERM");
          return { code: 143, stdout: "killed" };
        }
        return undefined;
      },
      deps: { onInterrupt: (h) => ((interrupt = /** @type {any} */ (h)), () => {}), stopChildren: async () => void stopped++ },
    });
    expect(r.code).toBe(143);
    expect(stopped).toBe(1);
    expect(r.calls.some((c) => c.kind === "long")).toBe(false);
    expect(r.output).not.toContain("local-db");
    expect(r.output).toContain("Stopped by SIGTERM.");
  });

  it("closes the router even with a keep-alive connection open, and frees its port", async () => {
    const offset = 3000 + Math.floor(Math.random() * 500);
    const routerPort = PORTS.router + offset;
    /** @type {import("node:http").Server | null} */
    let server = null;
    /** @type {http.Agent | null} */
    let agent = null;
    const r = await start(["--port-offset", String(offset)], async (children, interrupt) => {
      for (const c of children) c.onSignal = () => c.exit(0);
      // A browser-like keep-alive connection to the router (the Workers are fakes, so it's a 502).
      agent = new http.Agent({ keepAlive: true });
      await new Promise((res) => http.get({ host: "127.0.0.1", port: routerPort, path: "/", agent: /** @type {any} */ (agent) }, (resp) => (resp.resume(), resp.on("end", res))));
      interrupt();
    }, {
      createRouter: (/** @type {any} */ o) => (server = createRouter(o)),
    });
    expect(r.code).toBe(130);
    expect(/** @type {any} */ (server).listening).toBe(false);
    const free = await new Promise((res) => {
      const s = http.createServer();
      s.once("error", () => res(false));
      s.listen(routerPort, "127.0.0.1", () => s.close(() => res(true)));
    });
    expect(free).toBe(true);
    /** @type {any} */ (agent)?.destroy();
  });

  it("stops before starting anything when a port is busy", async () => {
    const r = await ft(["start"], { root: makeRepo(), deps: { portBusy: async (p) => p === 8787 } });
    expect(r.code).toBe(1);
    expect(r.output).toContain("Port 8787 is in use.");
    expect(r.calls).toEqual([]);
  });

  it("--port-offset moves every port", async () => {
    /** @type {number[]} */
    const asked = [];
    const r = await ft(["start", "--port-offset", "100"], { root: makeRepo(), deps: { portBusy: async (p) => (asked.push(p), true) } });
    expect(r.code).toBe(1);
    expect(asked.sort()).toEqual([8880, 8887, 8888, 9329, 9330]);
  });

  it("--live needs .dev.vars (exit 3)", async () => {
    const r = await ft(["start", "--live"], { root: makeRepo() });
    expect(r.code).toBe(3);
    expect(r.output).toContain("copy .dev.vars.example to .dev.vars");
  });

  it("--only starts one Worker and no router", async () => {
    const r = await start(["--only", "site"], (children, interrupt) => {
      children[0].onSignal = () => children[0].exit(0);
      interrupt();
    });
    expect(r.calls.filter((c) => c.kind === "long").map((c) => c.args[0])).toEqual(["dev"]);
    expect(r.calls.some((c) => c.args.includes("freetime-accounts-dev"))).toBe(false);
    expect(r.output).not.toContain("8780");
  });
});

describe("the local router", () => {
  it("passes method, path, body and headers through unchanged, Host included", async () => {
    /** @type {Record<string, any>} */
    const seen = {};
    const upstream = (/** @type {string} */ name) =>
      http.createServer((req, res) => {
        let body = "";
        req.on("data", (d) => (body += d));
        req.on("end", () => {
          seen[name] = { method: req.method, url: req.url, host: req.headers.host, origin: req.headers.origin, body };
          res.writeHead(201, [["set-cookie", "a=1"], ["set-cookie", "b=2"], ["x-worker", name]].flat());
          res.end(name);
        });
      });
    const site = upstream("site");
    const accounts = upstream("accounts");
    await new Promise((r) => site.listen(0, "127.0.0.1", () => r(undefined)));
    await new Promise((r) => accounts.listen(0, "127.0.0.1", () => r(undefined)));
    const port = (/** @type {http.Server} */ s) => /** @type {import("node:net").AddressInfo} */ (s.address()).port;
    const router = createRouter({ accountsPaths: ["/account*", "/u/*"], ports: { site: port(site), accounts: port(accounts) } });
    await new Promise((r) => router.listen(0, "127.0.0.1", () => r(undefined)));
    const base = `http://127.0.0.1:${port(router)}`;
    try {
      const a = await fetch(`${base}/account/sign-up?x=1`, { method: "POST", headers: { origin: base }, body: "email=a%40b.c" });
      expect(a.status).toBe(201);
      expect(await a.text()).toBe("accounts");
      expect(a.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
      expect(seen.accounts).toEqual({ method: "POST", url: "/account/sign-up?x=1", host: `127.0.0.1:${port(router)}`, origin: base, body: "email=a%40b.c" });
      const s = await fetch(`${base}/css/app.css`);
      expect(await s.text()).toBe("site");
      expect(seen.site.url).toBe("/css/app.css");
      // A Worker that isn't answering: a plain 502 naming it.
      await new Promise((r) => site.close(() => r(undefined)));
      const down = await fetch(`${base}/`);
      expect(down.status).toBe(502);
      expect(await down.text()).toContain("the site Worker isn't answering");
    } finally {
      router.close();
      accounts.close();
    }
  });
});

describe("./ft logs", () => {
  it("tails the right Worker, filtered by reference", async () => {
    expect(tailArgs("accounts", { ref: "7K2Q9M", errors: true })).toEqual(["tail", "-c", "wrangler.accounts.toml", "--format", "pretty", "--search", "7K2Q9M", "--status", "error"]);
    const r = await ft(["logs", "site"], { handler: (c) => (c.args[0] === "whoami" ? { stdout: "You are logged in with an OAuth Token, associated with the email m@example.com." } : undefined) });
    expect(r.calls.at(-1)).toMatchObject({ kind: "interactive", args: ["tail", "--format", "pretty"] });
    const out = await ft(["logs", "site"], { handler: (c) => (c.args[0] === "whoami" ? { stdout: "You are not authenticated." } : undefined) });
    expect(out.code).toBe(3);
  });
});

describe("./ft install and ./ft test", () => {
  it("install doesn't run npm ci when node_modules matches", async () => {
    const r = await ft(["install"], { root: makeRepo(), handler: (c) => (c.args[0] === "whoami" ? { stdout: "You are not authenticated." } : undefined) });
    expect(r.code).toBe(0);
    expect(r.calls.some((c) => c.program === "npm")).toBe(false);
    expect(r.output).toContain("Ready. Next: ./ft start");
  });

  it("test, stopped by a signal: nothing more starts, one line says so, exit 143", async () => {
    /** @type {string | null} */
    let sig = null;
    const r = await ft(["test"], {
      root: makeRepo(),
      // The signal arrives while npm test runs; ft stops it (here: it exits 143).
      handler: (c) => (c.args[0] === "test" ? ((sig = "SIGTERM"), { code: 143 }) : undefined),
      deps: { interrupted: () => /** @type {any} */ (sig) },
    });
    expect(r.code).toBe(143);
    expect(r.calls.map((c) => c.args.join(" "))).toEqual(["test"]);
    expect(r.output).toContain("Stopped by SIGTERM.");
    expect(r.output).not.toContain("FAIL");
    expect(r.output).not.toContain("internal error");
  });

  it("test runs both and reports both", async () => {
    const r = await ft(["test"], { root: makeRepo(), handler: (c) => (c.args[0] === "test" ? { code: 1 } : undefined) });
    expect(r.code).toBe(1);
    expect(r.calls.map((c) => c.args.join(" "))).toEqual(["test", "run typecheck"]);
    expect(r.output).toContain("FAIL  tests");
    expect(r.output).toContain("ok    typecheck");
  });
});
