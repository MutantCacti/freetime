// URL state: the view, its period, the time zone, and navigation.

import { DEFAULT_TZ, RANGE_CAP_DAYS, RANGE_COLUMN_MAX_DAYS } from "./config";
import {
  type ISODate,
  addDays,
  addMonths,
  diffDays,
  endOfMonth,
  parseISODate,
  startOfMonth,
  startOfWeek,
} from "./dates";
import { canonicalZone, dateAt } from "./tz";

// ---------------------------------------------------------------- time zone

export type ZoneMode = "pinned" | "device" | "default";

export interface ZoneState {
  /** The zone everything is shown in. */
  zone: string;
  mode: ZoneMode;
  /** Valid, canonical `tz`, or null. */
  tz: string | null;
  /** Valid, canonical `dtz`, or null. */
  dtz: string | null;
  /** `tz` was given but Intl doesn't accept it. */
  tzInvalid: boolean;
}

/** `tz` if valid, otherwise `dtz` if valid, otherwise Europe/London. */
export function resolveZone(rawTz: string | undefined, rawDtz: string | undefined): ZoneState {
  const tz = canonicalZone(rawTz);
  const dtz = canonicalZone(rawDtz);
  const zone = tz ?? dtz ?? DEFAULT_TZ;
  const mode: ZoneMode = tz && tz !== dtz ? "pinned" : dtz ? "device" : "default";
  return { zone, mode, tz, dtz, tzInvalid: Boolean(rawTz) && !tz };
}

// ---------------------------------------------------------------- views

export type View = "day" | "week" | "month" | "range";
export const VIEWS: readonly View[] = ["day", "week", "month", "range"];

export type Adjustment = "swapped" | "capped" | "invalid";

export interface Period {
  view: View;
  /** First day shown, inclusive. */
  start: ISODate;
  /** Last day shown, inclusive. */
  end: ISODate;
  /** For Day/Week/Month: the `date` the view was asked for. */
  date: ISODate;
  /** Range only: Week-style columns or Month-style day cells. */
  layout: "columns" | "cells";
  adjustments: Adjustment[];
}

export interface Query {
  view?: string;
  date?: string;
  from?: string;
  to?: string;
}

export function today(nowSec: number, zone: string): ISODate {
  return dateAt(nowSec, zone);
}

/** Validate a range: swap reversed dates, cap the length, fall back to this week. */
export function normaliseRange(
  rawFrom: string | undefined,
  rawTo: string | undefined,
  todayDate: ISODate,
): { from: ISODate; to: ISODate; adjustments: Adjustment[] } {
  let from = parseISODate(rawFrom);
  let to = parseISODate(rawTo);
  const adjustments: Adjustment[] = [];
  if (!from || !to) {
    const start = startOfWeek(todayDate);
    return { from: start, to: addDays(start, 6), adjustments: ["invalid"] };
  }
  if (to < from) {
    [from, to] = [to, from];
    adjustments.push("swapped");
  }
  if (diffDays(from, to) + 1 > RANGE_CAP_DAYS) {
    to = addDays(from, RANGE_CAP_DAYS - 1);
    adjustments.push("capped");
  }
  return { from, to, adjustments };
}

export function periodFor(query: Query, todayDate: ISODate): Period {
  const view: View = VIEWS.includes(query.view as View) ? (query.view as View) : "week";
  if (view === "range") {
    const { from, to, adjustments } = normaliseRange(query.from, query.to, todayDate);
    const layout = diffDays(from, to) + 1 <= RANGE_COLUMN_MAX_DAYS ? "columns" : "cells";
    return { view, start: from, end: to, date: from, layout, adjustments };
  }
  const date = parseISODate(query.date) ?? todayDate;
  if (view === "day") return { view, start: date, end: date, date, layout: "columns", adjustments: [] };
  if (view === "week") {
    const start = startOfWeek(date);
    return { view, start, end: addDays(start, 6), date: start, layout: "columns", adjustments: [] };
  }
  const start = startOfMonth(date);
  return { view, start, end: endOfMonth(date), date: start, layout: "cells", adjustments: [] };
}

export function containsDate(period: Period, date: ISODate): boolean {
  return period.start <= date && date <= period.end;
}

/** URL parameters (other than zone) that describe a period. */
export type ViewParams = { view: View; date?: ISODate; from?: ISODate; to?: ISODate };

export function paramsFor(period: Period): ViewParams {
  return period.view === "range"
    ? { view: "range", from: period.start, to: period.end }
    : { view: period.view, date: period.date };
}

export interface Navigation {
  today: ViewParams;
  todayDisabled: boolean;
  prev: ViewParams;
  next: ViewParams;
}

/** The §5.5 navigation table. */
export function navigation(period: Period, todayDate: ISODate): Navigation {
  const todayDisabled = containsDate(period, todayDate);
  switch (period.view) {
    case "day":
      return {
        today: { view: "day", date: todayDate },
        todayDisabled,
        prev: { view: "day", date: addDays(period.date, -1) },
        next: { view: "day", date: addDays(period.date, 1) },
      };
    case "week":
      return {
        today: { view: "week", date: startOfWeek(todayDate) },
        todayDisabled,
        prev: { view: "week", date: addDays(period.start, -7) },
        next: { view: "week", date: addDays(period.start, 7) },
      };
    case "month":
      return {
        today: { view: "month", date: startOfMonth(todayDate) },
        todayDisabled,
        prev: { view: "month", date: addMonths(period.start, -1) },
        next: { view: "month", date: addMonths(period.start, 1) },
      };
    case "range": {
      const length = diffDays(period.start, period.end) + 1;
      return {
        today: { view: "range", from: todayDate, to: addDays(todayDate, length - 1) },
        todayDisabled,
        prev: { view: "range", from: addDays(period.start, -length), to: addDays(period.end, -length) },
        next: { view: "range", from: addDays(period.start, length), to: addDays(period.end, length) },
      };
    }
  }
}

/** Where each view tab goes from the current period. */
export function tabTargets(period: Period, todayDate: ISODate): Record<View, ViewParams> {
  const anchor = containsDate(period, todayDate) ? todayDate : period.start;
  return {
    day: { view: "day", date: anchor },
    week: { view: "week", date: startOfWeek(anchor) },
    month: { view: "month", date: startOfMonth(anchor) },
    range: { view: "range", from: period.start, to: period.end },
  };
}

/** Whether a view's links should land on the 08:00 anchor. */
export function usesTimeWindow(params: ViewParams): boolean {
  if (params.view === "day" || params.view === "week") return true;
  if (params.view === "range" && params.from && params.to) {
    return diffDays(params.from, params.to) + 1 <= RANGE_COLUMN_MAX_DAYS;
  }
  return false;
}
