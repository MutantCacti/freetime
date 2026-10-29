// Match mode: the calendar drawn as the when2meet grid you see, in your zone,
// each slot free or busy (W2M-SPEC.md §1.3).

import { RANGE_CAP_DAYS, W2M_BUSY_THRESHOLD } from "./config";
import { type ISODate, addDays, fromParts, startOfWeek, weekdayMon0 } from "./dates";
import { dayHeader, dayShort, hhmm, spanLabel } from "./format";
import type { Interval } from "./ical";
import { today } from "./state";
import { type W2mEvent, gridFor } from "./w2m";
import { zonedParts, zonedToEpoch } from "./tz";

export type SlotState = "free" | "busy";

export interface MatchCell {
  start: number;
  end: number;
  state: SlotState;
  past: boolean;
  label: string;
}

export interface MatchRow {
  /** Seconds after midnight. */
  time: number;
  label: string;
  /** On the hour: drawn with a rule above it. */
  hour: boolean;
  /** The times jump before this row (03:45, then 23:00): a visible break, as when2meet draws. */
  breakBefore: boolean;
}

export interface MatchColumn {
  date: ISODate;
  header: string;
  isToday: boolean;
}

export interface MatchGrid {
  columns: MatchColumn[];
  rows: MatchRow[];
  /** cells[row][column]; null where the event has no slot (when2meet's grey cell). */
  cells: (MatchCell | null)[][];
  /** First and last instants covered, for loading busy times. */
  from: number;
  to: number;
  /** More than RANGE_CAP_DAYS columns: only the first ones are drawn. */
  capped: boolean;
}

/** A slot as an instant span with its place in the grid. */
interface Placed {
  start: number;
  end: number;
  col: number;
  row: number;
}

/** The Monday a days-of-the-week event is shown on: `w2mweek` if valid, else the next Monday from today (today if it is one). */
export function matchWeek(raw: ISODate | null, todayDate: ISODate): ISODate {
  if (raw) return startOfWeek(raw);
  const wd = weekdayMon0(todayDate);
  return wd === 0 ? todayDate : addDays(todayDate, 7 - wd);
}

function layout(event: W2mEvent, zone: string, week: ISODate) {
  const L = event.slotSeconds;
  if (event.kind === "dates") {
    const g = gridFor(event.slots, zone);
    const placed = event.slots.map((t, i) => ({ start: t, end: t + L, col: g.positions[i]![0], row: g.positions[i]![1] }));
    return { dates: g.dates, times: g.times, placed };
  }
  // Days of the week: each slot's UTC fields are its wall-clock weekday and time, placed in the chosen week, in your zone.
  const wall = event.slots.map((t) => {
    const p = zonedParts(t, "UTC");
    return { weekday: weekdayMon0(fromParts(p.y, p.m, p.d)), time: p.h * 3600 + p.min * 60 };
  });
  const weekdays = [...new Set(wall.map((w) => w.weekday))].sort((a, b) => a - b);
  const times = [...new Set(wall.map((w) => w.time))].sort((a, b) => a - b);
  const dates = weekdays.map((wd) => addDays(week, wd));
  const at = (date: ISODate, seconds: number) => {
    const [y, m, d] = date.split("-").map(Number) as [number, number, number];
    return zonedToEpoch(y, m, d, Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), zone);
  };
  const placed = wall.map((w) => {
    const date = addDays(week, w.weekday);
    return { start: at(date, w.time), end: at(date, w.time + L), col: weekdays.indexOf(w.weekday), row: times.indexOf(w.time) };
  });
  return { dates, times, placed };
}

/** Overlap, in seconds, of merged busy intervals with [start, end). */
function overlap(merged: Interval[], start: number, end: number): number {
  let total = 0;
  for (const iv of merged) {
    if (iv.end <= start) continue;
    if (iv.start >= end) break;
    total += Math.min(end, iv.end) - Math.max(start, iv.start);
  }
  return total;
}

/** The grid's shape, before busy times are known. */
export function matchShape(event: W2mEvent, zone: string, week: ISODate) {
  const { dates, times, placed } = layout(event, zone, week);
  const capped = dates.length > RANGE_CAP_DAYS;
  const kept = placed.filter((p) => p.col < RANGE_CAP_DAYS);
  return {
    dates: dates.slice(0, RANGE_CAP_DAYS),
    times,
    placed: kept,
    capped,
    from: Math.min(...kept.map((p) => p.start)),
    to: Math.max(...kept.map((p) => p.end)),
  };
}

