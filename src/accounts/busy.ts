// A user's busy time: the merge of all their calendars (ACCOUNTS-SPEC.md §2, §7).
// Each calendar is fetched and cached exactly like the main site's feed
// (src/feed.ts): fresh for 5 minutes, with a saved copy if a fetch fails.

import { mergeIntervals } from "../busy";
import { AppError } from "../errors";
import { type FeedResult, fetchFromUrl, loadFeed } from "../feed";
import { expandBusyCached, type Interval } from "../ical";
import { sha256Hex } from "./crypto";
import type { Calendar } from "./db";
import { open } from "./secret-box";

export type FetchCalendar = (url: string) => Promise<Response>;

/** The production fetch: the main site's (webcal: becomes https:, 10 s timeout). */
export const fetchCalendarUrl: FetchCalendar = (url) => fetchFromUrl(url)();

export interface CalendarSources {
  /** ACCOUNTS_KEY, to decrypt the addresses. */
  key: string | undefined;
  fetchCalendar: FetchCalendar;
  cache: Cache;
  /** Base URL for cache keys (never a calendar's address). */
  cacheBase: string;
  nowSec: number;
  waitUntil: (p: Promise<unknown>) => void;
}

/** One calendar's parsed feed. The cache key changes with the address, so a new address never reuses an old copy. */
export async function loadCalendar(url: string, calendarId: number | string, src: CalendarSources): Promise<FeedResult> {
  return loadFeed({
    fetchFeed: () => src.fetchCalendar(url),
    nowSec: src.nowSec,
    cacheKey: `${src.cacheBase}/${calendarId}-${(await sha256Hex(url)).slice(0, 16)}`,
    cache: src.cache,
    waitUntil: src.waitUntil,
  });
}

/**
 * Merged busy intervals from all of a user's calendars over [from, to).
 * Like the main site, a calendar with neither a fresh fetch nor a saved copy
 * fails the whole view: drawing the others alone would show its busy time as free.
 */
export async function busyOf(calendars: Calendar[], from: number, to: number, src: CalendarSources): Promise<{ merged: Interval[]; stale: boolean }> {
  const results = await Promise.all(
    calendars.map(async (cal) => {
      const url = await open(src.key, "calendar", new Uint8Array(cal.secret));
      return loadCalendar(url, cal.calendar_id, src);
    }),
  );
  let events: Interval[];
  try {
    events = results.flatMap((r) => expandBusyCached(r.root, from, to));
  } catch (err) {
    throw new AppError("RANGE_EXPAND", err instanceof Error ? err.message : "expansion failed", { cause: err });
  }
  return { merged: mergeIntervals(events), stale: results.some((r) => r.stale) };
}

/** An address a user may add: https or webcal, at most 2,048 characters. */
export function calendarAddress(input: string): string | null {
  const v = input.trim();
  if (v.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "webcal:") return null;
  if (url.username || url.password) return null;
  return v;
}
