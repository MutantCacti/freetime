// The calendar model: every cell's time span, busy fraction, label and
// classes, for the column layout (Day, Week, short Range) and the day-cell
// layout (Month, long Range).

import { busyFraction } from "./busy";
import { DAY_END, DAY_START, SLOT_MINUTES } from "./config";
import { type ISODate, addDays, eachDay, endOfMonth, parts, startOfMonth, startOfWeek } from "./dates";
import { cellClasses } from "./dither";
import { dayCellLabel, dayHeader, hhmm, slotLabel } from "./format";
import type { Interval } from "./ical";
import { type Period, today } from "./state";
import { startOfDay, zonedToEpoch } from "./tz";

/** Checked at start-up: a bad day window fails loudly instead of drawing a wrong calendar. */
export function checkDayWindow(start: number, end: number, slot: number): void {
  const ok = Number.isInteger(start) && Number.isInteger(end) && 0 <= start && start < end && end <= 24 * 60 && start % slot === 0 && end % slot === 0;
  if (!ok) throw new Error(`DAY_START (${start}) and DAY_END (${end}) must be multiples of ${slot} with 0 ≤ DAY_START < DAY_END ≤ 1440`);
}
checkDayWindow(DAY_START, DAY_END, SLOT_MINUTES);

/** The day window: minutes after midnight, [start, end). */
export interface DayWindow {
  start: number;
  end: number;
}

export const DAY_WINDOW: DayWindow = { start: DAY_START, end: DAY_END };

/** The instant `minutes` after midnight on a date, in a zone; 1440 is the next day's midnight. */
function minutesInto(date: ISODate, minutes: number, zone: string): number {
  if (minutes === 24 * 60) return startOfDay(addDays(date, 1), zone);
  const { y, m, d } = parts(date);
  return zonedToEpoch(y, m, d, Math.floor(minutes / 60), minutes % 60, zone);
}

/** The day window of a date as instants: [start, end). */
export function dayWindow(date: ISODate, zone: string, window: DayWindow = DAY_WINDOW): { start: number; end: number } {
  return { start: minutesInto(date, window.start, zone), end: minutesInto(date, window.end, zone) };
}

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

export function buildColumns(period: Period, zone: string, merged: Interval[], nowSec: number, window: DayWindow = DAY_WINDOW): Column[] {
  const rows = (window.end - window.start) / SLOT_MINUTES;
  const todayDate = today(nowSec, zone);
  return eachDay(period.start, period.end).map((date) => {
    const isToday = date === todayDate;
    const slots: Slot[] = [];
    for (let i = 0; i < rows; i++) {
      const minutes = window.start + i * SLOT_MINUTES;
      const hour = Math.floor(minutes / 60);
      const minute = minutes % 60;
      const start = minutesInto(date, minutes, zone);
      const end = minutesInto(date, minutes + SLOT_MINUTES, zone);
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
export function buildDayCells(period: Period, zone: string, merged: Interval[], nowSec: number, window: DayWindow = DAY_WINDOW): DayCell[][] {
  const todayDate = today(nowSec, zone);
  const first = startOfWeek(period.view === "month" ? startOfMonth(period.start) : period.start);
  const lastDay = period.view === "month" ? endOfMonth(period.start) : period.end;
  const last = addDays(startOfWeek(lastDay), 6);
  const weeks: DayCell[][] = [];
  let week: DayCell[] = [];
  for (const date of eachDay(first, last)) {
    // Only the day window counts: a free night shouldn't make a busy day look free.
    const { start, end } = dayWindow(date, zone, window);
    const fraction = busyFraction(merged, start, end);
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
