import type { Child } from "hono/jsx";
import { RANGE_CAP_DAYS } from "../config";
import type { Links } from "../links";
import type { ViewParams } from "../state";
import { ColourBar } from "./calendar";
import { LiveRegions, type Notice, InlineNotice, NoticeLayer } from "./notices";
import { ContactContent, DownloadContent, type DownloadProps } from "./panels";
import { Document, pageTitle } from "./layout";
import { SubHeader, TopBar, type TopBarProps } from "./topbar";

export interface CalendarPageProps {
  title: string;
  topbar: TopBarProps;
  sticky: Notice[];
  /** Transient notices shown inline above the calendar (Range ones go in the form). */
  inline: Notice[];
  rangeForm: Child;
  body: Child;
  showColourBar: boolean;
  download: DownloadProps;
}

export function CalendarPage(p: CalendarPageProps) {
  return (
    <Document title={p.title} bodyClass="page-calendar">
      {/* PRINTED OUTPUT: calendar / skip link */}
      <a class="skip-link" href="#main">Skip to calendar</a>
      <TopBar {...p.topbar} />
      <main class="main" id="main">
        {/* PRINTED OUTPUT: calendar / region name */}
        <section class="cal-wrap" aria-label="Calendar">
          <NoticeLayer sticky={p.sticky} />
          {p.inline.map((n) => (
            <InlineNotice notice={n} />
          ))}
          {p.rangeForm}
          {p.body}
        </section>
        {p.showColourBar ? <ColourBar /> : null}
      </main>
      <dialog class="dialog" id="dlg-download" aria-labelledby="dlg-download-title">
        {/* PRINTED OUTPUT: download dialog / title and buttons */}
        <h2 id="dlg-download-title">Download .ics</h2>
        <DownloadContent {...p.download} />
        <div class="actions">
          <a class="btn btn-primary" href={p.download.downloadHref} download="">
            Download
          </a>
          <button type="button" class="btn" data-close>
            Cancel
          </button>
        </div>
      </dialog>
      <dialog class="dialog" id="dlg-contact" aria-labelledby="dlg-contact-title">
        {/* PRINTED OUTPUT: contact dialog / title and close button */}
        <h2 id="dlg-contact-title">Contact me</h2>
        <ContactContent />
        <div class="actions">
          <button type="button" class="btn" data-close>
            Close
          </button>
        </div>
      </dialog>
      <LiveRegions />
    </Document>
  );
}

interface SubPageProps {
  links: Links;
  here: ViewParams;
  name: string;
  children: Child;
}

function SubPage({ links, here, name, children }: SubPageProps) {
  return (
    <Document title={pageTitle(name)} bodyClass="page-sub">
      <SubHeader links={links} here={here} title={name} />
      <main class="sub-main" id="main">
        {children}
      </main>
      <LiveRegions />
    </Document>
  );
}

export function ContactPage({ links, here }: { links: Links; here: ViewParams }) {
  return (
    // PRINTED OUTPUT: contact page / title
    <SubPage links={links} here={here} name="Contact me">
      <ContactContent />
    </SubPage>
  );
}

export function ExportPage({ links, here, download }: { links: Links; here: ViewParams; download: DownloadProps }) {
  return (
    // PRINTED OUTPUT: export page / title
    <SubPage links={links} here={here} name="Download .ics">
      <DownloadContent {...download} />
      <div class="actions">
        {/* PRINTED OUTPUT: export page / buttons */}
        <a class="btn btn-primary" href={download.downloadHref} download="">
          Download
        </a>
        <a class="btn" href={links.view(here)}>
          Cancel
        </a>
      </div>
    </SubPage>
  );
}

export interface TzOption {
  value: string;
  label: string;
}

export interface TzPageProps {
  links: Links;
  here: ViewParams;
  current: string | null;
  /** The zone "Device default" stands for on this page view. */
  deviceDefault: string;
  /** JS hasn't run, so the device zone is unknown. */
  noDeviceZone: boolean;
  groups: { region: string; options: TzOption[] }[];
}

