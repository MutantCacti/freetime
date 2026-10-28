import { describe, expect, it } from "vitest";
import { attr, decode, makeApp, params, tagWith, topbarHref } from "./helpers";

const app = makeApp();

function events(ics: string): string[] {
  return [...ics.matchAll(/DTSTART:(\S+)\r\nDTEND:(\S+)\r\n/g)].map((m) => `${m[1]} ${m[2]}`);
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
    expect(ics).toContain("X-WR-CALNAME:Maxence busy times");
    expect(events(ics)).toEqual([
      "20261102T100000Z 20261102T110000Z",
      "20261103T140000Z 20261103T141500Z",
      "20261104T000000Z 20261105T000000Z",
      "20261105T220000Z 20261106T020000Z",
    ]);
    expect(ics.match(/SUMMARY:Busy\r\n/g)?.length).toBe(4);
  });

  it("uses UTC times only", async () => {
    const ics = await (await app.get("/free-busy.ics?from=2026-11-02&to=2026-11-08&tz=Pacific/Auckland")).text();
    expect(ics).not.toContain("TZID");
    for (const line of ics.split("\r\n").filter((l) => /^DT(START|END|STAMP):/.test(l))) expect(line).toMatch(/:\d{8}T\d{6}Z$/);
  });

  it("clips blocks to the range's day boundaries in the zone being shown", async () => {
    const ics = await (await app.get("/free-busy.ics?from=2026-11-06&to=2026-11-06")).text();
    // Only the part of the overnight event after midnight on 6 Nov.
    expect(events(ics)).toEqual(["20261106T000000Z 20261106T020000Z"]);
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
    expect(html).toContain("Busy times from Mon 2 Nov to Sun 8 Nov 2026, Europe/Paris.");
    expect(html).toContain("The file contains busy blocks only.");
    expect(html).toContain('href="/free-busy.ics?from=2026-11-02&to=2026-11-08&dtz=Europe/Paris"');
    expect(html).toContain('href="/?view=week&date=2026-11-02&dtz=Europe/Paris#h08">Cancel</a>');
  });

  it("the download dialog states the range in the zone being shown", async () => {
    const html = decode(await app.html("/?view=day&date=2026-11-03&tz=America/Los_Angeles"));
    expect(html).toContain("Busy times from Tue 3 Nov 2026, America/Los_Angeles.");
  });
});
