import { afterEach, describe, expect, it } from "vitest";
import "../public/js/head.js";
import "../public/js/app.js";
import tokens from "../public/css/tokens.css?raw";

const allCss = import.meta.glob(["/public/css/*.css", "/public/js/*.js", "/src/**/*.{ts,tsx}"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
import { makeApp } from "./helpers";

interface Toast {
  id: string;
  kind: string;
  severity: string;
}
interface Queue {
  add(t: { id: string; kind: "sticky" | "transient"; severity: "warning" | "error"; message?: string }): boolean;
  visible(now: number): Toast[];
  tick(now: number): boolean;
  pause(id: string, now: number): void;
  resume(id: string, now: number): void;
  dismiss(id: string): boolean;
  minimise(id: string): boolean;
  restore(id: string): void;
  resolve(id: string): void;
  indicator(): "warning" | "error" | null;
  all(): Toast[];
}
const SiteApp = (globalThis as unknown as { SiteApp: { glideStep(v: number, dt: number): number; createToastQueue(o?: object): Queue; initialScrollTop(m: object): number; utcOffsetLabel(z: string, d: Date): string; urlWithTz(h: string, tz: string | null): string } }).SiteApp;
const SiteHead = (globalThis as unknown as { SiteHead: { readTheme(s: unknown): string | null; writeTheme(s: unknown, v: string): boolean } }).SiteHead;

const ids = (list: Toast[]) => list.map((t) => t.id);

describe("toasts", () => {
  it("a stale cache gives a sticky warning that minimises but can't be dismissed", () => {
    const q = SiteApp.createToastQueue();
    q.add({ id: "stale", kind: "sticky", severity: "warning" });
    expect(ids(q.visible(0))).toEqual(["stale"]);
    expect(q.dismiss("stale")).toBe(false);
    expect(q.tick(60_000)).toBe(false);
    expect(ids(q.visible(60_000))).toEqual(["stale"]);
    expect(q.minimise("stale")).toBe(true);
    expect(q.visible(0)).toEqual([]);
    expect(q.all().length).toBe(1);
  });

  it("the notice indicator shows only while a sticky toast is minimised", () => {
    const q = SiteApp.createToastQueue();
    expect(q.indicator()).toBeNull();
    q.add({ id: "stale", kind: "sticky", severity: "warning" });
    expect(q.indicator()).toBeNull();
    q.minimise("stale");
    expect(q.indicator()).toBe("warning");
    q.restore("stale");
    expect(q.indicator()).toBeNull();
    q.add({ id: "t", kind: "transient", severity: "error" });
    expect(q.minimise("t")).toBe(false);
    expect(q.indicator()).toBeNull();
  });

  it("a transient toast hides itself after about 6 seconds, pausing while hovered", () => {
    const q = SiteApp.createToastQueue({ duration: 6000 });
    q.add({ id: "t", kind: "transient", severity: "warning" });
    q.visible(1000);
    expect(q.tick(6000)).toBe(false);
    q.pause("t", 6000); // 1 s left
    expect(q.tick(20_000)).toBe(false);
    q.resume("t", 20_000);
    expect(q.tick(20_500)).toBe(false);
    expect(q.tick(21_000)).toBe(true);
    expect(q.all()).toEqual([]);
  });

  it("a transient toast can be closed", () => {
    const q = SiteApp.createToastQueue();
    q.add({ id: "t", kind: "transient", severity: "warning" });
    expect(q.dismiss("t")).toBe(true);
    expect(q.all()).toEqual([]);
  });

  it("shows no more than three, sticky above transient, errors above warnings", () => {
    const q = SiteApp.createToastQueue();
    q.add({ id: "t1", kind: "transient", severity: "warning" });
    q.add({ id: "t2", kind: "transient", severity: "error" });
    q.add({ id: "t3", kind: "transient", severity: "warning" });
    q.add({ id: "s1", kind: "sticky", severity: "warning" });
    q.add({ id: "s2", kind: "sticky", severity: "error" });
    expect(ids(q.visible(0))).toEqual(["s2", "s1", "t2"]);
    // Waiting toasts haven't started their timers.
    expect(q.tick(10_000)).toBe(true);
    expect(ids(q.visible(10_000))).toEqual(["s2", "s1", "t1"]);
    q.minimise("s1");
    expect(ids(q.visible(10_000))).toEqual(["s2", "t1", "t3"]);
  });
});

describe("motion", () => {
  const css = allCss["/public/css/app.css"]!;

  it("turns every animation and transition off under prefers-reduced-motion", () => {
    const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(block).toContain("animation-duration: 0s !important");
    expect(block).toContain("transition-duration: 0s !important");
    expect(block).toMatch(/\*, \*::before, \*::after, ::backdrop/);
    // JS skips its exit waits too.
    expect(allCss["/public/js/app.js"]).toContain('matchMedia("(prefers-reduced-motion: reduce)")');
  });

  it("animates only opacity and transforms, so it stays cheap", () => {
    const frames = [...css.matchAll(/@keyframes [\w-]+ \{(.*)\}/g)].map((m) => m[1]!);
    expect(frames.length).toBeGreaterThanOrEqual(6);
    for (const f of frames) {
      for (const [, prop] of f.matchAll(/([a-z-]+):/g)) expect(["opacity", "scale", "translate", "rotate"]).toContain(prop);
    }
  });

  it("uses the same short durations everywhere", () => {
    expect(tokens).toMatch(/--motion-in: 160ms/);
    expect(tokens).toMatch(/--motion-out: 110ms/);
    for (const [, d] of css.matchAll(/(?:animation|transition)[^;{]*?(\d+m?s)/g)) {
      expect(["0s", "100ms"]).toContain(d);
    }
  });

  it("dialogs and toasts grow from the top right, where their buttons are", () => {
    expect(css).toMatch(/\.dialog \{ transform-origin: top right;/);
    expect(css).toMatch(/\.toast \{ transform-origin: top right;/);
    expect(css).toMatch(/\.tb-menu-items:popover-open \{ transform-origin: top right;/);
  });
});

describe("month hover", () => {
  it("a hovered day or slot gets an overlaid ring, so the cell and its dither never change size", () => {
    const css = allCss["/public/css/app.css"]!;
    expect(css).toContain(".daycell, .slot { box-shadow: inset 0 0 0 0 var(--color-grid); transition: box-shadow var(--motion-hover); }");
    expect(css).toMatch(/@media \(hover: hover\) \{\s*\.daycell:hover, \.slot:hover:not\(:focus-visible\) \{ box-shadow: inset 0 0 0 2px var\(--color-grid\); \}/);
    expect(css).toContain(".cal-scroll.is-dragging .daycell:hover, .cal-scroll.is-dragging .slot:hover { box-shadow: inset 0 0 0 0 var(--color-grid); }");
    expect(tokens).toContain("--motion-hover: 40ms ease-out;");
    // Nothing scales or resizes a day cell or a slot.
    expect(css).not.toMatch(/\.(daycell|slot)[^{]*\{[^}]*\b(scale|transform|zoom|background-size)\s*:/);
    // Day numbers in Month: barely rounded.
    expect(css).toMatch(/\.daynum \{[^}]*border-radius: 2px;/);
  });
});

describe("drag to scroll", () => {
  it("the glide after a mouse drag slows down and stops", () => {
    let v = 2; // px/ms, a fast flick
    let t = 0;
    let distance = 0;
    while (v !== 0 && t < 5000) {
      distance += v * 16;
      v = SiteApp.glideStep(v, 16);
      t += 16;
    }
    expect(v).toBe(0);
    expect(t).toBeLessThan(1500); // stops within about a second
    expect(distance).toBeGreaterThan(200);
    expect(distance).toBeLessThan(500);
    expect(SiteApp.glideStep(-1, 16)).toBeLessThan(0); // either direction
    expect(SiteApp.glideStep(0.019, 16)).toBe(0);
  });

  it("shows a grab cursor and stops text selection mid-drag, and only handles the mouse", () => {
    const css = allCss["/public/css/app.css"]!;
    expect(css).toContain(".js .cal-scroll { cursor: grab; }");
    expect(css).toMatch(/\.cal-scroll\.is-dragging, \.cal-scroll\.is-dragging \* \{ cursor: grabbing; user-select: none;/);
    const js = allCss["/public/js/app.js"]!;
    expect(js).toContain('if (e.pointerType !== "mouse" || e.button !== 0) return;');
    expect(js).toContain("var DRAG_THRESHOLD = 5;");
  });
});

describe("starting scroll position", () => {
  // 48 rows of 30 px under a 32 px header; the window shows 24 rows.
  const geometry = { header: 32, viewport: 32 + 24 * 30, content: 32 + 48 * 30, anchorY: 32 + 16 * 30 };
  const lineAt = (h: number, m: number) => geometry.header + ((h * 60 + m) / 30) * 30;
  const maxTop = geometry.content - geometry.viewport;

  it.each([
    [0, 15],
    [23, 45],
    [12, 0],
  ])("keeps the window inside the column with the line visible at %i:%i", (h, m) => {
    const lineY = lineAt(h, m);
    const top = SiteApp.initialScrollTop({ ...geometry, lineY });
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThanOrEqual(maxTop);
    expect(lineY - top).toBeGreaterThanOrEqual(geometry.header);
    expect(lineY - top).toBeLessThanOrEqual(geometry.viewport);
  });

  it("clamps at the top just after midnight and the bottom just before", () => {
    expect(SiteApp.initialScrollTop({ ...geometry, lineY: lineAt(0, 15) })).toBe(0);
    expect(SiteApp.initialScrollTop({ ...geometry, lineY: lineAt(23, 45) })).toBe(maxTop);
  });

  it("puts the line about a third of the way down otherwise", () => {
    const lineY = lineAt(12, 0);
    const top = SiteApp.initialScrollTop({ ...geometry, lineY });
    expect((lineY - top - geometry.header) / (geometry.viewport - geometry.header)).toBeCloseTo(1 / 3, 2);
  });

  it("opens at 08:00 when the period doesn't contain now", () => {
    expect(SiteApp.initialScrollTop({ ...geometry, lineY: null })).toBe(16 * 30);
  });
});

describe("time-zone dropdown helpers", () => {
  it("labels offsets as UTC±h", () => {
    const winter = new Date(Date.UTC(2026, 11, 1));
    expect(SiteApp.utcOffsetLabel("Europe/London", winter)).toBe("UTC+0");
    expect(SiteApp.utcOffsetLabel("Asia/Kolkata", winter)).toBe("UTC+5:30");
    expect(SiteApp.utcOffsetLabel("America/New_York", winter)).toBe("UTC-5");
  });

  it("choosing a zone sets tz and keeps every other parameter; Device default removes it", () => {
    const href = "https://x.test/?view=week&date=2026-11-02&dtz=Europe/Paris#h08";
    const set = new URL(SiteApp.urlWithTz(href, "Europe/Paris"));
    expect(set.searchParams.get("tz")).toBe("Europe/Paris");
    expect(set.searchParams.get("dtz")).toBe("Europe/Paris");
    expect(set.searchParams.get("view")).toBe("week");
    expect(set.hash).toBe("#h08");
    expect(new URL(SiteApp.urlWithTz(set.toString(), null)).searchParams.has("tz")).toBe(false);
  });
});

describe("theme", () => {
  const throwing = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("SecurityError");
    },
  };
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };

  it("reads and writes the stored choice, and survives storage that throws", () => {
    const s = memory();
    expect(SiteHead.readTheme(s)).toBeNull();
    expect(SiteHead.writeTheme(s, "dark")).toBe(true);
    expect(SiteHead.readTheme(s)).toBe("dark");
    expect(SiteHead.readTheme(throwing)).toBeNull();
    expect(SiteHead.writeTheme(throwing, "dark")).toBe(false);
    expect(SiteHead.readTheme(null)).toBeNull();
  });

  it("tokens.css defaults to dark everywhere; only a stored light choice changes it", () => {
    // Dark on :root, light only under data-theme="light", and no system preference.
    expect(tokens).toMatch(/semantic: dark \(default\)[^\n]*\n[^\n]*\n:root \{\n  --color-bg: var\(--raw-ink-950\)/);
    expect(tokens).toMatch(/\n:root\[data-theme="light"\] \{/);
    for (const [path, text] of Object.entries(allCss)) expect(text, path).not.toContain("prefers-color-scheme");
  });

  describe("running the head script", () => {
    const g = globalThis as Record<string, unknown>;
    const saved = { document: g.document, location: g.location, window: g.window };
    afterEach(() => Object.assign(g, saved));

    async function run(local: unknown, href = "https://example.test/?view=week&dtz=Europe/London") {
      const attrs: Record<string, string> = {};
      const replaced: string[] = [];
      g.document = { documentElement: { classList: { add() {} }, setAttribute: (k: string, v: string) => (attrs[k] = v) } };
      g.location = { href, replace: (u: string) => replaced.push(u) };
      g.window = {
        get localStorage() {
          return local;
        },
        sessionStorage: memory(),
        matchMedia: () => ({ matches: false }),
      };
      await import(/* @vite-ignore */ `../public/js/head.js?run=${Math.random()}`);
      return { attrs, replaced };
    }

    it("applies the stored choice before paint", async () => {
      const s = memory();
      s.setItem("site.theme", "dark");
      const { attrs, replaced } = await run(s);
      expect(attrs["data-theme"]).toBe("dark");
      expect(replaced.length).toBeLessThanOrEqual(1);
    });

    it("still runs when localStorage throws, and the page still renders", async () => {
      const { attrs } = await run(throwing);
      expect(attrs["data-theme"]).toBeUndefined();
      const res = await makeApp().get("/");
      expect(res.status).toBe(200);
    });
  });
});
