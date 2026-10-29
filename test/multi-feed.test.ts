import { describe, expect, it } from "vitest";
import { MAX_FEEDS } from "../src/config";
import { feedUrls } from "../src/feed";
import basic from "./fixtures/basic.ics?raw";
import dst from "./fixtures/dst.ics?raw";
import { NOW, cellClass, decode, makeApp } from "./helpers";

const A = "https://calendar.example/private-aaa/basic.ics";
const B = "https://calendar.example/private-bbb/basic.ics";

/** An app whose ICAL_URL lists A and B; each address is served by its own source. */
function twoFeeds(sources: Record<string, () => Response | Promise<Response>>, env = `${A} ${B}`) {
  const fetched: string[] = [];
  const app = makeApp({
    env: { ICAL_URL: env },
    deps: {
      fetchFeed: async (_env, url) => {
        fetched.push(url);
        const source = sources[url];
        if (!source) throw new Error(`unexpected feed ${url}`);
        return source();
      },
    },
  });
  return { app, fetched };
}

describe("several calendar feeds", () => {
  it("splits ICAL_URL on spaces, commas and new lines", () => {
    expect(feedUrls(`${A} ${B}`)).toEqual([A, B]);
    expect(feedUrls(`${A},${B}`)).toEqual([A, B]);
    expect(feedUrls(` ${A}\n${B}\n`)).toEqual([A, B]);
    expect(feedUrls(`${A}, \n ${B}`)).toEqual([A, B]);
    expect(feedUrls(A)).toEqual([A]);
    expect(feedUrls(undefined)).toEqual([""]);
    expect(feedUrls("  ")).toEqual([""]);
  });

  it("merges busy time from every feed", async () => {
    const { app, fetched } = twoFeeds({ [A]: () => new Response(basic), [B]: () => new Response(dst) });
    const html = await app.html("/?view=week&date=2026-11-02&dtz=Europe/London");
    expect(fetched.sort()).toEqual([A, B].sort());
    // From feed A (basic.ics): the weekly 10:00 event on Monday.
    expect(cellClass(html, "Mon 2 Nov, 10:00–10:30, 100% busy")).not.toBeNull();
    // From feed B (dst.ics): the New York event, 14:00 London on Thursday.
    expect(cellClass(html, "Thu 5 Nov, 14:00–14:30, 100% busy")).not.toBeNull();
  });

  it("merges overlaps, so time busy in both feeds isn't counted twice", async () => {
    const { app } = twoFeeds({ [A]: () => new Response(basic), [B]: () => new Response(basic) });
    const ics = await (await app.get("/free-busy.ics?from=2026-11-02&to=2026-11-08")).text();
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(4);
  });

  it("keeps a saved copy per feed and fetches each once while fresh", async () => {
    const { app, fetched } = twoFeeds({ [A]: () => new Response(basic), [B]: () => new Response(dst) });
    await app.get("/");
    await app.get("/?view=month");
    expect(fetched.length).toBe(2);
  });

  it("uses a feed's saved copy when only that feed fails, with the sticky warning", async () => {
    let bDown = false;
    const { app } = twoFeeds({
      [A]: () => new Response(basic),
      [B]: () => (bDown ? Promise.reject(new Error(`down ${B}`)) : new Response(dst)),
    });
    await app.get("/?view=week&date=2026-11-02");
    app.setNow(NOW + 10 * 60 * 1000);
    bDown = true;
    const res = await app.get("/?view=week&date=2026-11-02&dtz=Europe/London");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Showing a saved copy. Times may be out of date.");
    expect(cellClass(html, "Thu 5 Nov, 14:00–14:30, 100% busy")).not.toBeNull();
    const warn = app.logs.find((l) => l.level === "warn");
    expect(warn?.feed).toBe(2);
    expect(JSON.stringify(app.logs)).not.toContain("private-bbb");
  });

  it("shows the error panel if any feed has no copy at all, rather than calling its busy time free", async () => {
    const { app } = twoFeeds({
      [A]: () => new Response(basic),
      [B]: () => new Response("", { status: 404 }),
    });
    const res = await app.get("/?view=week&date=2026-11-02");
    expect(res.status).toBe(503);
    const html = decode(await res.text());
    expect(html).toContain("The calendar couldn't be loaded");
    expect(html).toMatch(/<code>FEED_STATUS_404 · ref [A-Z0-9]{6} · /);
    expect(html).not.toContain('class="slot ');
    const entry = app.logs.find((l) => l.level === "error");
    expect(entry?.feed).toBe(2);
    // No address, and no part of one, reaches the page or the log.
    for (const secret of ["private-aaa", "private-bbb", "calendar.example"]) {
      expect(html).not.toContain(secret);
      expect(JSON.stringify(app.logs)).not.toContain(secret);
    }
  });

  it("does the same for the .ics export", async () => {
    const { app } = twoFeeds({ [A]: () => new Response(basic), [B]: () => Promise.reject(new Error("down")) });
    expect((await app.get("/free-busy.ics?from=2026-11-02&to=2026-11-08")).status).toBe(503);
  });

  it(`refuses more than ${MAX_FEEDS} feeds`, async () => {
    const many = Array.from({ length: MAX_FEEDS + 1 }, (_, i) => `https://calendar.example/f${i}.ics`).join(" ");
    const { app, fetched } = twoFeeds({}, many);
    const res = await app.get("/");
    expect(res.status).toBe(503);
    expect(fetched.length).toBe(0);
    expect(app.logs[0]?.code).toBe("FEED_FETCH");
  });

  it("a single address behaves exactly as before (no feed number in logs)", async () => {
    const { app } = twoFeeds({ [A]: () => new Response("", { status: 403 }) }, A);
    expect((await app.get("/")).status).toBe(503);
    expect(app.logs[0]?.feed).toBeUndefined();
  });
});
