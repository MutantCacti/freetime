// Live smoke checks (DEV-SPEC.md §5.5): read-only requests to the production host.
// Nothing here signs up, signs in or sends email.
import { M } from "./messages.mjs";

/**
 * @typedef {object} SmokeCheck
 * @property {number} n
 * @property {"GET" | "HEAD" | "POST"} method
 * @property {string} path
 * @property {number} status
 * @property {string} [type]          expected content type prefix
 * @property {boolean} [headers]      the security headers must be there
 * @property {boolean} [noCookie]     no Set-Cookie
 * @property {string} [contains]      a string the body must contain
 * @property {string} [filename]      expected Content-Disposition filename
 * @property {"site" | "accounts"} [worker] which Worker must answer (told apart by content)
 */

/** @type {SmokeCheck[]} */
export const SMOKE = [
  { n: 1, method: "GET", path: "/", status: 200, type: "text/html", headers: true, noCookie: true, contains: 'href="/account"' },
  { n: 2, method: "HEAD", path: "/", status: 200 },
  { n: 3, method: "POST", path: "/", status: 405 },
  { n: 4, method: "GET", path: "/free-busy.ics", status: 200, type: "text/calendar", filename: "mutantcacti-busy.ics" },
  { n: 5, method: "GET", path: "/css/app.css", status: 200, type: "text/css" },
  { n: 6, method: "GET", path: "/css/calendar.css", status: 200, type: "text/css" },
  { n: 7, method: "GET", path: "/help", status: 200, type: "text/html" },
  { n: 8, method: "GET", path: "/account", status: 200, type: "text/html", headers: true, contains: 'href="/account/sign-in', worker: "accounts" },
  { n: 9, method: "GET", path: "/account/sign-in", status: 200, type: "text/html" },
  { n: 10, method: "GET", path: "/account/sign-up", status: 200, type: "text/html" },
  { n: 11, method: "GET", path: "/account/ft-missing", status: 404, worker: "accounts" },
  { n: 12, method: "GET", path: "/u/ft-missing", status: 404, worker: "accounts" },
];

/**
 * The accounts Worker's 404 and pages link home to /account; the site's 404 links to the calendar.
 * @param {string} body
 */
export function answeredBy(body) {
  if (/<a href="\/account">/.test(body) || body.includes('href="/account/sign-in')) return "accounts";
  return "site";
}

/** The site's debug line, for example `FEED_STATUS_404 · ref 7K2Q9M`. Nothing else from the page. */
/** @param {string} body */
export function debugLine(body) {
  const m = body.match(/\b([A-Z][A-Z0-9_]{2,}) · ref ([A-Z0-9]{6})\b/);
  return m ? { code: m[1] ?? "", ref: m[2] ?? "" } : null;
}

/**
 * Problems with one response, as short keys the messages module words.
 * @param {SmokeCheck} c @param {{ status: number, headers: Headers }} res @param {string} body
 * @returns {{ problems: string[], wrongWorker: boolean, debug: { code: string, ref: string } | null }}
 */
export function evaluate(c, res, body) {
  const P = M.smoke.problem;
  /** @type {string[]} */
  const problems = [];
  const h = res.headers;
  if (res.status !== c.status) problems.push(P.status(res.status, c.status));
  if (c.type && !(h.get("content-type") ?? "").startsWith(c.type)) problems.push(P.type(h.get("content-type") ?? "", c.type));
  if (c.headers) {
    if (!h.get("strict-transport-security")) problems.push(P.hsts);
    if (h.get("x-content-type-options") !== "nosniff") problems.push(P.nosniff);
    if (h.get("referrer-policy") !== "strict-origin") problems.push(P.referrer);
    if (!(h.get("content-security-policy") ?? "").includes("frame-ancestors 'none'")) problems.push(P.csp);
    if (!h.get("cache-control")) problems.push(P.cache);
  }
  if (c.noCookie && h.get("set-cookie")) problems.push(P.cookie);
  if (c.filename && !(h.get("content-disposition") ?? "").includes(c.filename)) problems.push(P.filename(c.filename));
  if (c.contains && !body.includes(c.contains)) problems.push(P.contains(c.contains));
  const wrongWorker = Boolean(c.worker && answeredBy(body) !== c.worker);
  if (wrongWorker) problems.push(P.wrongWorker(c.worker === "accounts" ? "site" : "accounts"));
  const debug = res.status >= 500 ? debugLine(body) : null;
  return { problems, wrongWorker, debug };
}

/**
 * Runs every check; failing ones are retried every `intervalMs` until `timeoutMs`,
 * because new versions and routes take a few seconds to reach every data centre.
 * @param {{ base: string, fetch: typeof fetch, sleep: (ms: number) => Promise<void>, now: () => number, timeoutMs?: number, intervalMs?: number, checks?: SmokeCheck[] }} o
 */
export async function runSmoke({ base, fetch, sleep, now, timeoutMs = 30_000, intervalMs = 2_000, checks = SMOKE }) {
  const deadline = now() + timeoutMs;
  /** @type {Map<number, { check: SmokeCheck, problems: string[], wrongWorker: boolean, debug: { code: string, ref: string } | null }>} */
  const results = new Map();
  let pending = checks;
  for (;;) {
    for (const c of pending) {
      try {
        const res = await fetch(new URL(c.path, base), {
          method: c.method,
          redirect: "manual",
          headers: { "user-agent": "freetime-ft-smoke" },
          signal: AbortSignal.timeout(10_000),
        });
        const body = c.method === "HEAD" ? "" : await res.text();
        results.set(c.n, { check: c, ...evaluate(c, res, body) });
      } catch (e) {
        results.set(c.n, { check: c, problems: [M.smoke.problem.noAnswer(/** @type {Error} */ (e).name)], wrongWorker: false, debug: null });
      }
    }
    pending = checks.filter((c) => (results.get(c.n)?.problems.length ?? 1) > 0);
    if (pending.length === 0 || now() + intervalMs > deadline) break;
    await sleep(intervalMs);
  }
  return checks.map((c) => /** @type {NonNullable<ReturnType<typeof results.get>>} */ (results.get(c.n)));
}
