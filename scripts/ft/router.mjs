// The local router on :8780 (DEV-SPEC.md §3.2.1): one address for both Workers,
// split by path as production's routes split them. Local only, no state.
import http from "node:http";
import { M } from "./messages.mjs";

/** Cloudflare route matching for a path: a trailing `*` matches any suffix. */
/** @param {string} path @param {string} pattern */
export function matchesRoute(path, pattern) {
  return pattern.endsWith("*") ? path.startsWith(pattern.slice(0, -1)) : path === pattern;
}

/** Which Worker production would send this request to. */
/** @param {string} url @param {string[]} accountsPaths @returns {"site" | "accounts"} */
export function routeFor(url, accountsPaths) {
  const path = url.split("?")[0] ?? "/";
  return accountsPaths.some((p) => matchesRoute(path, p)) ? "accounts" : "site";
}

/**
 * @param {{ accountsPaths: string[], ports: Record<string, number> }} o
 */
export function createRouter({ accountsPaths, ports }) {
  return http.createServer((req, res) => {
    const target = routeFor(req.url ?? "/", accountsPaths);
    const port = ports[target];
    const upstream = http.request(
      // Everything as it came, Host included, so each Worker sees this address as its own origin.
      { host: "127.0.0.1", port, method: req.method, path: req.url, headers: req.headers },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.statusMessage, up.rawHeaders);
        up.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end(M.router.down(target, port ?? 0));
    });
    req.pipe(upstream);
  });
}
