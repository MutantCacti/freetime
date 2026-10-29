// The Hono app. Read-only by design: GET and HEAD only, no forms that post,
// no cookies, no stored state beyond the Cache API copy of the feed.

import { Hono, type Context } from "hono";
import { mergeIntervals } from "./busy";
import { buildColumns, buildDayCells, periodBounds } from "./calendar";
import { DEFAULT_TZ, MAX_FEEDS } from "./config";
import { addDays, parseISODate } from "./dates";
import { AppError, type LogFn, consoleLog, logError, newRef, toAppError } from "./errors";
import { buildBusyIcs, EXPORT_FILENAME, exportEvents } from "./export-ics";
import { type FeedResult, feedUrls, fetchFromUrl, loadFeed } from "./feed";
import { dayLong, exportSpanLabel, monthLabel, periodMonthsLabel, spanLabel } from "./format";
import { expandBusyCached } from "./ical";
import { Links, type MatchParams } from "./links";
import { buildMatchGrid, matchShape, matchSummary, matchWeek, w2mProblem } from "./match";
import {
  type Period,
  type ViewParams,
  type ZoneState,
  navigation,
  normaliseRange,
  paramsFor,
  periodFor,
  resolveZone,
  tabTargets,
  today,
} from "./state";
import { calendarCss, ditherAsset } from "./styles";
import { allZones, formatOffset, offsetSeconds } from "./tz";
import { ColumnGrid, DayCellGrid } from "./views/calendar";
import { pageTitle } from "./views/layout";
import { NOTICES, type Notice } from "./views/notices";
import { CalendarPage, ContactPage, ExportPage, HelpPage, StatusPage, TzPage, type TzOption } from "./views/pages";
import { ErrorPanel, RangeForm } from "./views/panels";
import { MatchGrid } from "./views/match";
import { W2mPage } from "./views/pages";
import { type W2mEvent, type W2mFetch, type W2mRef, eventUrl, fetchW2mPage, loadEvent, parseW2mLink, parseW2mParam, refParam } from "./w2m";
import { zoneLabel } from "./views/topbar";

export interface Env {
  /** One or more secret iCal addresses, separated by spaces, commas or new lines. */
  ICAL_URL?: string;
  ASSETS: Fetcher;
}

export interface AppDeps {
  /** Fetch one upstream feed (an address from ICAL_URL, and its 0-based index). Defaults to fetching it. */
  fetchFeed?: (env: Env, url: string, index: number) => Promise<Response>;
  /** Current time in milliseconds. */
  now?: () => number;
  log?: LogFn;
  /** Cache API key path for the saved feed copy. */
  cachePath?: string;
  /** Fetch one when2meet event page (the rebuilt address). Defaults to fetching it. */
  fetchW2m?: W2mFetch;
  /** Cache API key path for parsed when2meet events. */
  w2mCachePath?: string;
}

type AppContext = Context<{ Bindings: Env }>;

const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
};

/** HTML and .ics: short, so the calendar is never long out of date. */
export const PAGE_CACHE = "private, max-age=60";
const ASSET_CACHE = "public, max-age=3600";

function zoneFrom(c: AppContext): ZoneState {
  return resolveZone(c.req.query("tz"), c.req.query("dtz"));
}

