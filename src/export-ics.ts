// The .ics export: every busy event in the range, at the feeds' own
// precision. One VEVENT per event, unmerged and unclipped: timed events in
// UTC to the second, all-day events as all-day dates. Only start and end
// times; titles and other details never leave the parser.

import type { Interval } from "./ical";

export const EXPORT_FILENAME = "mutantcacti-busy.ics";

/** "20261102T140300Z" */
function icsTime(epochSec: number): string {
  return new Date(epochSec * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** "20261104" */
function icsDate(date: string): string {
  return date.replace(/-/g, "");
}

/**
 * The events to export: every interval that overlaps [from, to), whole (not
 * clipped to the range), in time order. The same event listed by two feeds
 * appears once.
 */
export function exportEvents(intervals: Interval[], from: number, to: number): Interval[] {
  const seen = new Set<string>();
  const out: Interval[] = [];
  for (const iv of [...intervals].sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (iv.end <= from || iv.start >= to) continue;
    const key = iv.allDay ? `d${iv.allDay.from}/${iv.allDay.to}` : `t${iv.start}/${iv.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(iv);
  }
  return out;
}

export function buildBusyIcs(events: Interval[], nowSec: number): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//time.mutantcacti.com//busy times//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Maxence's free time", // PRINTED OUTPUT: ics / calendar name
  ];
  events.forEach((ev, i) => {
    const when = ev.allDay
      ? [`DTSTART;VALUE=DATE:${icsDate(ev.allDay.from)}`, `DTEND;VALUE=DATE:${icsDate(ev.allDay.to)}`]
      : [`DTSTART:${icsTime(ev.start)}`, `DTEND:${icsTime(ev.end)}`];
    lines.push(
      "BEGIN:VEVENT",
      `UID:${ev.start}-${ev.end}-${i}@time.mutantcacti.com`,
      `DTSTAMP:${icsTime(nowSec)}`,
      ...when,
      "SUMMARY:Busy", // PRINTED OUTPUT: ics / event summary
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
