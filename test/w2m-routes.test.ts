import { describe, expect, it } from "vitest";
import { makeApp, NOW, attr, cellClass, decode, hrefs, params, tagWith, topbarHref } from "./helpers";
import { fakeEventPage } from "./w2m-helpers";
import dates from "./fixtures/w2m/dates.html?raw";
import missing from "./fixtures/w2m/missing.html?raw";
import ny from "./fixtures/w2m/ny.html?raw";
import weekdays from "./fixtures/w2m/weekdays.html?raw";

/** One busy event: Wed 4 Nov 2026, 10:05–10:10 UTC. */
const FEED = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//test//EN",
  "BEGIN:VEVENT",
  "UID:secret-uid",
  "DTSTAMP:20261001T000000Z",
  "DTSTART:20261104T100500Z",
  "DTEND:20261104T101000Z",
  "SUMMARY:SECRET",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

const PAGES: Record<string, string> = {
  "10000001-Test1": weekdays,
  "10000002-Test2": dates,
  "10000004-Test4": ny,
  "99999999-ZZZZZ": missing,
};

/** An app whose when2meet fetch serves the fixtures by event link, counting each fetch. */
function w2mApp(pages: Record<string, string | (() => Response)> = PAGES, now = NOW) {
  const seen: string[] = [];
  const app = makeApp({
    feed: FEED,
    now,
    deps: {
      w2mCachePath: `/__w2m-cache/test-${Math.random().toString(36).slice(2)}`,
      fetchW2m: async (url) => {
        seen.push(url);
        const key = new URL(url).search.slice(1);
        const page = pages[key];
        if (page === undefined) return new Response(missing);
        return typeof page === "string" ? new Response(page) : page();
      },
    },
  });
  return { app, seen };
}

const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe("GET /w2m", () => {
  it("without a link shows the form, keeping the zone", async () => {
    const { app, seen } = w2mApp();
    const res = await app.get("/w2m?dtz=Europe/Paris");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(tagWith(html, 'name="url"')).not.toBeNull();
    expect(attr(tagWith(html, 'class="w2m-form"'), "action")).toBe("/w2m");
    expect(attr(tagWith(html, 'name="dtz"'), "value")).toBe("Europe/Paris");
    expect(seen).toEqual([]);
  });

  it("redirects a valid link to match mode, keeping the zone", async () => {
    const { app, seen } = w2mApp();
    const res = await app.get(`/w2m?url=${encodeURIComponent(" https://when2meet.com/?10000002-Test2\n")}&dtz=Europe/London&tz=Asia/Tokyo`, { redirect: "manual" });
    expect(res.status).toBe(302);
    const p = params(res.headers.get("location")!);
    expect(p.get("w2m")).toBe("10000002-Test2");
    expect(p.get("dtz")).toBe("Europe/London");
    expect(p.get("tz")).toBe("Asia/Tokyo");
    expect(seen).toEqual(["https://www.when2meet.com/?10000002-Test2"]);
  });

  it.each([
    "http://www.when2meet.com/?10000002-Test2",
    "https://www.when2meet.com.example.org/?10000002-Test2",
    "https://u:p@www.when2meet.com/?10000002-Test2",
    "https://example.com/",
    "x".repeat(5000),
  ])("refuses %j inline, with 400 and no request", async (input) => {
    const { app, seen } = w2mApp();
    const res = await app.get(`/w2m?url=${encodeURIComponent(input)}`, { redirect: "manual" });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("That isn&#39;t a when2meet event link.");
    expect(attr(tagWith(html, 'name="url"'), "aria-invalid")).toBe("true");
    expect(html).not.toContain("error-panel");
    expect(seen).toEqual([]);
  });

  it.each([
    ["missing event", () => new Response(missing), 404, "W2M_NOT_FOUND"],
    ["changed page", () => new Response(dates.replaceAll("id='YouTime", "id='Cell")), 502, "W2M_PARSE"],
    ["when2meet down", () => new Response("x", { status: 503 }), 503, "W2M_STATUS_503"],
    [
      "unreachable",
      () => {
        throw new Error("boom");
      },
      503,
      "W2M_FETCH",
    ],
  ])("%s: error panel above the form", async (_name, page, status, code) => {
    const { app } = w2mApp({ "10000002-Test2": page });
    const res = await app.get(`/w2m?url=${encodeURIComponent("https://www.when2meet.com/?10000002-Test2")}`, { redirect: "manual" });
    expect(res.status).toBe(status);
    const html = decode(await res.text());
    expect(html).toContain("Unable to match when2meet event");
    expect(html).toContain(code);
    expect(tagWith(html, 'name="url"')).not.toBeNull();
    // Logged with the event id only.
    const entry = app.logs.find((l) => l.code === code)!;
    expect(JSON.stringify(entry)).toContain("10000002");
    expect(JSON.stringify(entry)).not.toContain("Test2");
  });
});

