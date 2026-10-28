import type { Links } from "../links";
import type { Navigation, Period, View, ViewParams, ZoneMode, ZoneState } from "../state";
import { formatOffset, spokenOffset } from "../tz";
import { ChevronDownIcon, MenuIcon, MoonIcon, SunIcon, WarningIcon } from "./icons";

export interface ZoneLabel {
  text: string;
  marker: string;
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

/** "Europe/London · UTC+1 → UTC+0", with its marker and accessible name. */
export function zoneLabel(zone: ZoneState, offsets: [number, number]): ZoneLabel {
  const [a, b] = offsets;
  const short = a === b ? formatOffset(a) : `${formatOffset(a)} → ${formatOffset(b)}`; // PRINTED OUTPUT: time zone / offsets, one or two
  const spoken = a === b ? spokenOffset(a) : `${spokenOffset(a)} changing to ${spokenOffset(b)}`; // PRINTED OUTPUT: time zone / offsets, spoken
  return {
    text: `${zone.zone} · ${short}`, // PRINTED OUTPUT: time zone / label
    marker: MODE_MARKER[zone.mode],
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
  periodLabel: string;
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
          <a
            class="tab"
            href={p.links.view(p.tabs[view])}
            aria-current={view === p.period.view ? "page" : undefined}
          >
            {TAB_LABELS[view]}
          </a>
        ))}
      </nav>
      {p.nav.todayDisabled ? (
        <span class="btn tb-today" data-tb="today" aria-disabled="true">
          {/* PRINTED OUTPUT: topbar / today button */}
          Today
        </span>
      ) : (
        <a class="btn tb-today" data-tb="today" href={p.links.view(p.nav.today)}>
          {/* PRINTED OUTPUT: topbar / today button */}
          Today
        </a>
      )}
      {/* PRINTED OUTPUT: topbar / previous and next glyphs */}
      <a class="btn btn-icon tb-prev" data-tb="prev" href={p.links.view(p.nav.prev)} aria-label={steps.prev} rel="prev">
        ‹
      </a>
      <a class="btn btn-icon tb-next" data-tb="next" href={p.links.view(p.nav.next)} aria-label={steps.next} rel="next">
        ›
      </a>
      <div class="tb-period" data-tb="period">
        <h1 class="period-label">{p.periodLabel}</h1>
        <a
          class="tz-button"
          id="tz-button"
          data-tb="tz"
          href={p.links.href("/tz", p.here)}
          aria-label={p.zone.spoken}
          aria-haspopup="listbox"
          aria-expanded="false"
        >
          <span class="tz-text">{p.zone.text}</span>
          <span class="tz-mode">{p.zone.marker}</span>
          <ChevronDownIcon />
        </a>
      </div>
      {/* PRINTED OUTPUT: topbar / notice indicator accessible name */}
      <button type="button" class="btn btn-icon tb-indicator" id="notice-indicator" data-tb="indicator" hidden aria-label="Show notice">
        <WarningIcon />
      </button>
      {/* PRINTED OUTPUT: topbar / menu button accessible name */}
      <button type="button" class="btn btn-icon tb-menu" popovertarget="tb-menu-items" aria-label="Menu">
        <MenuIcon />
      </button>
      <div class="tb-menu-items" id="tb-menu-items" popover="auto">
        {/* PRINTED OUTPUT: topbar / download, help, contact */}
        <a class="btn" id="open-download" data-tb="download" href={p.links.href("/export", p.exportParams)}>Download .ics</a>
        <a class="btn" data-tb="help" href={p.links.href("/help", p.here)}>Help</a>
        <a class="btn" id="open-contact" data-tb="contact" href={p.links.href("/contact", p.here)}>Contact me</a>
      </div>
      {/* PRINTED OUTPUT: topbar / theme switcher accessible name (JS updates it) */}
      <button type="button" class="btn btn-icon tb-theme" id="theme-toggle" data-tb="theme" hidden aria-label="Switch theme">
        <MoonIcon />
        <SunIcon />
      </button>
    </header>
  );
}

export interface SubHeaderProps {
  links: Links;
  here: ViewParams;
  title: string;
}

/** The simple header on /help, /contact, /export and /tz. */
export function SubHeader({ links, here, title }: SubHeaderProps) {
  return (
    <header class="subheader">
      <a class="btn" href={links.view(here)}>
        {/* PRINTED OUTPUT: subpage / back link */}
        ‹ Calendar
      </a>
      <h1>{title}</h1>
      {/* PRINTED OUTPUT: topbar / theme switcher accessible name (JS updates it) */}
      <button type="button" class="btn btn-icon tb-theme" id="theme-toggle" hidden aria-label="Switch theme">
        <MoonIcon />
        <SunIcon />
      </button>
    </header>
  );
}
