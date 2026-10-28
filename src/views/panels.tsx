import type { ErrorCode } from "../errors";
import { debugLine } from "../errors";
import { HOUR_ANCHOR, type Links } from "../links";
import type { Notice } from "./notices";
import { InlineNotice } from "./notices";
import { CalendarIcon, CheckIcon, CopyIcon, ErrorIcon } from "./icons";

export const EMAIL = "mutantcacti@gmail.com";

const EXTERNAL = { rel: "noopener noreferrer" } as const;

/** The contact list, used by /contact and the overlay. */
export function ContactContent() {
  return (
    <>
      {/* PRINTED OUTPUT: contact / intro */}
      <p class="lede">Check a time here, then get in touch through any of these.</p>
      <dl class="contact-list">
        {/* PRINTED OUTPUT: contact / Discord */}
        <dt>Discord</dt>
        <dd>
          <a href="https://discord.com/users/1129364853157535797" {...EXTERNAL}>mutantcacti</a>
        </dd>
        {/* PRINTED OUTPUT: contact / GitHub */}
        <dt>GitHub</dt>
        <dd>
          <a href="https://github.com/MutantCacti" {...EXTERNAL}>MutantCacti</a>
        </dd>
        {/* PRINTED OUTPUT: contact / Email */}
        <dt>Email</dt>
        <dd class="email-row">
          <a href={`mailto:${EMAIL}`}>{EMAIL}</a>
          <button type="button" class="btn copy-btn" data-copy={EMAIL} hidden>
            {/* PRINTED OUTPUT: contact / copy button states */}
            <span class="copy-state copy-idle">
              <CopyIcon /> Copy
            </span>
            <span class="copy-state copy-done" aria-hidden="true">
              <CheckIcon /> Copied
            </span>
            <span class="copy-state copy-fail" aria-hidden="true">
              Copy failed
            </span>
          </button>
        </dd>
        {/* PRINTED OUTPUT: contact / LinkedIn */}
        <dt>LinkedIn</dt>
        <dd>
          <a href="https://www.linkedin.com/in/moreldierckxm/" {...EXTERNAL}>moreldierckxm</a>
        </dd>
        {/* PRINTED OUTPUT: contact / Instagram */}
        <dt>Instagram</dt>
        <dd>
          <a href="https://instagram.com/maxencetmd" {...EXTERNAL}>maxencetmd</a>
        </dd>
      </dl>
    </>
  );
}

export interface DownloadProps {
  /** "Mon 2 Nov to Sun 8 Nov 2026" */
  span: string;
  zone: string;
  downloadHref: string;
}

/** What the export contains, used by /export and the download dialog. */
export function DownloadContent({ span, zone }: DownloadProps) {
  return (
    <>
      {/* PRINTED OUTPUT: download / range and contents */}
      <p class="lede" id="download-range">
        Busy times from {span}, {zone}.
      </p>
      <p>The file contains busy blocks only. No titles or other details.</p>
    </>
  );
}

export interface FatalProps {
  code: ErrorCode;
  ref: string;
  nowSec: number;
  contactHref: string;
}

/** Replaces the calendar when it can't be drawn at all. */
export function ErrorPanel({ code, ref, nowSec, contactHref }: FatalProps) {
  return (
    <section class="error-panel" role="alert" aria-labelledby="error-title">
      <ErrorIcon />
      {/* PRINTED OUTPUT: error panel / title and description */}
      <h2 id="error-title">The calendar couldn't be loaded</h2>
      <p>
        Free and busy times can't be shown right now. Try again later, or <a href={contactHref}>contact me</a> directly.
      </p>
      <p class="debug">
        <code>{debugLine(code, ref, nowSec)}</code>
      </p>
    </section>
  );
}

export interface RangeFormProps {
  links: Links;
  from: string;
  to: string;
  notices: Notice[];
}

/** The Range picker: a GET form; JS adds the calendar popover. */
export function RangeForm({ links, from, to, notices }: RangeFormProps) {
  const zone = links.zoneParams;
  return (
    <form class="range-form" id="range-form" method="get" action={`/#${HOUR_ANCHOR}`}>
      <input type="hidden" name="view" value="range" />
      {/* PRINTED OUTPUT: range form / labels and buttons */}
      <label>
        <span>From</span>
        <input type="date" name="from" id="range-from" value={from} required />
      </label>
      <label>
        <span>To</span>
        <input type="date" name="to" id="range-to" value={to} required />
      </label>
      {/* PRINTED OUTPUT: range form / date-picker button accessible name */}
      <button type="button" class="btn btn-icon" id="range-pick" hidden aria-label="Pick dates on a calendar">
        <CalendarIcon />
      </button>
      <button type="submit" class="btn btn-primary">Apply</button>
      {zone.tz ? <input type="hidden" name="tz" value={zone.tz} /> : null}
      {zone.dtz ? <input type="hidden" name="dtz" value={zone.dtz} /> : null}
      {notices.map((n) => (
        <InlineNotice notice={n} />
      ))}
    </form>
  );
}