export function TzPage(p: TzPageProps) {
  return (
    // PRINTED OUTPUT: time zone page / title
    <SubPage links={p.links} here={p.here} name="Time zone">
      <form class="tz-form" method="get" action="/tz">
        <input type="hidden" name="apply" value="1" />
        {Object.entries(p.here).map(([k, v]) => (v ? <input type="hidden" name={k} value={v} /> : null))}
        {p.links.zoneParams.dtz ? <input type="hidden" name="dtz" value={p.links.zoneParams.dtz} /> : null}
        {/* PRINTED OUTPUT: time zone page / field label */}
        <label for="tz-select">Show times in</label>
        <select name="tz" id="tz-select">
          {/* PRINTED OUTPUT: time zone page / device default option */}
          <option value="" selected={!p.current}>
            Device default ({p.deviceDefault})
          </option>
          {p.groups.map((g) => (
            <optgroup label={g.region}>
              {g.options.map((o) => (
                <option value={o.value} selected={o.value === p.current}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {/* PRINTED OUTPUT: time zone page / apply button */}
        <button type="submit" class="btn btn-primary">
          Apply
        </button>
      </form>
      {p.noDeviceZone ? (
        // PRINTED OUTPUT: time zone page / no-JS note
        <p class="note">Your device's time zone isn't known without JavaScript, so Device default means Europe/London.</p>
      ) : null}
    </SubPage>
  );
}

export interface StatusPageProps {
  title: string;
  message: string;
  homeHref: string;
}

/** 404 and 405 pages. */
export function StatusPage({ title, message, homeHref }: StatusPageProps) {
  return (
    <Document title={pageTitle(title)} bodyClass="page-sub">
      <main class="sub-main" id="main">
        <h1>{title}</h1>
        <p>{message}</p>
        <p>
          {/* PRINTED OUTPUT: status page / home link */}
          <a href={homeHref}>Go to the calendar</a>
        </p>
      </main>
    </Document>
  );
}

export function HelpPage({ links, here }: { links: Links; here: ViewParams }) {
  return (
    // PRINTED OUTPUT: help / page title
    <SubPage links={links} here={here} name="Help">
      <article class="help">
        {/* Template copy: Maxence will rewrite this page. Keep one marker per section. */}
        <section aria-labelledby="help-what">
          {/* PRINTED OUTPUT: help / what time. is */}
          <h2 id="help-what">What time. is</h2>
          <p>A read-only view of when Maxence is free or busy. Use it to find a time, then get in touch.</p>
        </section>

        <section aria-labelledby="help-shows">
          {/* PRINTED OUTPUT: help / what it shows and what it hides */}
          <h2 id="help-shows">What it shows and what it hides</h2>
          <p>It shows when time is busy. It never shows what the time is for.</p>
          <ul>
            <li>Shown: busy and free time.</li>
            <li>Hidden: titles, descriptions, places and people.</li>
          </ul>
        </section>

        <section aria-labelledby="help-colour">
          {/* PRINTED OUTPUT: help / reading the colour and the dither */}
          <h2 id="help-colour">Reading the colour and the dots</h2>
          <p>Each cell shows how much of its time is busy.</p>
          <ul>
            <li>Colour runs from dark blue (free) to yellow (busy), as on the colour bar.</li>
            <li>Dots get denser as a cell gets busier. A fully busy cell still shows some colour between the dots.</li>
            <li>Each cell's label gives the exact amount, for example "50% busy".</li>
          </ul>
        </section>

        <section aria-labelledby="help-views">
          {/* PRINTED OUTPUT: help / views, arrows, Today and Range */}
          <h2 id="help-views">Views and navigation</h2>
          <dl>
            <dt>Day, Week, Month</dt>
            <dd>One day, one week (Monday to Sunday) or one month. In Month, select a day to open it.</dd>
            <dt>Range</dt>
            <dd>Choose a start and end date, then select Apply. Ranges can be up to {RANGE_CAP_DAYS} days.</dd>
            <dt>‹ and ›</dt>
            <dd>Move back or forward by one day, week, month or range.</dd>
            <dt>Today</dt>
            <dd>Go to the period that contains today.</dd>
          </dl>
          <p>Day and Week show the whole day. Scroll to see other hours.</p>
        </section>

        <section aria-labelledby="help-tz">
          {/* PRINTED OUTPUT: help / time zones */}
          <h2 id="help-tz">Time zones</h2>
          <p>Times are shown in your device's time zone, unless the link you opened pins one.</p>
          <ul>
            <li>The label next to the date shows the zone and its offset from UTC.</li>
            <li>"device" means your device's zone. "pinned" means a zone chosen in the link. "default" means Europe/London, used when your device's zone isn't known.</li>
            <li>To choose another zone, select the label.</li>
          </ul>
        </section>

        <section aria-labelledby="help-ics">
          {/* PRINTED OUTPUT: help / the .ics export */}
          <h2 id="help-ics">The .ics export</h2>
          <p>Download .ics saves the busy times you are viewing as a calendar file. It contains busy blocks only, in UTC, so your calendar app shows them in your own zone.</p>
        </section>

        <section aria-labelledby="help-contact">
          {/* PRINTED OUTPUT: help / why there's no booking */}
          <h2 id="help-contact">Why there's no booking button</h2>
          <p>
            This site only shows time. Nothing here sends a message or books a slot. Check a time here, then use{" "}
            <a href={links.href("/contact", here)}>Contact me</a>.
          </p>
        </section>
      </article>
    </SubPage>
  );
}
