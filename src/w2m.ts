// when2meet events: recognising a link, fetching the page, and reading the
// event's structure from it, as docs/W2M-GET-SPEC.md says. Only the event's
// structure is read; participants and their availability are never touched.

import { W2M_CACHE_SECONDS, W2M_MAX_BYTES, W2M_TIMEOUT_MS } from "./config";
import { type ISODate, fromParts } from "./dates";
import { AppError } from "./errors";
import { canonicalZone, zonedParts } from "./tz";

// ---------------------------------------------------------------- links (GET spec §1)

export interface W2mRef {
  id: string;
  code: string;
}

const LINK_RE = /^https:\/\/(?:www\.)?when2meet\.com\/\?([1-9][0-9]{0,11})-([A-Za-z0-9]{5})$/;
const REF_RE = /^([1-9][0-9]{0,11})-([A-Za-z0-9]{5})$/;

/** The event in a pasted link, or null. Surrounding whitespace is ignored; nothing else is normalised. */
export function parseW2mLink(input: string | undefined | null): W2mRef | null {
  if (!input || input.length > 200) return null;
  const m = LINK_RE.exec(input.trim());
  return m ? { id: m[1]!, code: m[2]! } : null;
}

/** The event in a `w2m=<id>-<code>` parameter, or null. */
export function parseW2mParam(value: string | undefined | null): W2mRef | null {
  const m = value ? REF_RE.exec(value) : null;
  return m ? { id: m[1]!, code: m[2]! } : null;
}

export function refParam(ref: W2mRef): string {
  return `${ref.id}-${ref.code}`;
}

/** The only address ever fetched: rebuilt from the id and code, never the pasted text. */
export function eventUrl(ref: W2mRef): string {
  return `https://www.when2meet.com/?${refParam(ref)}`;
}

// ---------------------------------------------------------------- the event

export interface W2mEvent {
  id: string;
  /** "dates": specific dates in `zone`. "weekdays": wall-clock times, no zone. */
  kind: "dates" | "weekdays";
  /** The zone the event was made in (dates only). */
  zone: string | null;
  /** Slot starts, ascending. Real instants for dates; UTC-encoded wall-clock times (1978) for weekdays. */
  slots: number[];
  slotSeconds: number;
  /** Whether the page still has what the bookmarklet relies on (GET spec §3.9). */
  fill: "ok" | "drift";
}

// ---------------------------------------------------------------- the grid rule (GET spec §2.2)

export interface Grid {
  /** Columns: the civil dates (in the zone) that hold at least one slot. */
  dates: ISODate[];
  /** Rows: the distinct times of day (seconds after midnight) of the slots, in clock order. */
  times: number[];
  /** Each slot's [column, row]. */
  positions: [number, number][];
}

/** when2meet's grid for a set of slots in a zone. */
export function gridFor(slots: number[], zone: string): Grid {
  const local = slots.map((t) => {
    const p = zonedParts(t, zone);
    return { date: fromParts(p.y, p.m, p.d), time: p.h * 3600 + p.min * 60 + p.s };
  });
  const dates = [...new Set(local.map((l) => l.date))].sort();
  const times = [...new Set(local.map((l) => l.time))].sort((a, b) => a - b);
  const col = new Map(dates.map((d, i) => [d, i]));
  const row = new Map(times.map((t, i) => [t, i]));
  return { dates, times, positions: local.map((l) => [col.get(l.date)!, row.get(l.time)!]) };
}

// ---------------------------------------------------------------- parsing (GET spec §3)

/** Before 1980: when2meet's days-of-the-week events sit in 1978. */
const WEEKDAY_EPOCH_LIMIT = 315_532_800;

const FILL_MARKERS = ["function SelectFromHere(", "function SelectToHere(", "function SelectStop(", '"SaveTimes.php"', "var UserID"];

function parseError(id: string, why: string): AppError {
  return new AppError("W2M_PARSE", `when2meet event ${id}: ${why}`);
}

interface Cell {
  id: string;
  col: number;
  row: number;
  time: number;
}

/** The `YouTime…` cells, read with HTMLRewriter (any quoting, any attribute order). */
async function readCells(html: string): Promise<Cell[]> {
  const cells: Cell[] = [];
  const num = (v: string | null) => (v !== null && /^\d+$/.test(v) ? Number(v) : NaN);
  await new HTMLRewriter()
    .on('div[id^="YouTime"]', {
      element(el) {
        const id = el.getAttribute("id") ?? "";
        cells.push({ id: id.slice("YouTime".length), col: num(el.getAttribute("data-col")), row: num(el.getAttribute("data-row")), time: num(el.getAttribute("data-time")) });
      },
    })
    .transform(new Response(html))
    .text();
  return cells;
}

/**
 * The event's structure from its page, or an AppError: W2M_NOT_FOUND for the
 * missing-event page, W2M_PARSE for anything that doesn't match the GET spec.
 * Never returns a partly parsed event.
 */
