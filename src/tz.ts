// Time-zone arithmetic on UTC epoch seconds, using only Intl.

import { type ISODate, fromParts, parts } from "./dates";

export const FALLBACK_TZ = "Europe/London";

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

/**
 * A zone name Intl accepts, or null. Casing is normalised, but aliases are
 * kept as given (Intl would turn Asia/Kolkata into Asia/Calcutta, which
 * would rename the viewer's choice and disagree with the browser's name).
 */
export function canonicalZone(value: string | undefined | null): string | null {
  if (!value || value.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(value)) return null;
  try {
    const resolved = new Intl.DateTimeFormat("en-GB", { timeZone: value }).resolvedOptions().timeZone;
    return resolved.toLowerCase() === value.toLowerCase() ? resolved : value;
  } catch {
    return null;
  }
}

export interface ZonedParts {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
  s: number;
}

export function zonedParts(epochSec: number, tz: string): ZonedParts {
  const out: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(epochSec * 1000))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return { y: out.year!, m: out.month!, d: out.day!, h: out.hour!, min: out.minute!, s: out.second! };
}

/** The zone's offset from UTC at an instant, in seconds. */
export function offsetSeconds(epochSec: number, tz: string): number {
  const t = Math.floor(epochSec);
  const p = zonedParts(t, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) / 1000 - t;
}

/**
 * The instant at which a wall-clock time occurs in a zone.
 * - Repeated times (clocks going back) resolve to the earlier instant.
 * - Skipped times (clocks going forward) resolve to the instant of the change.
 * The result never decreases as the wall-clock time increases.
 */
export function zonedToEpoch(y: number, m: number, d: number, h: number, min: number, tz: string): number {
  const wall = Date.UTC(y, m - 1, d, h, min) / 1000;
  const before = offsetSeconds(wall - 86_400 / 2, tz);
  const after = offsetSeconds(wall + 86_400 / 2, tz);
  const candidates: number[] = [];
  for (const o of new Set([before, after])) {
    const t = wall - o;
    if (offsetSeconds(t, tz) === o) candidates.push(t);
  }
  if (candidates.length > 0) return Math.min(...candidates);
  // In a gap: find the change between the two readings by bisection.
  let lo = wall - after;
  let hi = wall - before;
  if (lo > hi) [lo, hi] = [hi, lo];
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (offsetSeconds(mid, tz) === before) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** The instant a calendar day starts (local 00:00) in a zone. */
export function startOfDay(date: ISODate, tz: string): number {
  const { y, m, d } = parts(date);
  return zonedToEpoch(y, m, d, 0, 0, tz);
}

/** The calendar date at an instant in a zone. */
export function dateAt(epochSec: number, tz: string): ISODate {
  const p = zonedParts(epochSec, tz);
  return fromParts(p.y, p.m, p.d);
}

/** "UTC+1", "UTC+5:30", "UTC-3", "UTC+0". */
export function formatOffset(offsetSec: number): string {
  const sign = offsetSec < 0 ? "-" : "+";
  const abs = Math.abs(Math.round(offsetSec / 60));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  // PRINTED OUTPUT: time zone / offset, short
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

/** "UTC plus 1", "UTC minus 3:30", for accessible names. */
export function spokenOffset(offsetSec: number): string {
  const sign = offsetSec < 0 ? "minus" : "plus";
  const abs = Math.abs(Math.round(offsetSec / 60));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  // PRINTED OUTPUT: time zone / offset, spoken
  return `UTC ${sign} ${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

let zoneList: string[] | null = null;

export function allZones(): string[] {
  if (!zoneList) {
    const list = Intl.supportedValuesOf("timeZone");
    zoneList = list.includes("UTC") ? list : [...list, "UTC"];
  }
  return zoneList;
}
