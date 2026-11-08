// The Hono app. Read-only by design: GET and HEAD only, no forms that post,
// no cookies, no stored state beyond the Cache API copy of the feed.

import { Hono, type Context } from "hono";
import { mergeIntervals } from "./busy";
import { renderCalendar } from "./calendar-page";
import { type DayWindow, DAY_WINDOW, checkDayWindow, periodBounds } from "./calendar";
import { DEFAULT_TZ, MAX_FEEDS, SLOT_MINUTES } from "./config";
import { AppError, type LogFn, consoleLog, logError, newRef, toAppError } from "./errors";
import { buildBusyIcs, EXPORT_FILENAME, exportEvents } from "./export-ics";
import { type FeedResult, feedUrls, fetchFromUrl, loadFeed } from "./feed";
import { exportSpanLabel } from "./format";
import { expandBusyCached } from "./ical";
import { Links, PROFILE_BASE_RE } from "./links";
import {
  type Period,
  type ViewParams,
  type ZoneState,
  normaliseRange,
  paramsFor,
  periodFor,
  resolveZone,
  today,
} from "./state";
import { calendarCss, ditherAsset } from "./styles";
import { SECURITY_HEADERS } from "./headers";
import { allZones, formatOffset, offsetSeconds } from "./tz";
import { ContactPage, ExportPage, HelpPage, StatusPage, TzPage, type TzOption } from "./views/pages";
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
  /** The day window, in minutes after midnight. Defaults to DAY_START and DAY_END. */
  dayWindow?: DayWindow;
}

type AppContext = Context<{ Bindings: Env }>;


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
  const window = deps.dayWindow ?? DAY_WINDOW;
  checkDayWindow(window.start, window.end, SLOT_MINUTES);
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
    const { page, status } = await renderCalendar({
      zone,
      links: new Links(zone),
      query: { view: c.req.query("view"), date: c.req.query("date"), from: c.req.query("from"), to: c.req.query("to") },
      nowSec: nowSec(),
      window,
      loadBusy: async (from, to) => {
        const feed = await feedFor(c);
        for (const s of feed.stale) {
          log({ level: "warn", code: s.problem?.code, message: "serving saved copy of feed", upstreamStatus: s.problem?.upstreamStatus, feed: s.problem?.feed });
        }
        return { merged: busyFrom(feed.roots, from, to), stale: feed.stale.length > 0 };
      },
      report: (err) => reportFatal(err, c),
    });
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
    // A profile's calendar (accounts Worker) comes back to itself; anything else comes back here.
    const back = c.req.query("back");
    const links = new Links(zone, back && PROFILE_BASE_RE.test(back) ? back : "/");
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

