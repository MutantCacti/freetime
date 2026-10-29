import { afterEach, describe, expect, it, vi } from "vitest";
import broken from "./fixtures/broken.ics?raw";
import { NOW, attr, decode, makeApp, tagWith } from "./helpers";
import { AppError } from "../src/errors";

const STALE = "Showing a saved copy. Times may be out of date.";
const DEBUG_LINE = /<code>(FEED_[A-Z0-9_]+|RANGE_EXPAND|INTERNAL) · ref ([2-9A-HJKMNP-TV-Z]{6}) · 2026-11-03 14:20Z<\/code>/;

function failing(message = "connect ECONNREFUSED https://secret.example/private/feed.ics at /home/me/src/feed.ts:42 (ical.js)") {
  return () => Promise.reject(new Error(message));
}

/** Things the error panel must never show. */
function expectNoLeaks(html: string) {
  expect(html).not.toContain("secret.example");
  expect(html).not.toContain("/home/me");
  expect(html).not.toContain("src/");
  expect(html).not.toContain("ical.js");
  expect(html).not.toContain("ECONNREFUSED");
  expect(html).not.toMatch(/\bat \S+:\d+/); // stack frames
  expect(html).not.toContain("UPSTREAM-BODY");
}

afterEach(() => vi.restoreAllMocks());

describe("feed failures", () => {
  it("uses a fresh saved copy without fetching again", async () => {
    const app = makeApp();
    await app.get("/");
    await app.get("/?view=month");
    expect(app.fetches).toBe(1);
  });

  it("serves the last good copy with a sticky warning when a fetch fails", async () => {
    const app = makeApp();
    expect((await app.get("/?view=week&date=2026-11-02")).status).toBe(200);
    app.setNow(NOW + 10 * 60 * 1000); // past the 5-minute freshness window
    app.setFeed(failing());
    const res = await app.get("/?view=week&date=2026-11-02");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(app.fetches).toBe(2);
    // The calendar is still drawn, from the saved copy.
    expect(html).toContain('aria-label="Mon 2 Nov, 10:00–10:30, 100% busy"');
    // The warning is a sticky toast in the notice layer.
    const toast = tagWith(html, 'data-kind="sticky"');
    expect(toast).not.toBeNull();
    expect(attr(toast, "data-severity")).toBe("warning");
    expect(html).toContain(STALE);
    expect(html).not.toContain("error-panel");
    expectNoLeaks(html);
  });

  it("replaces the calendar with the error panel when there is no saved copy", async () => {
    const app = makeApp({ feed: failing() });
    const res = await app.get("/?view=week&date=2026-11-02");
    expect(res.status).toBe(503);
    const html = await res.text();
    expect(html).toContain("error-panel");
    expect(decode(html)).toContain("The calendar couldn't be loaded");
    expect(html).not.toContain('class="slot ');
    const m = DEBUG_LINE.exec(html);
    expect(m?.[1]).toBe("FEED_FETCH");
    expectNoLeaks(html);
    // The same reference is in the log, with the full details.
    const entry = app.logs.find((l) => l.level === "error");
    expect(entry?.ref).toBe(m?.[2]);
    expect(entry?.code).toBe("FEED_FETCH");
    expect(String(entry?.cause)).toContain("ECONNREFUSED");
    // The top bar still works.
    expect(html).toContain('data-tb="contact"');
  });

  it("names the upstream status and never shows the upstream body", async () => {
    const app = makeApp({ feed: () => new Response("UPSTREAM-BODY secret token", { status: 403 }) });
    const res = await app.get("/");
    expect(res.status).toBe(503);
    const html = await res.text();
    expect(DEBUG_LINE.exec(html)?.[1]).toBe("FEED_STATUS_403");
    expectNoLeaks(html);
    expect(app.logs[0]?.upstreamStatus).toBe(403);
    expect(JSON.stringify(app.logs)).not.toContain("UPSTREAM-BODY");
  });

  it("reports a feed that can't be parsed", async () => {
    const res = await makeApp({ feed: broken }).get("/");
    expect(res.status).toBe(503);
    expect(DEBUG_LINE.exec(await res.text())?.[1]).toBe("FEED_PARSE");
  });

  it("never logs or shows ICAL_URL", async () => {
    const secret = "https://calendar.example/private-abc123/basic.ics";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError(`fetch failed for ${secret}`));
    const app = makeApp({ env: { ICAL_URL: secret }, deps: { fetchFeed: undefined } });
    const res = await app.get("/");
    expect(fetchSpy).toHaveBeenCalledOnce();
    const html = await res.text();
    expect(res.status).toBe(503);
    expect(html).not.toContain("private-abc123");
    expect(JSON.stringify(app.logs)).not.toContain("private-abc123");
    expect(JSON.stringify(app.logs)).toContain("[ICAL_URL]");
  });

  it("uses 503 for feed problems and 500 for anything else", () => {
    expect(new AppError("FEED_FETCH", "x").status).toBe(503);
    expect(new AppError("FEED_STATUS_404", "x").status).toBe(503);
    expect(new AppError("FEED_PARSE", "x").status).toBe(503);
    expect(new AppError("RANGE_EXPAND", "x").status).toBe(500);
    expect(new AppError("INTERNAL", "x").status).toBe(500);
  });
});

describe("saved copy per feed", () => {
  it("a changed ICAL_URL doesn't reuse another feed's saved copy", async () => {
    const shared = `/__feed-cache/shared-${Math.random()}`;
    const good = makeApp({ env: { ICAL_URL: "https://feed.invalid/right.ics" }, deps: { cachePath: shared } });
    expect((await good.get("/")).status).toBe(200);
    const wrong = makeApp({
      env: { ICAL_URL: "https://feed.invalid/wrong.ics" },
      deps: { cachePath: shared },
      feed: () => new Response("", { status: 404 }),
      now: NOW + 3600_000,
    });
    const res = await wrong.get("/");
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/<code>FEED_STATUS_404 · ref [A-Z0-9]{6} · 2026-11-03 15:20Z<\/code>/);
  });
});
