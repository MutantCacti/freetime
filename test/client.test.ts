import { afterEach, describe, expect, it } from "vitest";
import "../public/js/head.js";
import "../public/js/app.js";
import tokens from "../public/css/tokens.css?raw";
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
const TimeApp = (globalThis as unknown as { TimeApp: { createToastQueue(o?: object): Queue; initialScrollTop(m: object): number; utcOffsetLabel(z: string, d: Date): string; urlWithTz(h: string, tz: string | null): string } }).TimeApp;
const TimeHead = (globalThis as unknown as { TimeHead: { readTheme(s: unknown): string | null; writeTheme(s: unknown, v: string): boolean } }).TimeHead;

const ids = (list: Toast[]) => list.map((t) => t.id);

describe("toasts", () => {
  it("a stale cache gives a sticky warning that minimises but can't be dismissed", () => {
    const q = TimeApp.createToastQueue();
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
    const q = TimeApp.createToastQueue();
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
    const q = TimeApp.createToastQueue({ duration: 6000 });
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
    const q = TimeApp.createToastQueue();
    q.add({ id: "t", kind: "transient", severity: "warning" });
    expect(q.dismiss("t")).toBe(true);
    expect(q.all()).toEqual([]);
  });

  it("shows no more than three, sticky above transient, errors above warnings", () => {
    const q = TimeApp.createToastQueue();
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
    const top = TimeApp.initialScrollTop({ ...geometry, lineY });
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThanOrEqual(maxTop);
    expect(lineY - top).toBeGreaterThanOrEqual(geometry.header);
    expect(lineY - top).toBeLessThanOrEqual(geometry.viewport);
  });

  it("clamps at the top just after midnight and the bottom just before", () => {
    expect(TimeApp.initialScrollTop({ ...geometry, lineY: lineAt(0, 15) })).toBe(0);
    expect(TimeApp.initialScrollTop({ ...geometry, lineY: lineAt(23, 45) })).toBe(maxTop);
  });

  it("puts the line about a third of the way down otherwise", () => {
    const lineY = lineAt(12, 0);
    const top = TimeApp.initialScrollTop({ ...geometry, lineY });
    expect((lineY - top - geometry.header) / (geometry.viewport - geometry.header)).toBeCloseTo(1 / 3, 2);
  });

  it("opens at 08:00 when the period doesn't contain now", () => {
    expect(TimeApp.initialScrollTop({ ...geometry, lineY: null })).toBe(16 * 30);
  });
});

describe("time-zone dropdown helpers", () => {
  it("labels offsets as UTC±h", () => {
    const winter = new Date(Date.UTC(2026, 11, 1));
    expect(TimeApp.utcOffsetLabel("Europe/London", winter)).toBe("UTC+0");
    expect(TimeApp.utcOffsetLabel("Asia/Kolkata", winter)).toBe("UTC+5:30");
    expect(TimeApp.utcOffsetLabel("America/New_York", winter)).toBe("UTC-5");
  });

  it("choosing a zone sets tz and keeps every other parameter; Device default removes it", () => {
    const href = "https://x.test/?view=week&date=2026-11-02&dtz=Europe/Paris#h08";
    const set = new URL(TimeApp.urlWithTz(href, "Europe/Paris"));
    expect(set.searchParams.get("tz")).toBe("Europe/Paris");
    expect(set.searchParams.get("dtz")).toBe("Europe/Paris");
    expect(set.searchParams.get("view")).toBe("week");
    expect(set.hash).toBe("#h08");
    expect(new URL(TimeApp.urlWithTz(set.toString(), null)).searchParams.has("tz")).toBe(false);
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
    expect(TimeHead.readTheme(s)).toBeNull();
    expect(TimeHead.writeTheme(s, "dark")).toBe(true);
    expect(TimeHead.readTheme(s)).toBe("dark");
    expect(TimeHead.readTheme(throwing)).toBeNull();
    expect(TimeHead.writeTheme(throwing, "dark")).toBe(false);
    expect(TimeHead.readTheme(null)).toBeNull();
  });

  it("tokens.css lets data-theme override the system setting", () => {
    // System dark applies only when no light choice was made…
    expect(tokens).toMatch(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{/);
    // …and a dark choice applies regardless of the system setting.
    expect(tokens).toMatch(/\n:root\[data-theme="dark"\] \{/);
  });

  describe("running the head script", () => {
    const g = globalThis as Record<string, unknown>;
    const saved = { document: g.document, location: g.location, window: g.window };
    afterEach(() => Object.assign(g, saved));

    async function run(local: unknown, href = "https://time.mutantcacti.com/?view=week&dtz=Europe/London") {
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
      s.setItem("time.theme", "dark");
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
