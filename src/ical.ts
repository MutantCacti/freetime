// iCal parsing and recurrence expansion. Only start and end times leave this
// module: titles, descriptions, locations, attendees and UIDs stay here.

import ICAL from "ical.js";
import { DEFAULT_TZ } from "./config";
import { canonicalZone, zonedToEpoch } from "./tz";

/** A busy interval in UTC epoch seconds, end exclusive. */
export interface Interval {
  start: number;
  end: number;
}

type Time = InstanceType<typeof ICAL.Time>;
type Event = InstanceType<typeof ICAL.Event>;
type Component = InstanceType<typeof ICAL.Component>;

export class FeedParseError extends Error {}

const MAX_OCCURRENCES_PER_EVENT = 100_000;

/** Parse a feed. Throws FeedParseError if it isn't a usable calendar. */
export function parseFeed(text: string): Component {
  let root: Component;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch (err) {
    throw new FeedParseError("iCal syntax error", { cause: err });
  }
  if (root.name !== "vcalendar") throw new FeedParseError(`root component is ${root.name}, not vcalendar`);
  return root;
}

function toEpoch(t: Time, tzid: string | null): number {
  if (t.isDate) return zonedToEpoch(t.year, t.month, t.day, 0, 0, DEFAULT_TZ);
  if (t.zone === ICAL.Timezone.utcTimezone) return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second) / 1000;
  const intlZone = canonicalZone(tzid);
  // Seconds are dropped for zoned times; calendars don't schedule to the second.
  if (intlZone) return zonedToEpoch(t.year, t.month, t.day, t.hour, t.minute, intlZone);
  if (t.zone && t.zone !== ICAL.Timezone.localTimezone && t.zone.tzid !== "floating") return t.toUnixTime();
  return zonedToEpoch(t.year, t.month, t.day, t.hour, t.minute, DEFAULT_TZ);
}

function tzidOf(comp: Component, name: string): string | null {
  const v = comp.getFirstProperty(name)?.getParameter("tzid");
  return typeof v === "string" ? v : null;
}

function isIgnored(comp: Component): boolean {
  const transp = String(comp.getFirstPropertyValue("transp") ?? "").toUpperCase();
  const status = String(comp.getFirstPropertyValue("status") ?? "").toUpperCase();
  return transp === "TRANSPARENT" || status === "CANCELLED";
}

function occurrenceInterval(item: Event, start: Time, end: Time, recurring: boolean): Interval | null {
  const comp = item.component;
  if (isIgnored(comp)) return null;
  const startTz = tzidOf(comp, "dtstart");
  const endTz = recurring ? startTz : (tzidOf(comp, "dtend") ?? startTz);
  let s = toEpoch(start, startTz);
  let e = toEpoch(end, endTz);
  if (start.isDate && e <= s) e = s + 86_400; // all-day with no DTEND
  if (e <= s) return null;
  return { start: s, end: e };
}

/**
 * Busy intervals overlapping [from, to), in no particular order.
 * Handles RRULE/RDATE, EXDATE, RECURRENCE-ID overrides, all-day events and
 * TZID times. TRANSPARENT and CANCELLED events are ignored.
 */
export function expandBusy(root: Component, from: number, to: number): Interval[] {
  const masters = new Map<string, Event>();
  const exceptions: Component[] = [];
  const singles: Event[] = [];

  for (const vevent of root.getAllSubcomponents("vevent")) {
    const uid = String(vevent.getFirstPropertyValue("uid") ?? "");
    if (vevent.hasProperty("recurrence-id")) exceptions.push(vevent);
    else if (vevent.hasProperty("rrule") || vevent.hasProperty("rdate")) masters.set(uid, new ICAL.Event(vevent));
    else singles.push(new ICAL.Event(vevent));
  }
  for (const ex of exceptions) {
    const master = masters.get(String(ex.getFirstPropertyValue("uid") ?? ""));
    if (master) master.relateException(ex);
    else singles.push(new ICAL.Event(ex));
  }

  const out: Interval[] = [];
  const keep = (iv: Interval | null) => {
    if (iv && iv.end > from && iv.start < to) out.push(iv);
  };

  for (const ev of singles) {
    if (!ev.startDate) continue;
    keep(occurrenceInterval(ev, ev.startDate, ev.endDate ?? ev.startDate, false));
  }

  for (const ev of masters.values()) {
    if (!ev.startDate) continue;
    const it = ev.iterator();
    const startTz = tzidOf(ev.component, "dtstart");
    for (let i = 0, next = it.next(); next && i < MAX_OCCURRENCES_PER_EVENT; i++, next = it.next()) {
      // Overrides can move an instance by days, so stop a week past the range.
      if (toEpoch(next, startTz) >= to + 7 * 86_400) break;
      const details = ev.getOccurrenceDetails(next);
      keep(occurrenceInterval(details.item, details.startDate, details.endDate, details.item === ev));
    }
  }
  return out;
}
