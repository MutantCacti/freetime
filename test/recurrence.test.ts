import { describe, expect, it } from "vitest";
import { busyFraction, mergeIntervals } from "../src/busy";
import { expandBusy, parseFeed } from "../src/ical";
import basic from "./fixtures/basic.ics?raw";
import dst from "./fixtures/dst.ics?raw";
import empty from "./fixtures/empty.ics?raw";
import { cellClass, makeApp } from "./helpers";
import { cellClasses } from "../src/dither";

const utc = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min) / 1000;
const iso = (s: number) => new Date(s * 1000).toISOString().slice(0, 16) + "Z";

function expand(text: string, from = utc(2026, 9, 1), to = utc(2027, 6, 1)) {
  return expandBusy(parseFeed(text), from, to)
    .sort((a, b) => a.start - b.start)
    .map((iv) => `${iso(iv.start)} ${iso(iv.end)}`);
}

describe("recurrence and expansion", () => {
  it("expands a weekly event, drops its EXDATE and moves the overridden instance", () => {
    const out = expand(basic);
    const standups = out.filter((s) => s.includes("T10:00Z") || s.includes("T09:00Z") || s.startsWith("2026-11-17T15"));
    expect(standups).toEqual([
      "2026-10-05T09:00Z 2026-10-05T10:00Z",
      "2026-10-12T09:00Z 2026-10-12T10:00Z",
      "2026-10-19T09:00Z 2026-10-19T10:00Z",
      "2026-10-26T10:00Z 2026-10-26T11:00Z",
      "2026-11-02T10:00Z 2026-11-02T11:00Z",
      // 9 Nov is an EXDATE; 16 Nov moved to 17 Nov 15:00.
      "2026-11-17T15:00Z 2026-11-17T16:00Z",
      "2026-11-23T10:00Z 2026-11-23T11:00Z",
      "2026-11-30T10:00Z 2026-11-30T11:00Z",
      "2026-12-07T10:00Z 2026-12-07T11:00Z",
    ]);
    expect(out.some((s) => s.startsWith("2026-11-09"))).toBe(false);
    expect(out.some((s) => s.startsWith("2026-11-16"))).toBe(false);
  });

  it("covers an all-day event's whole day", () => {
    expect(expand(basic)).toContain("2026-11-04T00:00Z 2026-11-05T00:00Z");
  });

  it("splits an event that crosses midnight across both days", async () => {
    const merged = mergeIntervals(expandBusy(parseFeed(basic), utc(2026, 11, 1), utc(2026, 11, 10)));
    // 22:00–02:00: two hours on each side of midnight.
    expect(busyFraction(merged, utc(2026, 11, 5), utc(2026, 11, 6))).toBeCloseTo(2 / 24);
    expect(busyFraction(merged, utc(2026, 11, 6), utc(2026, 11, 7))).toBeCloseTo(2 / 24);
    const html = await makeApp().html("/?view=week&date=2026-11-02");
    expect(html).toContain('aria-label="Thu 5 Nov, 23:30–00:00, 100% busy"');
    expect(html).toContain('aria-label="Fri 6 Nov, 00:00–00:30, 100% busy"');
    expect(html).toContain('aria-label="Fri 6 Nov, 01:30–02:00, 100% busy"');
    expect(html).toContain('aria-label="Fri 6 Nov, 02:00–02:30, 0% busy"');
  });

  it("keeps local times across the GMT/BST changeovers", () => {
    const out = expand(dst);
    // Autumn: last Sunday of October 2026 is the 25th.
    expect(out).toContain("2026-10-20T09:00Z 2026-10-20T10:00Z"); // 10:00 BST
    expect(out).toContain("2026-10-27T10:00Z 2026-10-27T11:00Z"); // 10:00 GMT
    // Spring: last Sunday of March 2027 is the 28th.
    expect(out).toContain("2027-03-24T10:00Z 2027-03-24T11:00Z"); // 10:00 GMT
    expect(out).toContain("2027-03-31T09:00Z 2027-03-31T10:00Z"); // 10:00 BST
    // A TZID with no VTIMEZONE in the feed resolves through Intl (US clocks change on 1 Nov).
    expect(out).toContain("2026-10-29T13:00Z 2026-10-29T14:00Z");
    expect(out).toContain("2026-11-05T14:00Z 2026-11-05T15:00Z");
  });

  it("renders weeks across both changeovers with 48 rows and events at 10:00 local", async () => {
    const app = makeApp({ feed: dst });
    for (const [date, label] of [
      ["2026-10-19", "Tue 20 Oct"],
      ["2026-10-26", "Tue 27 Oct"],
      ["2027-03-22", "Wed 24 Mar"],
      ["2027-03-29", "Wed 31 Mar"],
    ] as const) {
      const html = await app.html(`/?view=week&date=${date}&dtz=Europe/London`);
      expect(html.match(/class="slot /g)?.length).toBe(7 * 48);
      expect(html).toContain(`aria-label="${label}, 10:00–10:30, 100% busy"`);
      expect(html).toContain(`aria-label="${label}, 09:30–10:00, 0% busy"`);
      expect(html).toContain(`aria-label="${label}, 11:00–11:30, 0% busy"`);
    }
    // The spring-forward night has two rows that don't occur.
    const spring = await app.html("/?view=week&date=2027-03-22&dtz=Europe/London");
    expect(spring).toContain('aria-label="Sun 28 Mar, 01:00–01:30, skipped by clock change"');
    expect(spring).toContain('aria-label="Sun 28 Mar, 01:30–02:00, skipped by clock change"');
  });

  it("handles an empty calendar", async () => {
    expect(expand(empty)).toEqual([]);
    const res = await makeApp({ feed: empty }).get("/?view=week&date=2026-11-02");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toMatch(/aria-label="[^"]*, [1-9]\d*% busy"/);
    expect(html).toContain(`class="slot ${cellClasses(0)}`);
  });

  it("ignores transparent events", async () => {
    expect(expand(basic).some((s) => s.startsWith("2026-11-03T12:00Z"))).toBe(false);
    const html = await makeApp().html("/?view=day&date=2026-11-03");
    expect(cellClass(html, "Tue 3 Nov, 12:00–12:30, 0% busy")).toContain(cellClasses(0));
  });
});
