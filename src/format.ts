// Labels built from templates. Calendar dates are formatted in UTC, because a
// civil date has no time zone; instants are converted before they get here.

import { type ISODate, parts } from "./dates";

const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...options });
const weekdayFmt = fmt({ weekday: "short" });
const monthShortFmt = fmt({ month: "short" });
const monthLongFmt = fmt({ month: "long" });

function asDate(date: ISODate): Date {
  const { y, m, d } = parts(date);
  return new Date(Date.UTC(y, m - 1, d));
}

export function weekdayShort(date: ISODate): string {
  return weekdayFmt.format(asDate(date));
}

/** "Mon 2" */
export function dayHeader(date: ISODate): string {
  return `${weekdayShort(date)} ${parts(date).d}`; // PRINTED OUTPUT: calendar / column header
}

/** "Tue 3 Nov" */
export function dayShort(date: ISODate): string {
  return `${weekdayShort(date)} ${parts(date).d} ${monthShortFmt.format(asDate(date))}`; // PRINTED OUTPUT: date / short
}

/** "Tue 3 Nov 2026" */
export function dayLong(date: ISODate): string {
  return `${dayShort(date)} ${parts(date).y}`; // PRINTED OUTPUT: date / long
}

/** "November 2026" */
export function monthLabel(date: ISODate): string {
  return `${monthLongFmt.format(asDate(date))} ${parts(date).y}`; // PRINTED OUTPUT: date / month and year
}

/** "Oct 2026" */
export function monthShortYear(date: ISODate): string {
  return `${monthShortFmt.format(asDate(date))} ${parts(date).y}`; // PRINTED OUTPUT: period label / month and year
}

/**
 * The visible period label: months and year only, since the calendar shows
 * the dates. "Oct 2026", "Oct – Nov 2026", "Dec 2026 – Jan 2027".
 */
export function periodMonthsLabel(start: ISODate, end: ISODate): string {
  const a = parts(start);
  const b = parts(end);
  if (a.y === b.y && a.m === b.m) return monthShortYear(start);
  const month = (d: ISODate) => monthShortFmt.format(asDate(d));
  // PRINTED OUTPUT: period label / month span, same year and across a year
  return a.y === b.y ? `${month(start)} – ${month(end)} ${b.y}` : `${monthShortYear(start)} – ${monthShortYear(end)}`;
}

/**
 * "Mon 2 – Sun 8 Nov 2026", "Mon 30 Nov – Sun 6 Dec 2026",
 * "Mon 28 Dec 2026 – Sun 3 Jan 2027".
 */
export function spanLabel(start: ISODate, end: ISODate): string {
  if (start === end) return dayLong(start);
  const a = parts(start);
  const b = parts(end);
  const month = (d: ISODate) => monthShortFmt.format(asDate(d));
  // PRINTED OUTPUT: period label / date span, three forms
  if (a.y !== b.y) return `${dayLong(start)} – ${dayLong(end)}`;
  if (a.m !== b.m) return `${dayShort(start)} – ${dayShort(end)} ${b.y}`;
  return `${weekdayShort(start)} ${a.d} – ${weekdayShort(end)} ${b.d} ${month(end)} ${b.y}`;
}

/** "Mon 2 Nov to Sun 8 Nov 2026" */
export function exportSpanLabel(start: ISODate, end: ISODate): string {
  const a = parts(start);
  const b = parts(end);
  if (start === end) return dayLong(start);
  // PRINTED OUTPUT: download / date span
  return a.y === b.y ? `${dayShort(start)} to ${dayLong(end)}` : `${dayLong(start)} to ${dayLong(end)}`;
}

export function hhmm(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`; // PRINTED OUTPUT: calendar / time of day
}

export function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}% busy`; // PRINTED OUTPUT: calendar / busy amount
}

/** "Tue 3 Nov, 14:00–14:30, 50% busy" */
export function slotLabel(date: ISODate, from: string, to: string, fraction: number, skipped: boolean): string {
  // PRINTED OUTPUT: calendar / slot accessible label, normal and skipped by a clock change
  return skipped ? `${dayShort(date)}, ${from}–${to}, skipped by clock change` : `${dayShort(date)}, ${from}–${to}, ${percent(fraction)}`;
}

/** "Tue 3 Nov, 50% busy" */
export function dayCellLabel(date: ISODate, fraction: number): string {
  return `${dayShort(date)}, ${percent(fraction)}`; // PRINTED OUTPUT: calendar / day cell accessible label
}
