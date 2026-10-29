import { describe, expect, it } from "vitest";
import { DAY_WINDOW, checkDayWindow } from "../src/calendar";
import { attr, cellClass, decode, makeApp, tagWith } from "./helpers";

/** Wed 4 Nov 2026 (London is on UTC): busy 02:00–06:00 and 08:00–20:00. */
const FEED = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//test//EN",
  "BEGIN:VEVENT",
  "UID:night",
  "DTSTAMP:20261001T000000Z",
  "DTSTART:20261104T020000Z",
  "DTEND:20261104T060000Z",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:day",
  "DTSTAMP:20261001T000000Z",
  "DTSTART:20261104T080000Z",
  "DTEND:20261104T200000Z",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:night-only",
  "DTSTAMP:20261001T000000Z",
  "DTSTART:20261105T010000Z",
  "DTEND:20261105T070000Z",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

const live = (window = DAY_WINDOW) => makeApp({ feed: FEED, deps: { dayWindow: window } });
const labels = (html: string) => [...html.matchAll(/<div class="timelabel[^"]*"(?: id="([^"]+)")?>([^<]*)<\/div>/g)].map((m) => [m[1], m[2]]);

describe("the day window", () => {
  it("is 08:00 to midnight", () => {
    expect(DAY_WINDOW).toEqual({ start: 8 * 60, end: 24 * 60 });
  });

  it("columns hold only its rows: 08:00 to midnight, 32 half-hours", async () => {
    const html = decode(await live().html("/?view=week&date=2026-11-02&dtz=Europe/London"));
    const rows = labels(html);
    expect(rows).toHaveLength(32);
    expect(rows[0]).toEqual(["h08", "08:00"]);
    expect(rows[31]).toEqual([undefined, ""]);
    expect(html).toContain('aria-label="Wed 4 Nov, 23:30–00:00, 0% busy"');
    expect(html).not.toMatch(/aria-label="[^"]*, 07:30–08:00/);
    expect(cellClass(html, "Wed 4 Nov, 08:00–08:30, 100% busy")).not.toBeNull();
    expect(attr(tagWith(html, 'id="cal-scroll"'), "data-start-anchor")).toBe("h08");
  });

  it("day cells count busy time inside it only", async () => {
    const html = decode(await live().html("/?view=month&date=2026-11-01&dtz=Europe/London"));
    // 08:00–20:00 is 12 of the window's 16 hours; the 02:00–06:00 event doesn't count.
    expect(html).toContain('aria-label="Wed 4 Nov, 75% busy"');
    // Busy only at night: free in the window.
    expect(html).toContain('aria-label="Thu 5 Nov, 0% busy"');
  });

  it("can start at a half hour: the first row is labelled and is the anchor", async () => {
    const html = decode(await live({ start: 8 * 60 + 30, end: 22 * 60 }).html("/?view=day&date=2026-11-04&dtz=Europe/London"));
    const rows = labels(html);
    expect(rows).toHaveLength(27);
    expect(rows[0]).toEqual(["h0830", "08:30"]);
    expect(rows[1]).toEqual(["h09", "09:00"]);
    expect(html).toContain('aria-label="Wed 4 Nov, 21:30–22:00, 0% busy"');
  });

  it("has no current-time line when now is outside it", async () => {
    const app = makeApp({ feed: FEED, now: Date.UTC(2026, 10, 3, 3, 0), deps: { dayWindow: DAY_WINDOW } });
    const html = await app.html("/?view=week&date=2026-11-02&dtz=Europe/London");
    expect(html).not.toContain('id="now-line"');
  });

  it.each([
    [0, 0],
    [600, 480],
    [-30, 480],
    [480, 1500],
    [485, 1440],
    [480, 1450],
  ])("refuses %i–%i", (start, end) => {
    expect(() => checkDayWindow(start, end, 30)).toThrow(/DAY_START/);
  });

  it("accepts whole days and the default", () => {
    expect(() => checkDayWindow(0, 1440, 30)).not.toThrow();
    expect(() => checkDayWindow(480, 1440, 30)).not.toThrow();
  });
});
