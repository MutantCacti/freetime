import { RANGE_CAP_DAYS } from "../config";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, ErrorIcon, InfoIcon, MinimiseIcon, WarningIcon } from "./icons";

export type Severity = "warning" | "error" | "info";

/** A link shown under a toast's message, as a small pill. */
export interface NoticeAction {
  label: string;
  href: string;
  /** Opens in a new tab. */
  external?: boolean;
  /** Accessible name, when the label alone isn't enough. */
  ariaLabel?: string;
}

export interface Notice {
  id: string;
  kind: "sticky" | "transient";
  severity: Severity;
  message: string;
  actions?: NoticeAction[];
  /** A sticky toast that can be closed: × is a link here, which ends its condition. */
  close?: { href: string; label: string };
}

export const NOTICES = {
  // PRINTED OUTPUT: notices / messages
  stale: "Cached calendar may be out of date.",
  unknownZone: "Time zone unknown, using device default.",
  rangeSwapped: "Range start and end dates had to be swapped.",
  rangeCapped: `Range was shortened to ${RANGE_CAP_DAYS} days.`,
  rangeInvalid: "Invalid date.",
} as const;

function SeverityIcon({ severity }: { severity: Severity }) {
  return severity === "error" ? <ErrorIcon /> : severity === "info" ? <InfoIcon /> : <WarningIcon />;
}

/**
 * Sticky notices, rendered by the server in the floating layer. Without JS
 * they stay open; JS shows the minimise button and runs the queue.
 */
export function NoticeLayer({ sticky }: { sticky: Notice[] }) {
  return (
    <div class="notices" id="notices">
      {sticky.map((n) => (
        <div
          class={`toast toast-${n.severity}`}
          role={n.severity === "error" ? "alert" : "status"}
          data-id={n.id}
          data-kind="sticky"
          data-severity={n.severity}
        >
          <SeverityIcon severity={n.severity} />
          <div class="toast-body">
            <p class="toast-msg">{n.message}</p>
            {n.actions?.length ? (
              <p class="toast-actions">
                {n.actions.map((a) => (
                  <a class="pill toast-action" href={a.href} aria-label={a.ariaLabel} {...(a.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                    {a.label}
                  </a>
                ))}
              </p>
            ) : null}
          </div>
          {/* PRINTED OUTPUT: notices / minimise button accessible name */}
          <button type="button" class="btn btn-icon toast-btn" data-action="minimise" hidden aria-label="Minimise notice">
            <MinimiseIcon />
          </button>
          {n.close ? (
            <a class="btn btn-icon toast-btn" href={n.close.href} aria-label={n.close.label}>
              <CloseIcon />
            </a>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** A transient message shown inline without JS; JS turns it into a toast. */
export function InlineNotice({ notice }: { notice: Notice }) {
  return (
    <p class={`inline-notice inline-${notice.severity}`} data-id={notice.id} data-kind="transient" data-severity={notice.severity}>
      <SeverityIcon severity={notice.severity} />
      <span class="toast-msg">{notice.message}</span>
    </p>
  );
}

/** Live regions and the toast template the client clones. */
export function LiveRegions() {
  return (
    <>
      <div class="sr-only" id="live-polite" aria-live="polite" aria-atomic="true"></div>
      <div class="sr-only" id="live-assertive" aria-live="assertive" aria-atomic="true"></div>
      <template id="toast-template">
        <div class="toast">
          <span class="toast-icon"></span>
          <p class="toast-msg"></p>
          {/* PRINTED OUTPUT: notices / close and minimise accessible names */}
          <button type="button" class="btn btn-icon toast-btn" data-action="close" aria-label="Close notice">
            <CloseIcon />
          </button>
        </div>
      </template>
      <template id="icon-warning">
        <WarningIcon />
      </template>
      <template id="icon-error">
        <ErrorIcon />
      </template>
      <template id="icon-minimise">
        <MinimiseIcon />
      </template>
      <template id="icon-left">
        <ChevronLeftIcon />
      </template>
      <template id="icon-right">
        <ChevronRightIcon />
      </template>
    </>
  );
}
