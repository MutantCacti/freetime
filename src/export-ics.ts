// The .ics export: busy blocks only, in UTC, one VEVENT per block.

import type { Interval } from "./ical";

export const EXPORT_FILENAME = "mutantcacti-busy.ics";

/** "20261102T140300Z" */
function icsTime(epochSec: number): string {
  return new Date(epochSec * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function buildBusyIcs(blocks: Interval[], nowSec: number): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//time.mutantcacti.com//busy times//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Maxence's free time'", // PRINTED OUTPUT: ics / calendar name
  ];
  for (const b of blocks) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${b.start}-${b.end}@time.mutantcacti.com`,
      `DTSTAMP:${icsTime(nowSec)}`,
      `DTSTART:${icsTime(b.start)}`,
      `DTEND:${icsTime(b.end)}`,
      "SUMMARY:Busy", // PRINTED OUTPUT: ics / event summary
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
