// The calendar model: every cell's time span, busy fraction, label and
// classes, for the column layout (Day, Week, short Range) and the day-cell
// layout (Month, long Range).

import { busyFraction } from "./busy";
import { SLOT_MINUTES } from "./config";
import { type ISODate, addDays, eachDay, endOfMonth, parts, startOfMonth, startOfWeek } from "./dates";
import { cellClasses } from "./dither";
import { dayCellLabel, dayHeader, hhmm, slotLabel } from "./format";
import type { Interval } from "./ical";
import { type Period, today } from "./state";
import { offsetSeconds, startOfDay, zonedToEpoch } from "./tz";

export const SLOTS_PER_DAY = (24 * 60) / SLOT_MINUTES;

export interface Slot {
  start: number;
  end: number;
  hour: number;
  minute: number;
  fraction: number;
  classes: string;
  label: string;
  past: boolean;
  /** Minute step (0–29) of the current-time line, if now falls in this slot. */
  nowStep: number | null;
}

export interface Column {
  date: ISODate;
  header: string;
  isToday: boolean;
  slots: Slot[];
}

export interface DayCell {
  date: ISODate;
  dayOfMonth: number;
  /** Inside the month (Month) or the range (Range). */
  inPeriod: boolean;
  isToday: boolean;
  /** A day before today. */
  isPast: boolean;
  fraction: number;
  classes: string;
  label: string;
}

/** Steps the current-time line can sit at within a slot. */
export const NOW_STEPS = SLOT_MINUTES;

export function buildColumns(period: Period, zone: string, merged: Interval[], nowSec: number): Column[] {
  const todayDate = today(nowSec, zone);
  return eachDay(period.start, period.end).map((date) => {
    const { y, m, d } = parts(date);
    const isToday = date === todayDate;
    const slots: Slot[] = [];
    for (let i = 0; i < SLOTS_PER_DAY; i++) {
      const minutes = i * SLOT_MINUTES;
      const hour = Math.floor(minutes / 60);
      const minute = minutes % 60;
      const start = zonedToEpoch(y, m, d, hour, minute, zone);
      const end =
        i === SLOTS_PER_DAY - 1
          ? startOfDay(addDays(date, 1), zone)
          : zonedToEpoch(y, m, d, Math.floor((minutes + SLOT_MINUTES) / 60), (minutes + SLOT_MINUTES) % 60, zone);
      const skipped = end <= start;
      const fraction = skipped ? 0 : busyFraction(merged, start, end);
      const endMinutes = minutes + SLOT_MINUTES;
      const to = endMinutes === 24 * 60 ? hhmm(0, 0) : hhmm(Math.floor(endMinutes / 60), endMinutes % 60);
      const hasNow = isToday && !skipped && start <= nowSec && nowSec < end;
      slots.push({
        start,
        end,
        hour,
        minute,
        fraction,
        classes: cellClasses(fraction),
        label: slotLabel(date, hhmm(hour, minute), to, fraction, skipped),
        // Everything before now is greyed, on every day; the slot holding now is split.
        past: !skipped ? end <= nowSec : start <= nowSec,
        nowStep: hasNow ? Math.min(NOW_STEPS - 1, Math.floor(((nowSec - start) / (end - start)) * NOW_STEPS)) : null,
      });
    }
    return { date, header: dayHeader(date), isToday, slots };
  });
}

/** Weeks of day cells, Monday first. Month view pads to whole weeks; so does Range. */
export function buildDayCells(period: Period, zone: string, merged: Interval[], nowSec: number): DayCell[][] {
  const todayDate = today(nowSec, zone);
  const first = startOfWeek(period.view === "month" ? startOfMonth(period.start) : period.start);
  const lastDay = period.view === "month" ? endOfMonth(period.start) : period.end;
  const last = addDays(startOfWeek(lastDay), 6);
  const weeks: DayCell[][] = [];
  let week: DayCell[] = [];
  for (const date of eachDay(first, last)) {
    const fraction = busyFraction(merged, startOfDay(date, zone), startOfDay(addDays(date, 1), zone));
    week.push({
      date,
      dayOfMonth: parts(date).d,
      inPeriod: period.start <= date && date <= lastDay,
      isToday: date === todayDate,
      isPast: date < todayDate,
      fraction,
      classes: cellClasses(fraction),
      label: dayCellLabel(date, fraction),
    });
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  return weeks;
}

/** UTC bounds of a period's days in a zone: [start of first day, start of the day after the last). */
export function periodBounds(start: ISODate, end: ISODate, zone: string): { from: number; to: number } {
  return { from: startOfDay(start, zone), to: startOfDay(addDays(end, 1), zone) };
}

/** Offsets at the start and end of a period; equal unless the period crosses a DST change. */
export function periodOffsets(start: ISODate, end: ISODate, zone: string): [number, number] {
  const { from, to } = periodBounds(start, end, zone);
  return [offsetSeconds(from, zone), offsetSeconds(to - 1, zone)];
}
