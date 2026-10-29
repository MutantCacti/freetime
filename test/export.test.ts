import { describe, expect, it } from "vitest";
import { exportEvents } from "../src/export-ics";
import { attr, decode, makeApp, params, tagWith, topbarHref } from "./helpers";

const app = makeApp();

/** Each VEVENT's start and end as written, for example "20261102T100000Z 20261102T110000Z" or "VALUE=DATE:20261104 VALUE=DATE:20261105". */
function events(ics: string): string[] {
  return [...ics.matchAll(/DTSTART[;:](\S+)\r\nDTEND[;:](\S+)\r\n/g)].map((m) => `${m[1]} ${m[2]}`);
}

const VTZ = [
  "BEGIN:VTIMEZONE", "TZID:Europe/London",
  "BEGIN:STANDARD", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0000", "DTSTART:19701025T020000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0000", "TZOFFSETTO:+0100", "DTSTART:19700329T010000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
  "END:VTIMEZONE",
];
function feed(...events: string[][]): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//t//t//EN", ...VTZ, ...events.flatMap((e, i) => ["BEGIN:VEVENT", `UID:e${i}`, "DTSTAMP:20261001T000000Z", ...e, "SUMMARY:SECRET", "END:VEVENT"]), "END:VCALENDAR"].join("\r\n");
}

describe(".ics export", () => {
  it("exports the range being viewed", async () => {
    const html = await app.html("/?view=week&date=2026-11-04");
    // The dialog's Download link and the no-JS /export link both carry the week.
    const download = attr(tagWith(html, 'download=""'), "href")!;
    expect(download).toBe("/free-busy.ics?from=2026-11-02&to=2026-11-08");
    expect(Object.fromEntries(params(topbarHref(html, "download")!))).toMatchObject({ from: "2026-11-02", to: "2026-11-08" });

    const res = await app.get(download);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="mutantcacti-busy.ics"');
    const ics = await res.text();
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("X-WR-CALNAME:Maxence's free time");
    expect(events(ics)).toEqual([
      "20261102T100000Z 20261102T110000Z",
      "20261103T140000Z 20261103T141500Z",
      // All-day events stay all-day, with the feed's own dates.
      "VALUE=DATE:20261104 VALUE=DATE:20261105",
      "20261105T220000Z 20261106T020000Z",
    ]);
    expect(ics.match(/SUMMARY:Busy\r\n/g)?.length).toBe(4);
  });

  it("writes timed events in UTC and all-day events as dates, never with a TZID", async () => {
    const ics = await (await app.get("/free-busy.ics?from=2026-11-02&to=2026-11-08&tz=Pacific/Auckland")).text();
    expect(ics).not.toContain("TZID");
    for (const line of ics.split("\r\n").filter((l) => /^DT(START|END|STAMP)[:;]/.test(l))) {
      expect(line).toMatch(/^DT(START|END|STAMP):\d{8}T\d{6}Z$|^DT(START|END);VALUE=DATE:\d{8}$/);
    }
  });

  it("includes events that cross the range's edges whole, not clipped", async () => {
    const ics = await (await app.get("/free-busy.ics?from=2026-11-06&to=2026-11-06")).text();
    // The overnight event starts on 5 Nov; it's exported as the feed has it.
    expect(events(ics)).toEqual(["20261105T220000Z 20261106T020000Z"]);
  });

  it("keeps the feed's precision: seconds, and overlapping events as separate events", async () => {
    const precise = makeApp({
      feed: feed(
        ["DTSTART;TZID=Europe/London:20261102T100030", "DTEND;TZID=Europe/London:20261102T104715"],
        ["DTSTART:20261102T103000Z", "DTEND:20261102T113000Z"],
      ),
    });
    const ics = await (await precise.get("/free-busy.ics?from=2026-11-02&to=2026-11-02")).text();
    expect(events(ics)).toEqual(["20261102T100030Z 20261102T104715Z", "20261102T103000Z 20261102T113000Z"]);
    expect(ics).not.toContain("SECRET");
  });

  it("lists an event that two feeds share once", () => {
    const a = { start: 100, end: 200 };
    const day = { start: 0, end: 86_400, allDay: { from: "2026-11-04", to: "2026-11-05" } };
    expect(exportEvents([a, { ...a }, day, { ...day }, { start: 150, end: 200 }], 0, 1000)).toEqual([day, a, { start: 150, end: 200 }]);
  });

  it("respects the 62-day cap", async () => {
    const ics = await (await app.get("/free-busy.ics?from=2026-09-01&to=2026-12-31")).text();
    const starts = events(ics).map((e) => e.slice(0, 8));
    expect(starts.at(-1)).toBe("20261026"); // 1 Sep + 61 days = 1 Nov; nothing after
    expect(starts.every((s) => s <= "20261101")).toBe(true);
  });

  it("keeps the privacy rule", async () => {
    const ics = await (await app.get("/free-busy.ics?from=2026-10-01&to=2026-11-30")).text();
    expect(ics).not.toMatch(/SECRET|secret|example\.com|DESCRIPTION|LOCATION|ATTENDEE/);
    expect(ics.match(/SUMMARY:/g)?.length).toBe(ics.match(/SUMMARY:Busy/g)?.length);
  });

  it("/export states the range and links to the download", async () => {
    const html = decode(await app.html("/export?view=week&date=2026-11-02&from=2026-11-02&to=2026-11-08&dtz=Europe/Paris"));
    expect(html).toContain("Download my calendar for the range 'Mon 2 Nov to Sun 8 Nov 2026', in time zone: Europe/Paris.");
    expect(html).toContain('href="/free-busy.ics?from=2026-11-02&to=2026-11-08&dtz=Europe/Paris"');
    expect(html).toContain('href="/?view=week&date=2026-11-02&dtz=Europe/Paris#h08">Cancel</a>');
  });

  it("the download dialog states the range in the zone being shown", async () => {
    const html = decode(await app.html("/?view=day&date=2026-11-03&tz=America/Los_Angeles"));
    expect(html).toContain("Download my calendar for the range 'Tue 3 Nov 2026', in time zone: America/Los_Angeles.");
  });
});
