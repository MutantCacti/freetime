import { describe, expect, it } from "vitest";
import fontsCss from "../public/css/fonts.css?raw";
import tokens from "../public/css/tokens.css?raw";
import { makeApp } from "./helpers";

const app = makeApp();
const FILES = [
  "/fonts/figtree-latin-wght-normal.woff2",
  "/fonts/figtree-latin-ext-wght-normal.woff2",
  "/fonts/fragment-mono-latin-400-normal.woff2",
  "/fonts/fragment-mono-latin-ext-400-normal.woff2",
];

describe("fonts", () => {
  it("serves the WOFF2 files and their licences from self", async () => {
    for (const path of FILES) {
      const res = await app.get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type"), path).toBe("font/woff2");
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(String.fromCharCode(...bytes.slice(0, 4)), path).toBe("wOF2");
    }
    for (const path of ["/fonts/Figtree-OFL.txt", "/fonts/FragmentMono-OFL.txt"]) {
      const res = await app.get(path);
      expect(res.status, path).toBe(200);
      expect(await res.text()).toContain("SIL Open Font License, Version 1.1");
    }
  });

  it("declares every face from /fonts/, with font-display: swap", () => {
    const urls = [...fontsCss.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]);
    expect(urls.sort()).toEqual([...FILES].sort());
    expect(fontsCss.match(/@font-face/g)?.length).toBe(4);
    expect(fontsCss.match(/font-display: swap;/g)?.length).toBe(4);
  });

  it("uses the agreed fallback stacks", () => {
    expect(tokens).toContain("--font-sans: Figtree, system-ui, sans-serif;");
    expect(tokens).toContain('--font-mono: "Fragment Mono", ui-monospace, monospace;');
  });

  it("preloads the two faces used above the fold", async () => {
    const html = await app.html("/");
    const preloads = [...html.matchAll(/<link rel="preload" href="([^"]+)" as="font" type="font\/woff2" crossorigin="anonymous"\/>/g)].map((m) => m[1]);
    expect(preloads).toEqual(["/fonts/figtree-latin-wght-normal.woff2", "/fonts/fragment-mono-latin-400-normal.woff2"]);
    expect(html).toContain('<link rel="stylesheet" href="/css/fonts.css"/>');
  });

  it("the CSP still allows no external origins", async () => {
    const csp = (await app.get("/")).headers.get("content-security-policy")!;
    expect(csp).toContain("font-src 'self'");
    expect(csp).not.toMatch(/https?:|\*|data:|fonts\.g/);
    for (const directive of csp.split(";")) {
      const values = directive.trim().split(/\s+/).slice(1);
      for (const v of values) expect(["'self'", "'none'"], directive).toContain(v);
    }
  });
});
