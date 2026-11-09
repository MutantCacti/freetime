// The settings modal: the top bar's cog opens it (public/js/app.js), on both
// Workers. Each row is a dropdown that opens in place, or a link to a page or
// dialog. The same rows render inline on /account, the accounts Worker's
// no-JS fallback: there every panel starts open, and app.js folds them.

import type { Child } from "hono/jsx";
import type { Links } from "../links";
import type { PaletteName } from "../parula";
import type { ViewParams } from "../state";
import { CheckIcon, ChevronRightIcon, CloseIcon, CopyIcon } from "./icons";

/** The dialog the cog opens. `children` are the rows (and anything above them). */
export function SettingsDialog({ children }: { children: Child }) {
  return (
    <dialog class="settings" id="dlg-settings" aria-labelledby="dlg-settings-title">
      <div class="settings-head">
        {/* PRINTED OUTPUT: settings / title */}
        <h2 id="dlg-settings-title">Settings</h2>
        {/* PRINTED OUTPUT: settings / close accessible name */}
        <button type="button" class="pill round settings-close" data-settings-close aria-label="Close">
          <CloseIcon />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function Rows({ children }: { children: Child }) {
  return <ul class="rows">{children}</ul>;
}

export interface RowProps {
  /** Unique on the page: the panel's id is `row-<id>`. */
  id: string;
  what: string;
  /** Muted, at the right of the head: a summary of what's inside. */
  value?: Child;
  children: Child;
  /** Extra class on the row. */
  class?: string;
}

/**
 * A dropdown row. Rendered open (so it works without JS); app.js folds every
 * row when it starts, and one tap on the head opens it in place.
 */
export function Row({ id, what, value, children, class: cls }: RowProps) {
  return (
    <li class={cls ? `row ${cls}` : "row"} data-row={id}>
      <button type="button" class="row-head" aria-expanded="true" aria-controls={`row-${id}`}>
        <span class="row-what">{what}</span>
        {value ? <span class="row-value">{value}</span> : null}
        <ChevronRightIcon />
      </button>
      <div class="row-panel" id={`row-${id}`}>
        {children}
      </div>
    </li>
  );
}

/** A row that goes somewhere: a page, or (with `dialog`) the dialog that page has. */
export function LinkRow({ href, what, value, dialog, tb }: { href: string; what: string; value?: string; dialog?: string; tb?: string }) {
  return (
    <li class="row">
      <a class="row-head" href={href} data-dialog={dialog} data-setting={tb}>
        <span class="row-what">{what}</span>
        {value ? <span class="row-value">{value}</span> : null}
        <ChevronRightIcon />
      </a>
    </li>
  );
}

/**
 * Dark | Light: one rounded rectangle split down the middle, each half painted
 * in the map's step-0 colour for that theme (--switch-dark / --switch-light,
 * per [data-palette], tokens.css). The theme not in use tilts towards the
 * middle and greys out. Needs JS, so it starts hidden.
 */
export function ThemeSwitch({ palette = "parula" }: { palette?: PaletteName }) {
  return (
    // PRINTED OUTPUT: theme switch / accessible name (JS updates it)
    <button type="button" class="theme-switch" data-palette={palette} hidden aria-label="Switch theme">
      {/* PRINTED OUTPUT: theme switch / halves */}
      <span class="half h-dark" aria-hidden="true">
        Dark
      </span>
      <span class="half h-light" aria-hidden="true">
        Light
      </span>
    </button>
  );
}

/**
 * Theme: an ordinary dropdown. Its head names what's in use, the mode (JS
 * fills it in) and, where there is one, the map; its panel holds the switch,
 * then anything else (the colour maps, for a signed-in user).
 */
export function ThemeRow({ palette, mapName, children }: { palette?: PaletteName; mapName?: string; children?: Child }) {
  return (
    // PRINTED OUTPUT: settings / theme row name
    <Row
      id="theme"
      what="Theme"
      value={
        <span class="row-values">
          {/* PRINTED OUTPUT: settings / theme mode in use (JS updates it) */}
          <span data-theme-mode>Dark</span>
          {mapName ? <span>{mapName}</span> : null}
        </span>
      }
    >
      <div class="switch-line">
        <ThemeSwitch palette={palette} />
      </div>
      {children}
    </Row>
  );
}

/** The main site's rows: no account is read here, so Account is a plain link. */
export function SiteSettings({ links, here, exportParams }: { links: Links; here: ViewParams; exportParams: Record<string, string> }) {
  return (
    <SettingsDialog>
      <Rows>
        {/* PRINTED OUTPUT: settings / main site rows */}
        <LinkRow href={links.href("/account")} what="Account" tb="account" />
        <ThemeRow />
        <LinkRow href={links.href("/export", exportParams)} what="Download .ics" dialog="dlg-download" tb="download" />
        <LinkRow href={links.href("/contact", here)} what="Contact me" dialog="dlg-contact" tb="contact" />
        <LinkRow href={links.href("/help", here)} what="Help" dialog="dlg-help" tb="help" />
      </Rows>
    </SettingsDialog>
  );
}

/**
 * A profile address as text: the full address without https://. If it doesn't
 * fit it loses characters from the start (CSS: rtl with an ellipsis), so the
 * username always shows; the marks keep "/" and "@" in order.
 */
export function addressText(host: string, path: string): string {
  return `‎${host}${path}‎`;
}

/** The profile link and its icon-only Copy button (the card and the modal's header). */
export function ProfileLink({ host, path, copy }: { host: string; path: string; copy: string }) {
  return (
    <span class="profile-link">
      <a href={path}>{addressText(host, path)}</a>
      <CopyIconButton value={copy} what="profile link" />
    </span>
  );
}

/** Copy, as an icon: the same states as the Copy pill (app.js), named for screen readers. */
export function CopyIconButton({ value, what }: { value: string; what: string }) {
  return (
    // PRINTED OUTPUT: copy icon / accessible name
    <button type="button" class="copy-btn copy-icon" data-copy={value} hidden aria-label={`Copy ${what}`}>
      <span class="copy-state copy-idle">
        <CopyIcon />
      </span>
      <span class="copy-state copy-done" aria-hidden="true">
        <CheckIcon />
        {/* PRINTED OUTPUT: copy icon / done (announced) */}
        <span class="sr-only">Copied</span>
      </span>
      <span class="copy-state copy-fail" aria-hidden="true">
        <CloseIcon />
        {/* PRINTED OUTPUT: copy icon / failed */}
        <span class="sr-only">Copy failed</span>
      </span>
    </button>
  );
}
