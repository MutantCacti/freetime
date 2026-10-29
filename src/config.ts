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

/** when2meet: give up on an event page after this long. */
export const W2M_TIMEOUT_MS = 10_000;

/** when2meet: largest event page read, in bytes (docs/W2M-GET-SPEC.md §2). */
export const W2M_MAX_BYTES = 8 * 1024 * 1024;

/** when2meet: how long a parsed event is reused before it's fetched again. */
export const W2M_CACHE_SECONDS = 300;

/**
 * when2meet match mode: a slot is busy if busy time overlaps it by more than
 * this many seconds. 0 means any overlap at all makes it busy.
 */
export const W2M_BUSY_THRESHOLD = 0;
