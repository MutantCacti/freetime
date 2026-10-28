import { describe, expect, it } from "vitest";
import { decode, makeApp } from "./helpers";

const app = makeApp();

describe("routes", () => {
  it.each(["POST", "PUT", "DELETE", "PATCH"])("%s returns 405", async (method) => {
    for (const path of ["/", "/help", "/free-busy.ics", "/css/app.css", "/nope"]) {
      const res = await app.get(path, { method });
      expect(res.status, `${method} ${path}`).toBe(405);
      expect(res.headers.get("allow")).toBe("GET, HEAD");
      expect(decode(await res.text())).toContain("This site is read-only.");
    }
  });

  it("HEAD works and has no body", async () => {
    const res = await app.get("/", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("serves every page", async () => {
    for (const path of ["/", "/help", "/contact", "/export", "/tz", "/free-busy.ics"]) {
      expect((await app.get(path)).status, path).toBe(200);
    }
  });

  it("serves static files with the same headers", async () => {
    for (const [path, type] of [
      ["/css/tokens.css", "text/css"],
      ["/css/app.css", "text/css"],
      ["/js/head.js", "javascript"],
      ["/js/app.js", "javascript"],
      ["/favicon.svg", "image/svg+xml"],
    ] as const) {
      const res = await app.get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type"), path).toContain(type);
      expect(res.headers.get("content-security-policy"), path).toContain("default-src 'self'");
    }
  });

  it("returns 404 with a page for unknown paths", async () => {
    const res = await app.get("/no/such/page");
    expect(res.status).toBe(404);
    expect(decode(await res.text())).toContain("Page not found");
  });

  it("sends the security headers", async () => {
    const res = await app.get("/");
    const csp = res.headers.get("content-security-policy")!;
    expect(res.headers.get("strict-transport-security")).toMatch(/^max-age=\d+/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers.get("cache-control")).toBe("private, max-age=60");
  });

  it("has no inline scripts, inline styles or forms that post", async () => {
    for (const path of ["/", "/?view=range", "/help", "/contact", "/export", "/tz", "/nope"]) {
      const html = await app.html(path);
      expect(html, path).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
      expect(html, path).not.toMatch(/\sstyle="/);
      expect(html, path).not.toMatch(/<style/);
      expect(html, path).not.toMatch(/method="post"/i);
      expect(html, path).not.toMatch(/\son[a-z]+="/);
    }
  });

  it("external links use rel=noopener noreferrer", async () => {
    const html = await app.html("/contact");
    const external = [...html.matchAll(/<a\b[^>]*href="https?:[^"]*"[^>]*>/g)].map((m) => m[0]);
    expect(external.length).toBe(4);
    for (const tag of external) expect(tag).toContain('rel="noopener noreferrer"');
    expect(html).toContain('href="mailto:mutantcacti@gmail.com"');
  });
});
