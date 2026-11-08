// The calendar page (Day, Week, Month, Range), shared by both Workers: the main
// site draws Maxence's feeds, a profile on the accounts Worker draws a user's
// calendars. Each passes its own way of loading busy time.

import type { Child } from "hono/jsx";
import { type DayWindow, buildColumns, buildDayCells, periodBounds } from "./calendar";
import { addDays } from "./dates";
import { type AppError, toAppError } from "./errors";
import { dayLong, exportSpanLabel, monthLabel, periodMonthsLabel, spanLabel } from "./format";
import type { Interval } from "./ical";
import type { Links } from "./links";
import type { PaletteName } from "./parula";
import { type Query, type ZoneState, navigation, paramsFor, periodFor, tabTargets, today } from "./state";
import { offsetSeconds } from "./tz";
import { ColumnGrid, DayCellGrid } from "./views/calendar";
import { pageTitle } from "./views/layout";
import { NOTICES, type Notice } from "./views/notices";
import { CalendarPage } from "./views/pages";
import { ErrorPanel, RangeForm } from "./views/panels";
import { zoneLabel } from "./views/topbar";

export interface CalendarInput {
  zone: ZoneState;
  /** Links for this calendar; `links.base` is its path ("/" or "/u/<id>"). */
  links: Links;
  query: Query;
  nowSec: number;
  window: DayWindow;
  /** Merged busy intervals overlapping [from, to); `stale` when a saved copy had to be used. */
  loadBusy: (from: number, to: number) => Promise<{ merged: Interval[]; stale: boolean }>;
  /** Log a fatal error; returns its reference for the panel. */
  report: (err: AppError) => string;
  /** Profiles: no Download, Contact or Help, and a card above the calendar. */
  profile?: { intro: Child; title: string; palette?: PaletteName };
}

export async function renderCalendar(input: CalendarInput): Promise<{ page: ReturnType<typeof CalendarPage>; status: number }> {
  const { zone, links, nowSec: t, window } = input;
  const todayDate = today(t, zone.zone);
  const period = periodFor(input.query, todayDate);
  const here = paramsFor(period);
  const nav = navigation(period, todayDate);
  const label = period.view === "month" ? monthLabel(period.start) : period.view === "day" ? dayLong(period.start) : spanLabel(period.start, period.end);

  const sticky: Notice[] = [];
  const inline: Notice[] = [];
  const rangeNotices: Notice[] = [];
  if (zone.tzInvalid) inline.push({ id: "tz-unknown", kind: "transient", severity: "warning", message: NOTICES.unknownZone });
  for (const adj of period.adjustments) {
    const message = adj === "swapped" ? NOTICES.rangeSwapped : adj === "capped" ? NOTICES.rangeCapped : NOTICES.rangeInvalid;
    rangeNotices.push({ id: `range-${adj}`, kind: "transient", severity: "warning", message });
  }

  let body: Child;
  let status = 200;
  let showColourBar = true;
  try {
    const bounds = periodBounds(addDays(period.start, -7), addDays(period.end, 7), zone.zone);
    const busy = await input.loadBusy(bounds.from, bounds.to);
    if (busy.stale) sticky.push({ id: "stale", kind: "sticky", severity: "warning", message: NOTICES.stale });
    body =
      period.layout === "columns" ? (
        <ColumnGrid columns={buildColumns(period, zone.zone, busy.merged, t, window)} />
      ) : (
        <DayCellGrid weeks={buildDayCells(period, zone.zone, busy.merged, t, window)} links={links} />
      );
  } catch (e) {
    const err = toAppError(e);
    const ref = input.report(err);
    status = err.status;
    showColourBar = false;
    body = <ErrorPanel code={err.code} ref={ref} nowSec={t} contactHref={links.href("/contact", here)} />;
  }

  const page = (
    <CalendarPage
      title={pageTitle(input.profile ? `${input.profile.title} · ${label}` : label)}
      topbar={{
        links,
        period,
        nav,
        tabs: tabTargets(period, todayDate),
        periodLabel: periodMonthsLabel(period.start, period.end),
        periodFull: label,
        zone: zoneLabel(zone, offsetSeconds(t, zone.zone)),
        here,
        exportParams: { ...here, from: period.start, to: period.end } as Record<string, string>,
        pages: !input.profile,
      }}
      sticky={sticky}
      inline={inline}
      intro={input.profile?.intro}
      palette={input.profile?.palette}
      rangeForm={period.view === "range" ? <RangeForm links={links} from={period.start} to={period.end} notices={rangeNotices} /> : null}
      body={body}
      showColourBar={showColourBar}
      download={{
        span: exportSpanLabel(period.start, period.end),
        zone: zone.zone,
        downloadHref: links.href("/free-busy.ics", { from: period.start, to: period.end }),
      }}
    />
  );
  return { page, status };
}