describe("match mode", () => {
  const DATES = "/?w2m=10000002-Test2&dtz=Europe/London";

  it("draws exactly the event's grid: its days and its slots", async () => {
    const { app } = w2mApp();
    const res = await app.get(DATES);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect([...html.matchAll(/class="colhead[^"]*" data-date="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
    ]);
    const labels = [...html.matchAll(/<div class="timelabel[^"]*">([^<]+)<\/div>/g)].map((m) => m[1]);
    expect(labels).toHaveLength(32);
    expect([labels[0], labels[1], labels[31]]).toEqual(["09:00", "09:15", "16:45"]);
    expect(count(html, /class="slot w2m-(free|busy)/g)).toBe(160);
    expect(count(html, /w2m-none/g)).toBe(0);
  });

  it("is binary: any overlap makes a slot busy", async () => {
    const { app } = w2mApp();
    const html = decode(await app.html(DATES));
    expect(cellClass(html, "Wed 4 Nov, 10:00–10:15, busy")).toContain("w2m-busy");
    expect(cellClass(html, "Wed 4 Nov, 10:15–10:30, free")).toContain("w2m-free");
    expect(cellClass(html, "Wed 4 Nov, 09:45–10:00, free")).toContain("w2m-free");
  });

  it("dims past slots, and has no heatmap classes", async () => {
    const { app } = w2mApp();
    const html = decode(await app.html(DATES));
    expect(cellClass(html, "Tue 3 Nov, 14:00–14:15, free")).toContain("past");
    expect(cellClass(html, "Tue 3 Nov, 14:30–14:45, free")).not.toContain("past");
    expect(html).not.toMatch(/class="[^"]*\bp\d\b/);
    expect(html).not.toMatch(/\bd\d+[kw]\b/);
    expect(html).not.toContain("cb-ramp");
    expect(html).toMatch(/w2m-key[\s\S]*Busy[\s\S]*Free/);
  });

  it("shows the sticky when2meet toast, with Open when2meet and a close that ends the match", async () => {
    const { app } = w2mApp();
    const html = decode(await app.html(DATES));
    const toast = tagWith(html, 'data-id="w2m"');
    expect(attr(toast, "data-kind")).toBe("sticky");
    expect(attr(toast, "data-severity")).toBe("info");
    expect(html).toContain("Matched to when2meet: Mon 2 – Fri 6 Nov 2026, 09:00–17:00, 15-minute slots.");
    expect(html).not.toContain("Event made in");
    const open = tagWith(html, 'href="https://www.when2meet.com/?10000002-Test2"');
    expect(attr(open, "target")).toBe("_blank");
    expect(attr(open, "rel")).toBe("noopener noreferrer");
    const close = attr(tagWith(html, 'aria-label="Close when2meet match"'), "href")!;
    expect(params(close).has("w2m")).toBe(false);
    expect(params(close).get("dtz")).toBe("Europe/London");
  });

  it("keeps w2m on every link in the page except the toast's close", async () => {
    const { app } = w2mApp();
    const html = await app.html(DATES);
    for (const name of ["download", "contact", "help", "tz", "w2m"]) expect(params(topbarHref(html, name)!).get("w2m"), name).toBe("10000002-Test2");
    const local = hrefs(html).filter((h) => h.startsWith("/"));
    const without = local.filter((h) => !params(h).has("w2m"));
    expect(without).toEqual([attr(tagWith(decode(html), 'aria-label="Close when2meet match"'), "href")]);
  });

  it("hides the view controls, and labels the period with the event's dates", async () => {
    const { app } = w2mApp();
    const html = await app.html(DATES);
    expect(attr(tagWith(html, 'class="tb-left"'), "hidden")).not.toBeNull();
    expect(tagWith(html, 'class="topbar is-match"')).not.toBeNull();
    expect(decode(html)).toContain("Mon 2 – Fri 6 Nov 2026");
  });

  it("is cached: a reload doesn't fetch the event again", async () => {
    const { app, seen } = w2mApp();
    await app.get(DATES);
    await app.get(DATES);
    expect(seen).toHaveLength(1);
  });

  it("uses your zone: a New York event seen in London is when2meet's London grid", async () => {
    const { app } = w2mApp();
    const html = decode(await app.html("/?w2m=10000004-Test4&dtz=Europe/London"));
    expect(count(html, /class="colhead/g)).toBe(4);
    const labels = [...html.matchAll(/<div class="timelabel[^"]*">([^<]+)<\/div>/g)].map((m) => m[1]);
    expect(labels).toHaveLength(20);
    expect(labels.slice(15, 17)).toEqual(["03:45", "23:00"]);
    expect(count(html, /class="mbreak"/g)).toBe(1);
    expect(count(html, /w2m-none/g)).toBe(20);
    expect(html).toContain("Matched to when2meet: Mon 2 – Thu 5 Nov 2026, 00:00–04:00 and 23:00–00:00, 15-minute slots.");
    expect(html).toContain("Event made in America/New_York; shown in your time zone, as when2meet shows it.");
  });

  it("the same event in New York is its own grid", async () => {
    const { app } = w2mApp();
    const html = decode(await app.html("/?w2m=10000004-Test4&dtz=America/New_York"));
    expect(count(html, /class="colhead/g)).toBe(3);
    expect(count(html, /class="mbreak"/g)).toBe(0);
    expect(html).toContain("18:00–23:00, 15-minute slots.");
    expect(html).not.toContain("Event made in");
  });

  it("follows tz over dtz", async () => {
    const { app } = w2mApp();
    const html = decode(await app.html("/?w2m=10000004-Test4&dtz=Europe/London&tz=America/New_York"));
    expect(count(html, /class="colhead/g)).toBe(3);
  });

  describe("days of the week", () => {
    it("defaults to the coming week", async () => {
      const { app } = w2mApp();
      // NOW is Tue 3 Nov 2026: the coming week starts Mon 9 Nov.
      const html = decode(await app.html("/?w2m=10000001-Test1&dtz=Europe/London"));
      expect([...html.matchAll(/data-date="([^"]+)"/g)].map((m) => m[1])).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]);
      expect(html).toContain("Matched to when2meet: week of Mon 9 Nov, 09:00–17:00, 15-minute slots.");
    });

    it("follows w2mweek, with previous and next week links that keep the match", async () => {
      const { app } = w2mApp();
      const html = decode(await app.html("/?w2m=10000001-Test1&w2mweek=2026-11-04&dtz=Europe/London"));
      expect([...html.matchAll(/data-date="([^"]+)"/g)].map((m) => m[1])[0]).toBe("2026-11-02");
      const next = hrefs(html).find((h) => params(h).get("w2mweek") === "2026-11-09")!;
      const prev = hrefs(html).find((h) => params(h).get("w2mweek") === "2026-10-26")!;
      for (const h of [next, prev]) {
        expect(params(h).get("w2m")).toBe("10000001-Test1");
        expect(params(h).get("dtz")).toBe("Europe/London");
      }
      expect(params(topbarHref(html, "help")!).get("w2mweek")).toBe("2026-11-02");
    });

    it("keeps wall-clock times in your zone", async () => {
      const { app } = w2mApp();
      const html = decode(await app.html("/?w2m=10000001-Test1&w2mweek=2026-11-02&dtz=Asia/Tokyo"));
      const labels = [...html.matchAll(/<div class="timelabel[^"]*">([^<]+)<\/div>/g)].map((m) => m[1]);
      expect(labels[0]).toBe("09:00");
      // 09:00 in Tokyo on Mon 2 Nov is 00:00Z.
      expect(attr(tagWith(html, 'aria-label="Mon 2 Nov, 09:00–09:15, free"'), "data-s")).toBe(String(Date.UTC(2026, 10, 2, 0) / 1000));
    });
  });

  it("draws only the event's days when it skips some", async () => {
    const day = (start: number) => Array.from({ length: 4 }, (_, i) => start + i * 900);
    const nov2 = Date.UTC(2026, 10, 2, 9) / 1000;
    const page = fakeEventPage({ zone: "Europe/London", slots: [...day(nov2), ...day(nov2 + 3 * 86400)] });
    const { app } = w2mApp({ "12345678-Skip1": page });
    const html = await app.html("/?w2m=12345678-Skip1&dtz=Europe/London");
    expect([...html.matchAll(/data-date="([^"]+)"/g)].map((m) => m[1])).toEqual(["2026-11-02", "2026-11-05"]);
  });

  it("30-minute slots and a DST change: rows are exactly the event's slots", async () => {
    const day = (start: number) => Array.from({ length: 4 }, (_, i) => start + i * 1800);
    // Sat 24 Oct (BST) and Mon 26 Oct (GMT), 09:00–11:00 London both days.
    const page = fakeEventPage({ zone: "Europe/London", slots: [...day(Date.UTC(2026, 9, 24, 8) / 1000), ...day(Date.UTC(2026, 9, 26, 9) / 1000)] });
    const { app } = w2mApp({ "12345678-Dst30": page });
    const html = decode(await app.html("/?w2m=12345678-Dst30&dtz=Europe/London"));
    const labels = [...html.matchAll(/<div class="timelabel[^"]*">([^<]+)<\/div>/g)].map((m) => m[1]);
    expect(labels).toEqual(["09:00", "09:30", "10:00", "10:30"]);
    expect(html).toContain("09:00–11:00, 30-minute slots.");
    expect(count(html, /class="slot w2m-/g)).toBe(8);
  });

  it.each([
    ["an invalid w2m", "/?w2m=nope", 400, "W2M_URL"],
    ["a missing event", "/?w2m=99999999-ZZZZZ", 404, "W2M_NOT_FOUND"],
  ])("%s: error panel, normal controls, links without the match", async (_name, path, status, code) => {
    const { app } = w2mApp();
    const res = await app.get(path);
    expect(res.status).toBe(status);
    const html = decode(await res.text());
    expect(html).toContain("Unable to match when2meet event");
    expect(html).toContain(code);
    expect(attr(tagWith(html, 'class="tb-left"'), "hidden")).toBeNull();
    expect(hrefs(html).filter((h) => h.startsWith("/") && params(h).has("w2m"))).toEqual([]);
  });

  it("never shows a participant's name", async () => {
    const withPeople = dates
      .replace("var UserID=0;", 'var UserID=0;\nPeopleNames[0] = "Zebedee Quux";PeopleIDs[0] = 987654;')
      .replace("AvailableAtSlot[0]=new Array();", "AvailableAtSlot[0]=new Array(987654);");
    const { app } = w2mApp({ "10000002-Test2": withPeople });
    const html = await app.html(DATES);
    expect(html).toContain("Matched to when2meet");
    expect(html).not.toContain("Zebedee");
    expect(html).not.toContain("987654");
  });
});

describe("entry point", () => {
  it("the top bar has a when2meet item after Download .ics, opening the dialog", async () => {
    const { app } = w2mApp();
    const html = await app.html("/?view=week&date=2026-11-02");
    const order = [...html.matchAll(/data-tb="(download|w2m|contact)"/g)].map((m) => m[1]);
    expect(order).toEqual(["download", "w2m", "contact"]);
    const tag = tagWith(html, 'data-tb="w2m"');
    expect(attr(tag, "data-dialog")).toBe("dlg-w2m");
    expect(attr(tag, "href")!.startsWith("/w2m")).toBe(true);
    const dialog = html.slice(html.indexOf('id="dlg-w2m"'));
    expect(dialog).toContain('action="/w2m"');
    expect(dialog).toContain('name="url"');
  });

  it("the normal calendar isn't in match mode", async () => {
    const { app, seen } = w2mApp();
    const html = await app.html("/?view=week&date=2026-11-02");
    expect(html).not.toContain('data-id="w2m"');
    expect(html).toContain("cb-ramp");
    expect(seen).toEqual([]);
  });
});
