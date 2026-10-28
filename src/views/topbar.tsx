import type { Links } from "../links";
import type { Navigation, Period, View, ViewParams, ZoneMode, ZoneState } from "../state";
import { formatOffset, spokenOffset } from "../tz";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon, MenuIcon, MoonIcon, SunIcon, WarningIcon } from "./icons";

export interface ZoneLabel {
  /** What the button shows: the zone name only. */
  text: string;
  /** Offset and mode, shown at the top of the dropdown and on /tz. */
  summary: string;
  /** The button's accessible name. */
  spoken: string;
}

const MODE_MARKER: Record<ZoneMode, string> = {
  // PRINTED OUTPUT: time zone / mode markers
  device: "device",
  pinned: "pinned",
  default: "default",
};

const MODE_SPOKEN: Record<ZoneMode, string> = {
  // PRINTED OUTPUT: time zone / mode, spoken
  device: "device default",
  pinned: "pinned",
  default: "site default",
};

/** The zone selector's text, its summary ("Europe/London · UTC+1 → UTC+0 · device") and accessible name. */
export function zoneLabel(zone: ZoneState, offsets: [number, number]): ZoneLabel {
  const [a, b] = offsets;
  const short = a === b ? formatOffset(a) : `${formatOffset(a)} → ${formatOffset(b)}`; // PRINTED OUTPUT: time zone / offsets, one or two
  const spoken = a === b ? spokenOffset(a) : `${spokenOffset(a)} changing to ${spokenOffset(b)}`; // PRINTED OUTPUT: time zone / offsets, spoken
  return {
    text: zone.zone,
    summary: `${zone.zone} · ${short} · ${MODE_MARKER[zone.mode]}`, // PRINTED OUTPUT: time zone / summary in dropdown and on /tz
    spoken: `Time zone: ${zone.zone}, ${spoken}, ${MODE_SPOKEN[zone.mode]}. Change`, // PRINTED OUTPUT: time zone / button accessible name
  };
}

const TAB_LABELS: Record<View, string> = {
  // PRINTED OUTPUT: topbar / view tabs
  day: "Day",
  week: "Week",
  month: "Month",
  range: "Range",
};

const STEP_NAMES: Record<View, { prev: string; next: string }> = {
  // PRINTED OUTPUT: topbar / arrow accessible names
  day: { prev: "Previous day", next: "Next day" },
  week: { prev: "Previous week", next: "Next week" },
  month: { prev: "Previous month", next: "Next month" },
  range: { prev: "Previous range", next: "Next range" },
};

export interface TopBarProps {
  links: Links;
  period: Period;
  nav: Navigation;
  tabs: Record<View, ViewParams>;
  /** Visible label: months and year only. */
  periodLabel: string;
  /** Accessible label: the full dates. */
  periodFull: string;
  zone: ZoneLabel;
  /** Current view parameters, carried to Help, Contact, Download and /tz. */
  here: ViewParams;
  exportParams: Record<string, string>;
}

export function TopBar(p: TopBarProps) {
  const steps = STEP_NAMES[p.period.view];
  return (
    <header class="topbar" id="topbar">
      {/* PRINTED OUTPUT: topbar / view tabs group name */}
      <nav class="tb-tabs" data-tb="tabs" aria-label="View">
        {(Object.keys(TAB_LABELS) as View[]).map((view) => (
          <a class="tab" href={p.links.view(p.tabs[view])} aria-current={view === p.period.view ? "page" : undefined}>
            {TAB_LABELS[view]}
          </a>
        ))}
      </nav>
      {/* Always clickable. When the period already contains now it's a no-op (JS stops the click). */}
      <a class="pill tb-today" data-tb="today" href={p.links.view(p.nav.today)} data-noop={p.nav.todayDisabled ? "" : undefined}>
        {/* PRINTED OUTPUT: topbar / today button */}
        Today
      </a>
      <a class="pill round tb-prev" data-tb="prev" href={p.links.view(p.nav.prev)} aria-label={steps.prev} rel="prev">
        <ChevronLeftIcon />
      </a>
      <a class="pill round tb-next" data-tb="next" href={p.links.view(p.nav.next)} aria-label={steps.next} rel="next">
        <ChevronRightIcon />
      </a>
      <h1 class="period-label" data-tb="period">
        <span aria-hidden="true">{p.periodLabel}</span>
        <span class="sr-only">{p.periodFull}</span>
      </h1>
      <a
        class="pill tz-button"
        id="tz-button"
        data-tb="tz"
        href={p.links.href("/tz", p.here)}
        aria-label={p.zone.spoken}
        aria-haspopup="listbox"
        aria-expanded="false"
        data-summary={p.zone.summary}
      >
        <span class="tz-text">{p.zone.text}</span>
        <ChevronDownIcon />
      </a>
      {/* PRINTED OUTPUT: topbar / notice indicator accessible name */}
      <button type="button" class="pill round tb-indicator" id="notice-indicator" data-tb="indicator" hidden aria-label="Show notice">
        <WarningIcon />
      </button>
      {/* PRINTED OUTPUT: topbar / menu button accessible name */}
      <button type="button" class="pill round tb-menu" popovertarget="tb-menu-items" aria-label="Menu">
        <MenuIcon />
      </button>
      <div class="tb-menu-items" id="tb-menu-items" popover="auto">
        {/* PRINTED OUTPUT: topbar / download, contact, help */}
        <a class="pill" data-tb="download" data-dialog="dlg-download" href={p.links.href("/export", p.exportParams)}>Download .ics</a>
        <a class="pill" data-tb="contact" data-dialog="dlg-contact" href={p.links.href("/contact", p.here)}>Contact me</a>
        <a class="pill" data-tb="help" data-dialog="dlg-help" href={p.links.href("/help", p.here)}>Help</a>
      </div>
      <ThemeButton tb />
    </header>
  );
}

function ThemeButton({ tb }: { tb?: boolean }) {
  return (
    // PRINTED OUTPUT: topbar / theme switcher accessible name (JS updates it)
    <button type="button" class="pill round tb-theme theme-toggle" data-tb={tb ? "theme" : undefined} hidden aria-label="Switch theme">
      <MoonIcon />
      <SunIcon />
    </button>
  );
}

/** Close (×) at the top right of a dialog or a page. On a page it's a link back to the calendar. */
export function CloseControl({ href }: { href?: string }) {
  return href ? (
    // PRINTED OUTPUT: close control / accessible name
    <a class="pill round close" href={href} aria-label="Close">
      <CloseIcon />
    </a>
  ) : (
    // PRINTED OUTPUT: close control / accessible name
    <button type="button" class="pill round close" data-close aria-label="Close">
      <CloseIcon />
    </button>
  );
}

export interface SubHeaderProps {
  links: Links;
  here: ViewParams;
  title: string;
}

/** The header on /help, /contact, /export and /tz: title, theme, and Close at the top right. */
export function SubHeader({ links, here, title }: SubHeaderProps) {
  return (
    <header class="subheader">
      <h1>{title}</h1>
      <ThemeButton />
      <CloseControl href={links.view(here)} />
    </header>
  );
}