export async function parseEventPage(id: string, html: string): Promise<W2mEvent> {
  // §3.1 slot list
  const found = [...html.matchAll(/TimeOfSlot\[(\d+)\]=(\d+);/g)];
  if (!found.length) {
    if (!html.includes('id="NewEventNameDiv"')) throw new AppError("W2M_NOT_FOUND", `when2meet event ${id}: no such event`);
    throw parseError(id, "no slot list");
  }
  const slots: number[] = [];
  for (const [i, m] of found.entries()) {
    if (Number(m[1]) !== i) throw parseError(id, "slot indices out of order");
    const t = Number(m[2]);
    if (i > 0 && t <= slots[i - 1]!) throw parseError(id, "slots not increasing");
    slots.push(t);
  }

  // §3.3 kind: two signals that must agree
  const datesHandler = html.includes('loadTimezoneOptions("ParticipantTimeZone")');
  const weekdaysHandler = /el\.value\s*=\s*"UTC"/.test(html);
  if (datesHandler === weekdaysHandler) throw parseError(id, "event kind unclear");
  const kind = datesHandler ? "dates" : "weekdays";
  if ((slots[0]! < WEEKDAY_EPOCH_LIMIT) !== (kind === "weekdays")) throw parseError(id, "event kind signals disagree");

  // §3.4 zone
  let zone: string | null = null;
  if (kind === "dates") {
    zone = canonicalZone(/select\.value != "([^"]+)"/.exec(html)?.[1]);
    if (!zone) throw parseError(id, "no valid time zone");
  }

  // §3.2 cells: same set as the slots, at the grid rule's positions
  const cells = await readCells(html);
  if (cells.length !== slots.length) throw parseError(id, "cell count differs from slot count");
  const grid = gridFor(slots, zone ?? "UTC");
  const index = new Map(slots.map((t, i) => [t, i]));
  const seen = new Set<number>();
  for (const c of cells) {
    const i = index.get(c.time);
    if (i === undefined || String(c.time) !== c.id || seen.has(c.time)) throw parseError(id, "cells don't match the slots");
    seen.add(c.time);
    const [col, row] = grid.positions[i]!;
    if (c.col !== col || c.row !== row) throw parseError(id, "cells aren't where the grid puts them");
  }

  // §3.6 slot length: one step everywhere within a column, checked against each column's span
  const columns: number[][] = grid.dates.map(() => []);
  slots.forEach((t, i) => columns[grid.positions[i]![0]]!.push(t));
  const rows = columns[0]!.length;
  if (rows < 2) throw parseError(id, "too few slots per day to measure their length");
  const step = columns[0]![1]! - columns[0]![0]!;
  if (step % 60 !== 0 || step < 60 || step > 3600) throw parseError(id, "slot length out of range");
  for (const column of columns) {
    if (column.length !== rows) throw parseError(id, "days have different numbers of slots");
    for (let k = 1; k < column.length; k++) if (column[k]! - column[k - 1]! !== step) throw parseError(id, "uneven slots");
    if ((column[column.length - 1]! - column[0]!) / (rows - 1) !== step) throw parseError(id, "slot span disagrees with slot step");
  }

  // §3.9 fill contract
  const fill = FILL_MARKERS.every((m) => html.includes(m)) ? "ok" : "drift";
  return { id, kind, zone, slots, slotSeconds: step, fill };
}

// ---------------------------------------------------------------- fetching (GET spec §2)

export type W2mFetch = (url: string) => Promise<Response>;

/** The fetch used in production: one GET, no redirects followed, a plain User-Agent. */
export const fetchW2mPage: W2mFetch = (url) =>
  fetch(url, {
    headers: { "user-agent": "time.mutantcacti.com (+https://time.mutantcacti.com/help)", accept: "text/html" },
    redirect: "manual",
    signal: AbortSignal.timeout(W2M_TIMEOUT_MS),
  });

/** The body as text, or W2M_TOO_LARGE once it passes the limit. */
async function readLimited(id: string, res: Response, limit: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new AppError("W2M_TOO_LARGE", `when2meet event ${id}: page over ${limit} bytes`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** Fetch and parse one event. Errors carry only the event id. */
export async function fetchEvent(ref: W2mRef, fetchPage: W2mFetch, limit = W2M_MAX_BYTES): Promise<W2mEvent> {
  let res: Response;
  try {
    res = await fetchPage(eventUrl(ref));
  } catch (err) {
    throw new AppError("W2M_FETCH", `when2meet event ${ref.id}: fetch failed`, { cause: err });
  }
  if (res.status === 404) {
    await res.body?.cancel();
    throw new AppError("W2M_NOT_FOUND", `when2meet event ${ref.id}: HTTP 404`, { upstreamStatus: 404 });
  }
  if (res.status < 200 || res.status > 299) {
    await res.body?.cancel();
    throw new AppError(`W2M_STATUS_${res.status}`, `when2meet event ${ref.id}: HTTP ${res.status}`, { upstreamStatus: res.status });
  }
  let html: string;
  try {
    html = await readLimited(ref.id, res, limit);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("W2M_FETCH", `when2meet event ${ref.id}: body could not be read`, { cause: err });
  }
  return parseEventPage(ref.id, html);
}

// ---------------------------------------------------------------- cache (W2M-SPEC §1.2)

async function cacheId(ref: W2mRef): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(refParam(ref))));
  return Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface EventLoadOptions {
  fetchPage: W2mFetch;
  cache: Cache;
  /** Base URL for cache keys (never the event address). */
  cacheBase: string;
  waitUntil: (p: Promise<unknown>) => void;
}

/** The parsed event, from the Cache API copy if it's recent, otherwise fetched. Only the structure is cached. */
export async function loadEvent(ref: W2mRef, opts: EventLoadOptions): Promise<W2mEvent> {
  const key = `${opts.cacheBase}/${await cacheId(ref)}`;
  const hit = await opts.cache.match(key);
  if (hit) {
    try {
      const saved = (await hit.json()) as W2mEvent;
      if (saved.id === ref.id && Array.isArray(saved.slots)) return saved;
    } catch {
      // A bad copy is ignored.
    }
  }
  const event = await fetchEvent(ref, opts.fetchPage);
  const copy = new Response(JSON.stringify(event), {
    headers: { "content-type": "application/json", "cache-control": `max-age=${W2M_CACHE_SECONDS}` },
  });
  opts.waitUntil(opts.cache.put(key, copy));
  return event;
}
