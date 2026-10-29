import { describe, expect, it } from "vitest";
import { SITE_HOST } from "../src/config";
import { makeApp } from "./helpers";

// The site's name is written once, in src/config.ts (SITE_HOST), and in the
// route in wrangler.toml. Everything else uses the constant, so a rename is
// two lines. Docs may say the name; code may not.
const code = import.meta.glob(["/src/**/*.{ts,tsx}", "/public/**/*.{css,js,svg,txt,html}", "/test/**/*.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const everything = {
  ...code,
  ...import.meta.glob(["/*.md", "/docs/**/*.md", "/wrangler.toml", "/package.json"], { query: "?raw", import: "default", eager: true }),
} as Record<string, string>;
const wrangler = everything["/wrangler.toml"]!;

describe("the site's name", () => {
  it("is written in code only in src/config.ts", () => {
    expect(Object.keys(code).length).toBeGreaterThan(30);
    const offenders = Object.entries(code)
      .filter(([path, text]) => path !== "/src/config.ts" && text.includes(SITE_HOST))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("is the production route in wrangler.toml", () => {
    expect(wrangler).toContain(`{ pattern = "${SITE_HOST}", custom_domain = true }`);
  });

  it("no longer uses the old name anywhere", () => {
    const old = ["time", "mutantcacti"].join(".");
    const offenders = Object.entries(everything)
      .filter(([, text]) => new RegExp(`(^|[^a-z])${old.replace(".", "\\.")}`).test(text))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("is in the page title and the .ics file", async () => {
    const app = makeApp();
    expect(await app.html("/help")).toContain(`<title>Help · ${SITE_HOST}</title>`);
    const ics = await (await app.get("/free-busy.ics?from=2026-11-02&to=2026-11-08")).text();
    expect(ics).toContain(`PRODID:-//${SITE_HOST}//busy times//EN`);
    expect(ics).toMatch(new RegExp(`UID:[^\\r\\n]*@${SITE_HOST.replaceAll(".", "\\.")}`));
  });
});
