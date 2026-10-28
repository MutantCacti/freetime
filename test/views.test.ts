import { describe, expect, it } from "vitest";
import { cellClasses, DITHER_MAX_LEVEL, ditherLevel } from "../src/dither";
import { parulaColour } from "../src/parula";
import { NOW, attr, cellClass, makeApp, params, tagWith, topbarHref } from "./helpers";

const app = makeApp();

describe("views render", () => {
  it.each([
    ["/?view=day&date=2026-11-03", "Tue 3 Nov 2026", 48],
    ["/?view=week&date=2026-11-04", "Mon 2 – Sun 8 Nov 2026", 7 * 48],
    ["/?view=month&date=2026-11-20", "November 2026", 0],
    ["/?view=range&from=2026-11-02&to=2026-11-13", "Mon 2 – Fri 13 Nov 2026", 12 * 48],
    ["/?view=range&from=2026-11-02&to=2026-12-20", "Mon 2 Nov – Sun 20 Dec 2026", 0],
  ])("%s", async (path, label, slots) => {
    const res = await app.get(path);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain(`<h1 class="period-label">${label}</h1>`);
    expect(html.match(/class="slot /g)?.length ?? 0).toBe(slots);
    if (!slots) expect(html).toContain('class="daycell ');
  });

  it("defaults to Week on the server (the head script picks Day on narrow screens)", async () => {
    const html = await app.html("/");
    expect(tagWith(html, 'aria-current="page"')).toContain('href="/?view=week&amp;date=2026-11-02#h08"');
  });

  it("dims days outside the month and links each day to the Day view", async () => {
    const html = await app.html("/?view=month&date=2026-11-01");
    const oct26 = tagWith(html, 'aria-label="Mon 26 Oct, ');
    expect(attr(oct26, "class")).toContain(" out");
    const nov4 = tagWith(html, 'aria-label="Wed 4 Nov, 100% busy"');
    expect(attr(nov4, "href")).toBe("/?view=day&date=2026-11-04#h08");
  });
});

describe("navigation (§5.5)", () => {
  const cases: [string, string, Record<string, string>, Record<string, string>, Record<string, string> | "disabled"][] = [
    // path, name, prev, next, today
    ["/?view=day&date=2026-11-12", "day", { view: "day", date: "2026-11-11" }, { view: "day", date: "2026-11-13" }, { view: "day", date: "2026-11-03" }],
    ["/?view=day&date=2026-11-03", "day today", { view: "day", date: "2026-11-02" }, { view: "day", date: "2026-11-04" }, "disabled"],
    ["/?view=week&date=2026-11-12", "week", { view: "week", date: "2026-11-02" }, { view: "week", date: "2026-11-16" }, { view: "week", date: "2026-11-02" }],
    ["/?view=week&date=2026-11-05", "week today", { view: "week", date: "2026-10-26" }, { view: "week", date: "2026-11-09" }, "disabled"],
    ["/?view=month&date=2027-01-15", "month", { view: "month", date: "2026-12-01" }, { view: "month", date: "2027-02-01" }, { view: "month", date: "2026-11-01" }],
    ["/?view=month&date=2026-11-30", "month today", { view: "month", date: "2026-10-01" }, { view: "month", date: "2026-12-01" }, "disabled"],
    [
      "/?view=range&from=2026-11-10&to=2026-11-16",
      "range",
      { view: "range", from: "2026-11-03", to: "2026-11-09" },
      { view: "range", from: "2026-11-17", to: "2026-11-23" },
      // Keeps the range's length and moves it to start today.
      { view: "range", from: "2026-11-03", to: "2026-11-09" },
    ],
    [
      "/?view=range&from=2026-11-01&to=2026-11-20",
      "range today",
      { view: "range", from: "2026-10-12", to: "2026-10-31" },
      { view: "range", from: "2026-11-21", to: "2026-12-10" },
      "disabled",
    ],
  ];

  it.each(cases)("%s (%s)", async (path, _name, prev, next, todayTarget) => {
    const html = await app.html(path);
    const check = (href: string | null, expected: Record<string, string>) => {
      expect(href).not.toBeNull();
      const p = params(href!);
      expect(Object.fromEntries(p)).toEqual(expected);
    };
    check(topbarHref(html, "prev"), prev);
    check(topbarHref(html, "next"), next);
    const today = tagWith(html, 'data-tb="today"');
    if (todayTarget === "disabled") {
      expect(today).toContain('aria-disabled="true"');
      expect(attr(today, "href")).toBeNull();
    } else {
      check(attr(today, "href"), todayTarget);
    }
  });

  it("arrows and Today are plain links", async () => {
    const html = await app.html("/?view=week&date=2026-11-12");
    for (const name of ["prev", "next", "today"]) expect(tagWith(html, `data-tb="${name}"`)).toMatch(/^<a /);
  });
});

describe("Range validation", () => {
  it("swaps reversed dates", async () => {
    const html = await app.html("/?view=range&from=2026-11-10&to=2026-11-02");
    expect(html).toContain("Mon 2 – Tue 10 Nov 2026");
    expect(html).toContain("Start and end were swapped.");
  });

  it("caps ranges at 62 days", async () => {
    const html = await app.html("/?view=range&from=2026-11-01&to=2027-03-01");
    expect(html).toContain("Sun 1 Nov 2026 – Fri 1 Jan 2027");
    expect(html).toContain("Range shortened to 62 days.");
    expect(attr(tagWith(html, 'id="range-to"'), "value")).toBe("2027-01-01");
  });

  it.each(["from=2026-02-30&to=2026-03-02", "from=nope&to=2026-11-10", "from=2026-11-01"])("falls back to this week: %s", async (q) => {
    const html = await app.html(`/?view=range&${q}`);
    expect(html).toContain("Mon 2 – Sun 8 Nov 2026");
    expect(html).toContain("Invalid date. Showing this week.");
  });

  it("is a GET form with two date inputs and Apply, which keeps the zone", async () => {
    const html = await app.html("/?view=range&from=2026-11-02&to=2026-11-08&dtz=Asia/Tokyo&tz=America/Chicago");
    const form = tagWith(html, 'id="range-form"');
    expect(attr(form, "method")).toBe("get");
    expect(attr(form, "action")).toBe("/#h08");
    expect(html).toMatch(/<input type="date" name="from"/);
    expect(html).toMatch(/<input type="date" name="to"/);
    expect(html).toContain('<input type="hidden" name="tz" value="America/Chicago"/>');
    expect(html).toContain('<input type="hidden" name="dtz" value="Asia/Tokyo"/>');
    expect(html).toContain('<button type="submit" class="btn btn-primary">Apply</button>');
  });

  it("uses columns up to 14 days and day cells beyond", async () => {
    expect(await app.html("/?view=range&from=2026-11-01&to=2026-11-14")).toContain('data-layout="columns"');
    expect(await app.html("/?view=range&from=2026-11-01&to=2026-11-15")).toContain('data-layout="cells"');
  });
});

describe("current time", () => {
  it("draws the line only when the period contains now", async () => {
    const withNow = ["/?view=day&date=2026-11-03", "/?view=week&date=2026-11-02", "/?view=range&from=2026-11-01&to=2026-11-05"];
    for (const path of withNow) {
      const html = await app.html(path);
      expect(html.match(/class="now-line /g)?.length, path).toBe(1);
      // 14:20 is two-thirds into the 14:00 slot.
      const slot = /<div class="([^"]*)"[^>]*aria-label="Tue 3 Nov, 14:00–14:30, [^"]*"[^>]*><div class="now-line m20"/.exec(html);
      expect(slot, path).not.toBeNull();
    }
    const without = ["/?view=day&date=2026-11-04", "/?view=week&date=2026-11-09", "/?view=range&from=2026-11-04&to=2026-11-08", "/?view=month&date=2026-11-01"];
    for (const path of without) expect(await app.html(path), path).not.toContain("now-line");
  });

  it("outlines today's cell in Month and Range day cells", async () => {
    for (const path of ["/?view=month&date=2026-11-01", "/?view=range&from=2026-10-20&to=2026-12-01"]) {
      const html = await app.html(path);
      expect(attr(tagWith(html, 'aria-current="date"'), "aria-label")).toMatch(/^Tue 3 Nov, /);
      expect(attr(tagWith(html, 'aria-current="date"'), "class")).toContain("is-today");
    }
  });

  it("dims earlier slots on today's date only", async () => {
    const html = await app.html("/?view=week&date=2026-11-02");
    expect(cellClass(html, "Tue 3 Nov, 13:30–14:00, 0% busy")).toContain("past");
    expect(cellClass(html, "Tue 3 Nov, 14:30–15:00, 0% busy")).not.toContain("past");
    expect(cellClass(html, "Mon 2 Nov, 08:00–08:30, 0% busy")).not.toContain("past");
  });

  it("places the line in the first and last slot near midnight (clamp)", async () => {
    const early = makeApp({ now: Date.UTC(2026, 10, 3, 0, 15) });
    expect(await early.html("/?view=day&date=2026-11-03")).toMatch(/aria-label="Tue 3 Nov, 00:00–00:30, [^"]*"[^>]*><div class="now-line m15"/);
    const late = makeApp({ now: Date.UTC(2026, 10, 3, 23, 45) });
    expect(await late.html("/?view=day&date=2026-11-03")).toMatch(/aria-label="Tue 3 Nov, 23:30–00:00, [^"]*"[^>]*><div class="now-line m15"/);
  });
});

describe("time window", () => {
  it("has 48 half-hour rows per column and hour anchors", async () => {
    for (const path of ["/?view=day&date=2026-11-03", "/?view=week&date=2026-11-02", "/?view=range&from=2026-11-02&to=2026-11-04"]) {
      const html = await app.html(path);
      const cols = (html.match(/class="colhead/g) ?? []).length;
      expect(html.match(/class="slot /g)?.length).toBe(cols * 48);
      expect(html.match(/class="timelabel/g)?.length).toBe(48);
      for (let h = 0; h < 24; h++) expect(html).toContain(`id="h${String(h).padStart(2, "0")}"`);
    }
  });

  it("links to the column views land on #h08", async () => {
    const html = await app.html("/?view=month&date=2026-11-01");
    expect(topbarHref(html, "tabs")).toBeNull();
    const tabs = [...html.matchAll(/<a class="tab" href="([^"]*)"/g)].map((m) => m[1]);
    expect(tabs[0]).toMatch(/#h08$/); // Day
    expect(tabs[1]).toMatch(/#h08$/); // Week
    expect(tabs[2]).not.toContain("#"); // Month
  });
});

describe("colour and dither", () => {
  it("gives a fraction the same colour and Bayer level in every view", async () => {
    const half = cellClasses(0.5);
    const full = cellClasses(1);
    expect(half).toMatch(/^p\d+ d6[kw]$/);
    expect(full).toBe(`p63 d${DITHER_MAX_LEVEL}k`);
    // A half-busy 30-minute slot, in each column view.
    for (const path of ["/?view=day&date=2026-11-03", "/?view=week&date=2026-11-02", "/?view=range&from=2026-11-01&to=2026-11-05"]) {
      expect(cellClass(await app.html(path), "Tue 3 Nov, 14:00–14:30, 50% busy"), path).toContain(half);
    }
    // A half-busy day (00:00–12:00), in each day-cell view.
    for (const path of ["/?view=month&date=2026-11-01", "/?view=range&from=2026-10-20&to=2026-12-01"]) {
      const html = await app.html(path);
      expect(cellClass(html, "Tue 10 Nov, 50% busy"), path).toContain(half);
      expect(cellClass(html, "Wed 4 Nov, 100% busy"), path).toContain(full);
    }
    // A fully busy slot, in a column view.
    expect(cellClass(await app.html("/?view=week&date=2026-11-02"), "Wed 4 Nov, 12:00–12:30, 100% busy")).toContain(full);
    expect(parulaColour(0.5)).toBe(parulaColour(0.5));
    expect(ditherLevel(1)).toBe(DITHER_MAX_LEVEL);
  });

  it("serves the generated colour CSS and dither tiles", async () => {
    const css = await (await app.get("/css/calendar.css")).text();
    expect(css).toContain(".p63{background-color:var(--parula-63)}");
    expect(css).toContain(`.d${DITHER_MAX_LEVEL}k{background-image:url(/img/dither/${DITHER_MAX_LEVEL}k.svg)`);
    const svg = await app.get(`/img/dither/${DITHER_MAX_LEVEL}k.svg`);
    expect(svg.headers.get("content-type")).toBe("image/svg+xml");
    expect((await svg.text()).match(/<rect /g)?.length).toBe(DITHER_MAX_LEVEL);
    expect((await app.get("/img/dither/16k.svg")).status).toBe(404);
  });

  it("labels every cell and makes it keyboard-focusable", async () => {
    const html = await app.html("/?view=week&date=2026-11-02");
    const slots = [...html.matchAll(/<div class="slot [^"]*"([^>]*)>/g)];
    expect(slots.length).toBe(336);
    for (const [, rest] of slots) {
      expect(rest).toContain('tabindex="0"');
      expect(rest).toMatch(/aria-label="[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2,3}, \d\d:\d\d–\d\d:\d\d, (\d{1,3}% busy|skipped by clock change)"/);
    }
  });
});

describe("top bar", () => {
  it("follows the §5.0.1 order in the HTML", async () => {
    const html = await app.html("/?view=week&date=2026-11-02");
    const topbar = html.slice(html.indexOf('<header class="topbar"'), html.indexOf("</header>"));
    const order = [...topbar.matchAll(/data-tb="([a-z]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["tabs", "today", "prev", "next", "period", "tz", "indicator", "download", "help", "contact", "theme"]);
    const tabs = [...topbar.matchAll(/<a class="tab"[^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);
    expect(tabs).toEqual(["Day", "Week", "Month", "Range"]);
  });

  it("renders the notice indicator hidden, even when a sticky notice is showing", async () => {
    const a = makeApp();
    await a.get("/");
    a.setNow(NOW + 3600_000);
    a.setFeed(() => Promise.reject(new Error("down")));
    const html = await a.html("/");
    expect(html).toContain('data-kind="sticky"');
    expect(tagWith(html, 'data-tb="indicator"')).toContain('hidden=""');
  });

  it("has a menu for narrow screens that works without JS (popover)", async () => {
    const html = await app.html("/");
    expect(html).toContain('popovertarget="tb-menu-items"');
    expect(tagWith(html, 'id="tb-menu-items"')).toContain('popover="auto"');
  });
});