async function sha256Prefix(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

function hereFrom(period: Period): ViewParams {
  return paramsFor(period);
}

export function createApp(deps: AppDeps = {}) {
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? consoleLog;
  const cachePath = deps.cachePath ?? "/__feed-cache/v1";
  const w2mCachePath = deps.w2mCachePath ?? "/__w2m-cache/v1";
  const app = new Hono<{ Bindings: Env }>();

  const nowSec = () => Math.floor(now() / 1000);

  /**
   * Every feed in ICAL_URL, fetched in parallel, each with its own saved copy.
   * If any feed has neither a fresh fetch nor a saved copy, the whole request
   * fails: drawing the others alone would show that feed's busy time as free.
   */
  async function feedFor(c: AppContext): Promise<{ roots: FeedResult["root"][]; stale: FeedResult[] }> {
    const urls = feedUrls(c.env.ICAL_URL);
    if (urls.length > MAX_FEEDS) throw new AppError("FEED_FETCH", `ICAL_URL lists ${urls.length} feeds; the most is ${MAX_FEEDS}`);
    const results = await Promise.all(
      urls.map(async (url, i) => {
        const fetchFeed = deps.fetchFeed ? () => deps.fetchFeed!(c.env, url, i) : fetchFromUrl(url);
        // Each saved copy belongs to one feed address: a changed address never reuses another's copy.
        const feedId = await sha256Prefix(url);
        try {
          const result = await loadFeed({
            fetchFeed,
            nowSec: nowSec(),
            cacheKey: new URL(`${cachePath}/${feedId}`, c.req.url).toString(),
            cache: caches.default,
            waitUntil: (p) => {
              try {
                c.executionCtx.waitUntil(p);
              } catch {
                void p; // no execution context (some tests): let it run
              }
            },
          });
          if (result.problem && urls.length > 1) result.problem.feed = i + 1;
          return result;
        } catch (e) {
          const err = toAppError(e);
          if (urls.length > 1) err.feed = i + 1;
          throw err;
        }
      }),
    );
    return { roots: results.map((r) => r.root), stale: results.filter((r) => r.stale) };
  }

  /** Every busy event from every feed, unmerged. */
  function eventsFrom(roots: FeedResult["root"][], from: number, to: number) {
    try {
      return roots.flatMap((root) => expandBusyCached(root, from, to));
    } catch (err) {
      throw new AppError("RANGE_EXPAND", err instanceof Error ? err.message : "expansion failed", { cause: err });
    }
  }

  /** Busy intervals from every feed, merged, for drawing. */
  function busyFrom(roots: FeedResult["root"][], from: number, to: number) {
    return mergeIntervals(eventsFrom(roots, from, to));
  }

  function waitUntilFor(c: AppContext) {
    return (p: Promise<unknown>) => {
      try {
        c.executionCtx.waitUntil(p);
      } catch {
        void p; // no execution context (some tests): let it run
      }
    };
  }

  /** A when2meet event's structure, cached for a few minutes. */
  function eventFor(c: AppContext, ref: W2mRef): Promise<W2mEvent> {
    return loadEvent(ref, {
      fetchPage: deps.fetchW2m ?? fetchW2mPage,
      cache: caches.default,
      cacheBase: new URL(w2mCachePath, c.req.url).toString(),
      waitUntil: waitUntilFor(c),
    });
  }

  function reportFatal(err: AppError, c: AppContext): string {
    const ref = newRef();
    // Scrub the whole secret and each address in it.
    logError(log, err, ref, [c.env.ICAL_URL, ...feedUrls(c.env.ICAL_URL)]);
    return ref;
  }

  // ------------------------------------------------------------ middleware

  app.use("*", async (c, next) => {
    const method = c.req.method;
    if (method !== "GET" && method !== "HEAD") {
      const links = new Links(zoneFrom(c));
      // PRINTED OUTPUT: 405 page / title and message
      const page = StatusPage({ title: "Method not allowed", message: "This site is read-only.", homeHref: links.view({ view: "week" }) });
      c.res = new Response(`${await page}`, {
        status: 405,
        headers: { "content-type": "text/html; charset=utf-8", allow: "GET, HEAD", "cache-control": "no-store" },
      });
    } else {
      await next();
    }
    const res = new Response(c.res.body, c.res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
    res.headers.delete("set-cookie");
    c.res = res;
  });

  // ------------------------------------------------------------ calendar

  app.get("/", async (c) => {
    const zone = zoneFrom(c);
    let links = new Links(zone);
    const t = nowSec();
    const todayDate = today(t, zone.zone);
    const period = periodFor(
      { view: c.req.query("view"), date: c.req.query("date"), from: c.req.query("from"), to: c.req.query("to") },
      todayDate,
    );
    const here = hereFrom(period);
    const nav = navigation(period, todayDate);
    let label = period.view === "month" ? monthLabel(period.start) : period.view === "day" ? dayLong(period.start) : spanLabel(period.start, period.end);
    let shortLabel = periodMonthsLabel(period.start, period.end);
    let exportSpan = { from: period.start, to: period.end };

    // when2meet match mode (W2M-SPEC.md §1.3): `w2m` replaces the view with the event's grid.
    const w2mRaw = c.req.query("w2m");
    const matchRef = w2mRaw === undefined ? null : parseW2mParam(w2mRaw);
    let inMatch = w2mRaw !== undefined;

    const sticky: Notice[] = [];
    const inline: Notice[] = [];
    const rangeNotices: Notice[] = [];
    if (zone.tzInvalid) inline.push({ id: "tz-unknown", kind: "transient", severity: "warning", message: NOTICES.unknownZone });
    for (const adj of period.adjustments) {
      const message = adj === "swapped" ? NOTICES.rangeSwapped : adj === "capped" ? NOTICES.rangeCapped : NOTICES.rangeInvalid;
      rangeNotices.push({ id: `range-${adj}`, kind: "transient", severity: "warning", message });
    }

    let body;
    let status = 200;
    let showColourBar = true;
    try {
      if (inMatch) {
        if (!matchRef) throw new AppError("W2M_URL", "w2m parameter isn't an event");
        const event = await eventFor(c, matchRef);
        const rawWeek = parseISODate(c.req.query("w2mweek"));
        const week = matchWeek(rawWeek, todayDate);
        const match: MatchParams = { w2m: refParam(matchRef) };
        if (event.kind === "weekdays" && rawWeek) match.w2mweek = week;
        links = links.withMatch(match);
        const shape = matchShape(event, zone.zone, week);
        const feed = await feedFor(c);
        if (feed.stale.length) sticky.push({ id: "stale", kind: "sticky", severity: "warning", message: NOTICES.stale });
        const grid = buildMatchGrid(shape, event.slotSeconds, zone.zone, busyFrom(feed.roots, shape.from, shape.to), t);
        const first = grid.columns[0]!.date;
        const last = grid.columns[grid.columns.length - 1]!.date;
        label = spanLabel(first, last);
        shortLabel = periodMonthsLabel(first, last);
        exportSpan = { from: first, to: last };
        const actions = [
          // PRINTED OUTPUT: match mode / toast, open when2meet
          { label: "Open when2meet", href: eventUrl(matchRef), external: true },
        ];
        if (event.kind === "weekdays") {
          // PRINTED OUTPUT: match mode / toast, week links and their accessible names
          actions.push({ label: "Previous week", href: links.withMatch({ ...match, w2mweek: addDays(week, -7) }).href("/"), external: false });
          actions.push({ label: "Next week", href: links.withMatch({ ...match, w2mweek: addDays(week, 7) }).href("/"), external: false });
        }
        sticky.unshift({
          id: "w2m",
          kind: "sticky",
          severity: "info",
          message: matchSummary(event, grid, zone.zone, week),
          actions,
          // PRINTED OUTPUT: match mode / toast, close accessible name
          close: { href: links.withMatch(null).view(here), label: "Close when2meet match" },
        });
        body = <MatchGrid grid={grid} />;
      } else {
      const feed = await feedFor(c);
      if (feed.stale.length) {
        sticky.push({ id: "stale", kind: "sticky", severity: "warning", message: NOTICES.stale });
        for (const s of feed.stale) {
          log({ level: "warn", code: s.problem?.code, message: "serving saved copy of feed", upstreamStatus: s.problem?.upstreamStatus, feed: s.problem?.feed });
        }
      }
      const gridStart = addDays(period.start, -7);
      const gridEnd = addDays(period.end, 7);
      const bounds = periodBounds(gridStart, gridEnd, zone.zone);
      const merged = busyFrom(feed.roots, bounds.from, bounds.to);
      body =
        period.layout === "columns" ? (
          <ColumnGrid columns={buildColumns(period, zone.zone, merged, t)} />
        ) : (
          <DayCellGrid weeks={buildDayCells(period, zone.zone, merged, t)} links={links} />
        );
      }
    } catch (e) {
      const err = toAppError(e);
      const ref = reportFatal(err, c);
      status = err.status;
      showColourBar = false;
      const w2mError = err.code.startsWith("W2M_");
      if (w2mError) {
        // The match failed: back to the normal calendar controls, without the match.
        inMatch = false;
        links = links.withMatch(null);
      }
      body = w2mError ? (
        // PRINTED OUTPUT: match mode / error panel title
        <ErrorPanel code={err.code} ref={ref} nowSec={t} contactHref={links.href("/contact", here)} title="Unable to match when2meet event" message={w2mProblem(err.code)} />
      ) : (
        <ErrorPanel code={err.code} ref={ref} nowSec={t} contactHref={links.href("/contact", here)} />
      );
    }

    const exportParams = { ...here, from: exportSpan.from, to: exportSpan.to } as Record<string, string>;
    const page = (
      <CalendarPage
        title={pageTitle(label)}
        topbar={{
          links,
          period,
          nav,
          tabs: tabTargets(period, todayDate),
          periodLabel: shortLabel,
          periodFull: label,
          zone: zoneLabel(zone, offsetSeconds(t, zone.zone)),
          here,
          exportParams,
          match: inMatch,
        }}
        sticky={sticky}
        inline={inline}
        rangeForm={period.view === "range" ? <RangeForm links={links} from={period.start} to={period.end} notices={rangeNotices} /> : null}
        body={body}
        showColourBar={showColourBar}
        match={inMatch}
        download={{
          span: exportSpanLabel(exportSpan.from, exportSpan.to),
          zone: zone.zone,
          downloadHref: links.href("/free-busy.ics", { from: exportSpan.from, to: exportSpan.to }),
        }}
      />
    );
    c.header("cache-control", status === 200 ? PAGE_CACHE : "no-store");
    return c.html(page, status as 200);
  });

  // ------------------------------------------------------------ sub-pages

  /** The view a sub-page returns to. */
  function backTo(c: AppContext, zone: ZoneState): ViewParams {
    const todayDate = today(nowSec(), zone.zone);
    const period = periodFor(
      { view: c.req.query("view"), date: c.req.query("date"), from: c.req.query("from"), to: c.req.query("to") },
      todayDate,
    );
    return hereFrom(period);
  }

  app.get("/help", (c) => {
    const zone = zoneFrom(c);
    c.header("cache-control", PAGE_CACHE);
    return c.html(<HelpPage links={new Links(zone)} here={backTo(c, zone)} />);
  });

  app.get("/contact", (c) => {
    const zone = zoneFrom(c);
    c.header("cache-control", PAGE_CACHE);
    return c.html(<ContactPage links={new Links(zone)} here={backTo(c, zone)} />);
  });

  function exportRange(c: AppContext, zone: ZoneState) {
    return normaliseRange(c.req.query("from"), c.req.query("to"), today(nowSec(), zone.zone));
  }

  app.get("/export", (c) => {
    const zone = zoneFrom(c);
    const links = new Links(zone);
    const { from, to } = exportRange(c, zone);
    c.header("cache-control", PAGE_CACHE);
    return c.html(
      <ExportPage
        links={links}
        here={backTo(c, zone)}
        download={{ span: exportSpanLabel(from, to), zone: zone.zone, downloadHref: links.href("/free-busy.ics", { from, to }) }}
      />,
    );
  });

  app.get("/tz", (c) => {
    const zone = zoneFrom(c);
    const links = new Links(zone);
    const here = backTo(c, zone);
    const period = periodFor(
      { view: c.req.query("view"), date: c.req.query("date"), from: c.req.query("from"), to: c.req.query("to") },
      today(nowSec(), zone.zone),
    );
    if (c.req.query("apply")) {
      const chosen = resolveZone(c.req.query("tz"), undefined).tz;
      return c.redirect(links.withTz(here, chosen), 302);
    }
    const t = nowSec();
    const groups = new Map<string, TzOption[]>();
    for (const name of allZones()) {
      const region = name.includes("/") ? name.split("/")[0]! : "Other"; // PRINTED OUTPUT: time zone page / group for zones with no region
      // PRINTED OUTPUT: time zone page / option label
      const option = { value: name, label: `${name} · ${formatOffset(offsetSeconds(t, name))}` };
      groups.set(region, [...(groups.get(region) ?? []), option]);
    }
    c.header("cache-control", PAGE_CACHE);
    return c.html(
      <TzPage
        links={links}
        here={here}
        current={zone.tz}
        deviceDefault={zone.dtz ?? DEFAULT_TZ}
        noDeviceZone={!zone.dtz}
        summary={zoneLabel(zone, offsetSeconds(t, zone.zone)).summary}
        groups={[...groups.entries()].map(([region, options]) => ({ region, options }))}
      />,
    );
  });

  // ------------------------------------------------------------ when2meet

  app.get("/w2m", async (c) => {
    const zone = zoneFrom(c);
    const links = new Links(zone);
    const here = backTo(c, zone);
    const input = c.req.query("url");
    if (input === undefined) {
      c.header("cache-control", PAGE_CACHE);
      return c.html(<W2mPage links={links} here={here} />);
    }
    // Validate before fetching: anything that isn't exactly an event link is refused without a request.
    const ref = parseW2mLink(input);
    if (!ref) {
      // PRINTED OUTPUT: when2meet form / inline error
      const page = <W2mPage links={links} here={here} value={input.slice(0, 200)} error="That isn't a when2meet event link." />;
      return c.html(page, 400, { "cache-control": "no-store" });
    }
    try {
      await eventFor(c, ref);
    } catch (e) {
      const err = toAppError(e);
      const errRef = reportFatal(err, c);
      const panel = (
        // PRINTED OUTPUT: match mode / error panel title
        <ErrorPanel code={err.code} ref={errRef} nowSec={nowSec()} contactHref={links.href("/contact", here)} title="Unable to match when2meet event" message={w2mProblem(err.code)} />
      );
      return c.html(<W2mPage links={links} here={here} value={input.trim()} panel={panel} />, err.status as 404, { "cache-control": "no-store" });
    }
    return c.redirect(links.withMatch({ w2m: refParam(ref) }).href("/"), 302);
  });

  // ------------------------------------------------------------ export

  app.get("/free-busy.ics", async (c) => {
    const zone = zoneFrom(c);
    const { from, to } = exportRange(c, zone);
    const bounds = periodBounds(from, to, zone.zone);
    try {
      const feed = await feedFor(c);
      // Every event as the feeds have it: not merged, not clipped, not rounded to slots.
      const events = exportEvents(eventsFrom(feed.roots, bounds.from, bounds.to), bounds.from, bounds.to);
      const ics = buildBusyIcs(events, nowSec());
      return c.body(ics, 200, {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": `attachment; filename="${EXPORT_FILENAME}"`,
        "cache-control": PAGE_CACHE,
      });
    } catch (e) {
      const err = toAppError(e);
      const ref = reportFatal(err, c);
      const links = new Links(zone);
      // PRINTED OUTPUT: export error / title and message
      const page = StatusPage({ title: "Unable to download", message: `Couldn't load calendar. (${err.code} · ref ${ref})`, homeHref: links.view({ view: "range", from, to }) });
      return c.html(page, err.status, { "cache-control": "no-store" });
    }
  });

  // ------------------------------------------------------------ generated assets

  app.get("/css/calendar.css", (c) =>
    c.body(calendarCss(), 200, { "content-type": "text/css; charset=utf-8", "cache-control": ASSET_CACHE }),
  );

  app.get("/img/dither/:name", (c) => {
    const svg = ditherAsset(c.req.param("name"));
    if (!svg) return c.notFound();
    return c.body(svg, 200, { "content-type": "image/svg+xml", "cache-control": ASSET_CACHE });
  });

  // ------------------------------------------------------------ static files and 404

  app.get("*", async (c) => {
    const res = await c.env.ASSETS.fetch(c.req.raw);
    if (res.status !== 404) {
      const out = new Response(res.body, res);
      out.headers.set("cache-control", ASSET_CACHE);
      return out;
    }
    return c.notFound();
  });

  app.notFound((c) => {
    const links = new Links(zoneFrom(c));
    // PRINTED OUTPUT: 404 page / title and message
    const page = StatusPage({ title: "Page not found", message: "Incorrect address.", homeHref: links.view({ view: "week" }) });
    return c.html(page, 404, { "cache-control": "no-store" });
  });

  app.onError((e, c) => {
    const err = toAppError(e);
    const ref = reportFatal(err, c);
    const links = new Links(zoneFrom(c));
    // PRINTED OUTPUT: 500 page / title and message
    const page = StatusPage({ title: "Something went wrong", message: `An unknown error occurred. Try again. (${err.code} · ref ${ref})`, homeHref: links.view({ view: "week" }) });
    return c.html(page, err.status, { "cache-control": "no-store" });
  });

  return app;
}

