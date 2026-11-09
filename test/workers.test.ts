import { describe, expect, it } from "vitest";
import accountsConfig from "../wrangler.accounts.toml?raw";
import { makeApp } from "./helpers";

// The two Workers (ACCOUNTS-SPEC.md §1): the read-only site never depends on
// accounts, never claims an accounts path, and looks the same with a session cookie.
const src = import.meta.glob("/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const css = import.meta.glob("/public/css/*.css", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** The stylesheets and scripts a page loads, in order. */
export function assetsOf(html: string): string[] {
  return [...html.matchAll(/<(?:link rel="stylesheet"|script) (?:href|src)="([^"]+)"/g)].map((m) => m[1]!);
}

export const SHARED_ASSETS = ["/css/fonts.css", "/css/tokens.css", "/css/app.css", "/css/calendar.css", "/js/head.js", "/js/app.js"];

describe("the two Workers", () => {
  it("the main Worker never imports the accounts Worker's code", () => {
    const offenders = Object.entries(src)
      .filter(([path]) => !path.startsWith("/src/accounts/"))
      .filter(([, text]) => /from\s+["'][^"']*accounts\//.test(text))
      .map(([path]) => path);
    expect(Object.keys(src).length).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });

  it("the main Worker's pages are the same with or without a session cookie", async () => {
    const app = makeApp();
    for (const path of ["/?view=week&date=2026-11-02&dtz=Europe/London", "/help", "/free-busy.ics?from=2026-11-02&to=2026-11-08"]) {
      const plain = await app.get(path);
      const withCookie = await app.get(path, { headers: { cookie: "__Host-session=abc123" } });
      expect(withCookie.status, path).toBe(plain.status);
      expect(withCookie.headers.get("set-cookie"), path).toBeNull();
      expect(await withCookie.text(), path).toBe(await plain.text());
    }
  });

  it("no path belongs to both: the accounts Worker's routes aren't the main site's", async () => {
    const patterns = [...accountsConfig.matchAll(/pattern = "freetime\.mutantcacti\.com(\/[^"]*)"/g)].map((m) => m[1]!);
    expect(patterns).toEqual(["/account*", "/u/*", "/@*", "/spaces*", "/s/*", "/auth/*"]);
    const app = makeApp();
    const html = await app.html("/?view=week&date=2026-11-02");
    const mainPaths = new Set(["/", "/help", "/contact", "/export", "/tz", "/free-busy.ics", "/css/", "/img/", "/js/", "/fonts/", "/favicon.svg"]);
    for (const p of patterns) {
      const prefix = p.replace(/\*$/, "");
      for (const m of mainPaths) if (m !== "/") expect(m.startsWith(prefix) || prefix.startsWith(m), `${p} vs ${m}`).toBe(false);
    }
    // The main site links to /account, which the accounts Worker answers.
    expect(html).toContain('href="/account');
    expect((await app.get("/account")).status).toBe(404);
  });

  it("there is one stylesheet set, and the main site loads all of it", async () => {
    expect(Object.keys(css).sort()).toEqual(["/public/css/app.css", "/public/css/fonts.css", "/public/css/tokens.css"]);
    expect(assetsOf(await makeApp().html("/help"))).toEqual(SHARED_ASSETS);
  });
});
