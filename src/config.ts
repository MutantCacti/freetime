// Tunable settings in one place. See "Changing settings" in the README.

/** Zone used when the viewer's zone is unknown (no JS), and for all-day and floating events. */
export const DEFAULT_TZ = "Europe/London";

/** Longest range, in days, for the Range view and the .ics export. */
export const RANGE_CAP_DAYS = 62;

/** Ranges up to this many days use Week-style columns; longer ones use day cells. */
export const RANGE_COLUMN_MAX_DAYS = 14;

/** Hour the time window opens at when the period doesn't contain now. */
export const START_HOUR = 8;

/** Slot length in Day, Week and Range column views. */
export const SLOT_MINUTES = 30;

/** How long a fetched feed counts as fresh. */
export const FEED_FRESH_SECONDS = 300;

/** How long the last good copy is kept for use when a fetch fails. */
export const FEED_KEEP_SECONDS = 7 * 24 * 3600;

/** Most calendar feeds ICAL_URL may list (each is one subrequest per refresh). */
export const MAX_FEEDS = 10;

/** Give up on the upstream feed after this long. */
export const FEED_TIMEOUT_MS = 10_000;
