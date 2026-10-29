import type { ErrorCode } from "../errors";
import { debugLine } from "../errors";
import { WithSeps } from "./sep";
import { HOUR_ANCHOR, type Links } from "../links";
import type { Notice } from "./notices";
import { InlineNotice } from "./notices";
import { DiscordIcon, GitHubIcon, InstagramIcon, LinkedInIcon, MailIcon } from "./brand-icons";
import { CalendarIcon, CheckIcon, CopyIcon, ErrorIcon } from "./icons";

export const EMAIL = "mutantcacti@gmail.com";

const EXTERNAL = { rel: "noopener noreferrer" } as const;

interface Channel {
  name: string;
  Icon: typeof MailIcon;
  /** What the link shows. */
  text: string;
  href: string;
  /** What Copy puts on the clipboard: the address for email, the link otherwise. */
  copy: string;
}

const CHANNELS: Channel[] = [
  // PRINTED OUTPUT: contact / channel names and handles
  { name: "Email", Icon: MailIcon, text: EMAIL, href: `mailto:${EMAIL}`, copy: EMAIL },
  { name: "Discord", Icon: DiscordIcon, text: "mutantcacti", href: "https://discord.com/users/1129364853157535797", copy: "https://discord.com/users/1129364853157535797" },
  { name: "GitHub", Icon: GitHubIcon, text: "MutantCacti", href: "https://github.com/MutantCacti", copy: "https://github.com/MutantCacti" },
  { name: "Instagram", Icon: InstagramIcon, text: "maxencetmd", href: "https://instagram.com/maxencetmd", copy: "https://instagram.com/maxencetmd" },
  { name: "LinkedIn", Icon: LinkedInIcon, text: "moreldierckxm", href: "https://www.linkedin.com/in/moreldierckxm/", copy: "https://www.linkedin.com/in/moreldierckxm/" },
];

/** A Copy button that keeps its width as it shows "Copied" or "Copy failed". Hidden without JS. */
function CopyButton({ value, what }: { value: string; what: string }) {
  return (
    // PRINTED OUTPUT: contact / copy button accessible name
    <button type="button" class="btn copy-btn" data-copy={value} hidden aria-label={`Copy ${what}`}>
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
  );
}

/** The contact list, used by /contact and the overlay. Each link has a Copy button, aligned right. */
export function ContactContent() {
  return (
    <dl class="contact-list">
      {CHANNELS.map((c) => (
        <div class="contact-row">
          <dt>
            <c.Icon />
            {c.name}
          </dt>
          <dd>
            <a href={c.href} {...(c.href.startsWith("http") ? EXTERNAL : {})}>
              {c.text}
            </a>
          </dd>
          <dd class="copy-cell">
            {/* PRINTED OUTPUT: contact / copy target names, for example "Copy Discord link" */}
            <CopyButton value={c.copy} what={c.name === "Email" ? "email address" : `${c.name} link`} />
          </dd>
        </div>
      ))}
    </dl>
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
        Download my calendar for the range '{span}', in time zone: {zone}.
      </p>
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
      <h2 id="error-title">Unable to load calendar</h2>
      <p>
        A fatal error occurred.
      </p>
      <p class="debug">
        <code>
          <WithSeps text={debugLine(code, ref, nowSec)} />
        </code>
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
      {/* PRINTED OUTPUT: range form / date field names, the inline "to", and Apply */}
      <input type="date" name="from" id="range-from" value={from} required aria-label="Start date" />
      <span class="range-to" aria-hidden="true">
        to
      </span>
      <input type="date" name="to" id="range-to" value={to} required aria-label="End date" />
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
