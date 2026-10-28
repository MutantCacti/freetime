import { RANGE_CAP_DAYS } from "../config";
import { CloseIcon, ErrorIcon, MinimiseIcon, WarningIcon } from "./icons";

export type Severity = "warning" | "error";

export interface Notice {
  id: string;
  kind: "sticky" | "transient";
  severity: Severity;
  message: string;
}

export const NOTICES = {
  // PRINTED OUTPUT: notices / messages
  stale: "Showing a saved copy. Times may be out of date.",
  unknownZone: "Unknown time zone. Showing device default.",
  rangeSwapped: "Start and end were swapped.",
  rangeCapped: `Range shortened to ${RANGE_CAP_DAYS} days.`,
  rangeInvalid: "Invalid date. Showing this week.",
} as const;

function SeverityIcon({ severity }: { severity: Severity }) {
  return severity === "error" ? <ErrorIcon /> : <WarningIcon />;
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
          <p class="toast-msg">{n.message}</p>
          {/* PRINTED OUTPUT: notices / minimise button accessible name */}
          <button type="button" class="btn btn-icon toast-btn" data-action="minimise" hidden aria-label="Minimise notice">
            <MinimiseIcon />
          </button>
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
    </>
  );
}
