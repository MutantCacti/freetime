import { describe, expect, it } from "vitest";
import { SMOKE, answeredBy, debugLine, evaluate, runSmoke } from "../../scripts/ft/smoke.mjs";
import { ft, liveFetch, makeRepo } from "./helpers.mjs";

const check = (/** @type {number} */ n) => /** @type {import("../../scripts/ft/smoke.mjs").SmokeCheck} */ (SMOKE.find((c) => c.n === n));

describe("smoke evaluation", () => {
  it("passes the healthy responses", async () => {
    const results = await runSmoke({ base: "https://site.example", fetch: liveFetch(), sleep: async () => {}, now: () => 0 });
    expect(results.filter((r) => r.problems.length)).toEqual([]);
    expect(results).toHaveLength(12);
  });

  it("names each missing header", () => {
    const res = { status: 200, headers: new Headers({ "content-type": "text/html" }) };
    const { problems } = evaluate(check(1), res, 'href="/account"');
    expect(problems).toEqual([
      "no Strict-Transport-Security",
      "no X-Content-Type-Options: nosniff",
      "no Referrer-Policy: strict-origin",
      "Content-Security-Policy without frame-ancestors 'none'",
      "no Cache-Control",
    ]);
  });

  it("catches a cookie on the read-only site", () => {
    const headers = new Headers({ "content-type": "text/html", "set-cookie": "a=b", "strict-transport-security": "x", "x-content-type-options": "nosniff", "referrer-policy": "strict-origin", "content-security-policy": "frame-ancestors 'none'", "cache-control": "no-store" });
    expect(evaluate(check(1), { status: 200, headers }, 'href="/account"').problems).toEqual(["sets a cookie"]);
  });

  it("tells the Workers apart by content", () => {
    expect(answeredBy('<a href="/account">Go to calendar</a>')).toBe("accounts");
    expect(answeredBy('<a href="/?view=week#h08">Go to calendar</a>')).toBe("site");
    expect(evaluate(check(11), { status: 404, headers: new Headers() }, '<a href="/?view=week#h08">Go to calendar</a>').wrongWorker).toBe(true);
  });

  it("reads only the code and reference from a 503", () => {
    const body = "<p>The calendar couldn't be loaded</p><p>FEED_STATUS_404 · ref 7K2Q9M · 2026-11-02 14:03Z</p>";
    expect(debugLine(body)).toEqual({ code: "FEED_STATUS_404", ref: "7K2Q9M" });
    expect(evaluate(check(1), { status: 503, headers: new Headers() }, body).debug).toEqual({ code: "FEED_STATUS_404", ref: "7K2Q9M" });
  });

  it("retries failing checks until they pass or time runs out", async () => {
    let t = 0;
    let calls = 0;
    const flaky = liveFetch({
      "GET /help": () => (++calls < 3 ? new Response("", { status: 522 }) : new Response("ok", { headers: { "content-type": "text/html" } })),
    });
    const results = await runSmoke({ base: "https://site.example", fetch: flaky, sleep: async (ms) => void (t += ms), now: () => t });
    expect(results.every((r) => r.problems.length === 0)).toBe(true);
    expect(calls).toBe(3);
    const dead = liveFetch({ "GET /help": () => new Response("", { status: 522 }) });
    t = 0;
    const after = await runSmoke({ base: "https://site.example", fetch: dead, sleep: async (ms) => void (t += ms), now: () => t, timeoutMs: 10_000 });
    expect(after.find((r) => r.check.n === 7)?.problems).toEqual(["status 522, expected 200", "content-type text/plain;charset=UTF-8, expected text/html"]);
    expect(t).toBeLessThanOrEqual(10_000);
  });
});

describe("./ft status", () => {
  it("is read-only, and reports a logged-out machine as a setup step", async () => {
    const dir = makeRepo();
    const r = await ft(["status"], {
      root: dir,
      handler: (c) => {
        if (c.args[0] === "whoami") return { stdout: "You are not authenticated." };
        if (c.args[1] === "migrations") return { stdout: "✅ No migrations to apply!" };
        if (c.args.join(" ") === "rev-parse --abbrev-ref HEAD") return { stdout: "main\n" };
        if (c.args[0] === "log") return { stdout: "abc1234\tA commit\n" };
        return undefined;
      },
      deps: { fetch: liveFetch() },
    });
    expect(r.code).toBe(3);
    expect(r.output).toContain("12 of 12 checks passed");
    expect(r.calls.filter((c) => ["deploy", "secret"].includes(c.args[0] ?? "") || c.args.includes("apply"))).toEqual([]);
  });

  it("--offline makes no network request and no Cloudflare call", async () => {
    const dir = makeRepo();
    let fetched = false;
    const r = await ft(["status", "--offline"], {
      root: dir,
      deps: { fetch: /** @type {any} */ (async () => ((fetched = true), new Response(""))), resolves: async () => ((fetched = true), true) },
    });
    expect(fetched).toBe(false);
    expect(r.calls.filter((c) => c.program === "wrangler" && !c.args.includes("--local"))).toEqual([]);
  });
});