/** A slot is busy if busy time overlaps it by more than W2M_BUSY_THRESHOLD seconds. */
export function slotState(merged: Interval[], start: number, end: number): SlotState {
  return overlap(merged, start, end) > W2M_BUSY_THRESHOLD ? "busy" : "free";
}

export function buildMatchGrid(shape: ReturnType<typeof matchShape>, slotSeconds: number, zone: string, merged: Interval[], nowSec: number): MatchGrid {
  const todayDate = today(nowSec, zone);
  const columns = shape.dates.map((date) => ({ date, header: dayHeader(date), isToday: date === todayDate }));
  const rows = shape.times.map((time, i) => ({
    time,
    label: hhmm(Math.floor(time / 3600), Math.floor((time % 3600) / 60)),
    hour: time % 3600 === 0,
    breakBefore: i > 0 && time - shape.times[i - 1]! > slotSeconds,
  }));
  const cells: (MatchCell | null)[][] = rows.map(() => columns.map(() => null));
  for (const p of shape.placed) {
    const state = slotState(merged, p.start, p.end);
    const t = shape.times[p.row]!;
    const from = hhmm(Math.floor(t / 3600), Math.floor((t % 3600) / 60));
    const e = (t + slotSeconds) % 86_400;
    const to = hhmm(Math.floor(e / 3600), Math.floor((e % 3600) / 60));
    cells[p.row]![p.col] = { start: p.start, end: p.end, state, past: p.end <= nowSec, label: cellLabel(shape.dates[p.col]!, from, to, state) };
  }
  return { columns, rows, cells, from: shape.from, to: shape.to, capped: shape.capped };
}

/** "Tue 3 Nov, 09:00–09:15, free" */
export function cellLabel(date: ISODate, from: string, to: string, state: SlotState): string {
  // PRINTED OUTPUT: match mode / slot accessible label
  return `${dayShort(date)}, ${from}–${to}, ${state === "busy" ? "busy" : "free"}`;
}

/** "09:00–17:00", or "00:00–04:00 and 23:00–00:00" when the rows have a break. */
export function hoursLabel(times: number[], slotSeconds: number): string {
  const bands: [number, number][] = [];
  for (const t of times) {
    const last = bands[bands.length - 1];
    if (last && t - last[1] === slotSeconds) last[1] = t;
    else bands.push([t, t]);
  }
  const fmt = (s: number) => hhmm(Math.floor((s % 86_400) / 3600), Math.floor((s % 3600) / 60));
  // PRINTED OUTPUT: match mode / hours, one band or several
  return bands.map(([a, b]) => `${fmt(a)}–${fmt(b + slotSeconds)}`).join(" and ");
}

/** The when2meet toast's text (W2M-SPEC.md §1.4). */
export function matchSummary(event: W2mEvent, grid: MatchGrid, zone: string, week: ISODate): string {
  const first = grid.columns[0]!.date;
  const last = grid.columns[grid.columns.length - 1]!.date;
  const minutes = event.slotSeconds / 60;
  const hours = hoursLabel(
    grid.rows.map((r) => r.time),
    event.slotSeconds,
  );
  const parts: string[] = [];
  if (event.kind === "dates") {
    // PRINTED OUTPUT: match mode / toast, dates event
    parts.push(`Matched to when2meet: ${spanLabel(first, last)}, ${hours}, ${minutes}-minute slots.`);
    // PRINTED OUTPUT: match mode / toast, event made in another zone
    if (event.zone !== zone) parts.push(`Event made in ${event.zone}; shown in your time zone, as when2meet shows it.`);
  } else {
    // PRINTED OUTPUT: match mode / toast, days-of-the-week event
    parts.push(`Matched to when2meet: week of ${dayShort(week)}, ${hours}, ${minutes}-minute slots.`);
  }
  // PRINTED OUTPUT: match mode / toast, event longer than the Range cap
  if (grid.capped) parts.push(`Showing the first ${RANGE_CAP_DAYS} days.`);
  return parts.join(" ");
}

/** The error panel's explanation for each when2meet code. */
export function w2mProblem(code: string): string {
  // PRINTED OUTPUT: match mode / error explanations
  if (code === "W2M_NOT_FOUND") return "when2meet says this event doesn't exist. Check the link.";
  if (code === "W2M_TOO_LARGE") return "This event is too large to match.";
  if (code === "W2M_PARSE") return "when2meet's page has changed, so this event can't be matched safely.";
  if (code === "W2M_URL") return "This isn't a when2meet event link.";
  return "when2meet couldn't be reached. Try again in a minute.";
}
