# time.mutantcacti.com — spec

A read-only view of Maxence's free/busy time, in the style of when2meet. People use it to find a slot and then contact them.

One Cloudflare Worker, one secret and one custom domain. It has **no storage and no login**.


---

## 1. Scope

**In scope:**
- one Worker serving `time.mutantcacti.com`;
- the Day, Week, Month and Range views;
- `/help`, the contact panel and the `.ics` export;
- tests and the README.

**Out of scope:** forms that send anything, booking, stored state, accounts, analytics, and every other subdomain.

## 2. Conventions

- **Stack:** TypeScript in strict mode, and [Hono](https://hono.dev) with `hono/jsx`. HTML is rendered on the server, plus one small vanilla JS file.
  - Without JS, every view is **readable and navigable**: tabs, arrows, Today and the Range form are all plain links or GET forms.
  - JS only adds to that: the live current-time line, the date-picker popover, the contact panel as an overlay, and detecting the viewer's device time zone (§5.11).
- **State lives in the URL:**
  - `?view=day|week|month&date=YYYY-MM-DD`
  - `?view=range&from=YYYY-MM-DD&to=YYYY-MM-DD`

  Any link can be shared, and Back works.
- **Styling** uses two layers of tokens in `public/css/tokens.css`:
  - raw values first, then semantic tokens (`--color-bg`, `--color-surface`, `--color-text`, `--color-text-muted`, `--color-border`, `--color-link`, `--color-focus`, `--color-now`, `--color-warning`, `--color-error`);
  - component CSS uses only `var(--…)`;
  - a test fails the build if a hex colour appears anywhere except `tokens.css` and `src/parula.ts`;
  - light and dark mode follow `prefers-color-scheme`, with a manual override from the theme switcher (§5.10);
  - the page chrome is neutral, and the calendar carries the colour.
- **Text standard:** all user-facing text follows the **PRINTED OUTPUT** method (§2.1). This matters most for `/help`. Maxence will rewrite `/help` heavily, so the agent produces a clean, well-structured template rather than final copy.
- **Time:**
  - all calculations use UTC epoch seconds;
  - display uses `Intl.DateTimeFormat` in **the viewer's device time zone** (§5.11);
  - weeks start on **Monday**.
- **Tests:**
  - Vitest with `@cloudflare/vitest-pool-workers`;
  - **tests never fetch the real feed**, only `.ics` fixtures in `test/fixtures/`.
- **Dependencies:** keep them to a minimum.
  - An iCal/RRULE library is acceptable, because recurrence is easy to get wrong.
  - Don't use React or any other UI framework. "shadcn-like" describes the look and behaviour of the date picker, not a dependency.
  - Name and justify every dependency in the README.
- **README** includes a short decisions table with the columns Chosen / Alternatives / Why / Would change my mind. Mark anything not checked against current documentation as **(unverified)**.

### 2.1 The PRINTED OUTPUT method

**Every piece of text a user can see or hear has the marker comment `PRINTED OUTPUT` beside it.** Searching the codebase for `PRINTED OUTPUT` then finds every user-facing string.

- **What counts:**
  - visible copy, headings and button labels;
  - error and notice messages (for example, "may be out of date");
  - `<title>`, `aria-label`, `alt` and `placeholder` attributes, and each cell's accessible label;
  - live-region announcements;
  - text built in the client JS (the copy confirmation, the time-zone label, the download dialog);
  - date and period labels built from templates (for example, "Mon 2 – Sun 8 Nov 2026");
  - the `.ics` file's visible fields (calendar name, "Busy");
  - HTTP error pages (404, 405).
- **Format:** the marker, then a short location tag, in the file's own comment syntax:
  - TS/TSX: `// PRINTED OUTPUT: topbar / today button`
  - JSX: `{/* PRINTED OUTPUT: help / what it hides */}`
  - CSS `content:`: `/* PRINTED OUTPUT: colourbar / busy label */`
- **Placement:** one marker per string, or per tight group (for example, one marker above a small JSX block of four tab labels). Put it on the line above, or at the end of the line.
- **Strings built from parts:** mark the template, not each part.
- **Language:** plain, short and direct. Use the fewest words that are clear ("Device default", not "Use my device's time zone"). No marketing tone, no jokes, no emoji, no exclamation marks, and no filler ("simply", "just", "please note"). Labels are nouns or verbs; messages say what happened and what the visitor can do.
- **Check:** in the PR description, give the output of `grep -rn "PRINTED OUTPUT" src public | wc -l`, and say how you checked for strings you missed (for example, by reviewing every JSX text node and string literal in `src/` and `public/`).

## 3. Data

- **`ICAL_URL`** is a Worker secret holding the secret iCal address of Maxence's calendar. It is never logged and never sent to the browser.
- **Fetching and caching:**
  - fetch the feed on the server and cache it with the Cache API for about 5 minutes;
  - if a fetch fails, serve the last good copy with a "may be out of date" warning (§5.9);
  - if there is no good copy, show the full error panel (§5.9).
- **Expansion:** expand recurrences (RRULE, EXDATE, and overrides by RECURRENCE-ID) across the requested range. Handle all-day events and TZID times.
- **Privacy rule:**
  - only start and end times leave the parser;
  - titles, descriptions, locations, attendees and UIDs never reach any HTML or `.ics` response;
  - a test checks that a fixture event's title appears in no response.
- Ignore `TRANSP:TRANSPARENT` events (marked "free" in the calendar).

## 4. Value per slot

- A slot's value is the **fraction of that slot that is busy**, from 0 to 1.
- **Slot length per view:**
  - Day and Week views use 30-minute slots.
  - In Month view, each day has one value: the busy fraction across the whole day (00:00–24:00).
  - In Range view, the slot length depends on the layout (§5.4).
- **Hours:** every column covers the **full 24 hours**, but only a window of it is visible at once (§5.8).

## 5. Page structure and views

### 5.0 Regions of the main page
The main page (`/`) has three regions, plus a floating notice layer:

1. **Top bar**: fixed at the top of the page.
2. **Calendar**: the Day, Week, Month or Range view, filling the remaining space.
3. **Colour bar**: on the right of the calendar on wide screens; a thin strip directly under the top bar on narrow screens (§6).
4. **Notices** (§5.9): a floating layer anchored just below the top bar (and below the colour-bar strip on narrow screens), overlaying the top of the calendar. It is not a region of the layout and never pushes the calendar down.

### 5.0.1 Top bar: exact order
**Wide screens (one row), left to right:**

| # | Item | Group |
|---|---|---|
| 1 | View tabs: **Day · Week · Month · Range** | left |
| 2 | **Today** | centre |
| 3 | **‹** (previous) | centre |
| 4 | **›** (next) | centre |
| 5 | Period label (for example "Mon 2 – Sun 8 Nov 2026"), followed by the **time-zone selector**, which is always visible (§5.11) | centre |
| 6 | Notice indicator: appears only while a sticky notice is minimised (§5.9) | right |
| 7 | **Download .ics** | right |
| 8 | **Help** | right |
| 9 | **Contact me** | right |
| 10 | Theme switcher: a sun or moon icon, at the far right (§5.10) | right |

**Narrow screens (two rows):**

- **Row 1, left to right:** period label and time-zone label (item 5) · notice indicator (6) · a **menu** button containing Download .ics, Help and Contact me (7–9) · theme switcher (10).
- **Row 2, left to right:** view tabs as a compact segmented control (1) · **Today** (2) · **‹** (3) · **›** (4).

The order of items in the HTML follows the wide-screen table, so keyboard and screen-reader order is the same at every width. Narrow-screen rows are achieved with CSS only.

### 5.1 Day
- A single column of 30-minute rows, wide enough to read comfortably on a phone.

### 5.2 Week
- Seven columns (Monday to Sunday) of 30-minute rows.
- On narrow screens:
  - the time column stays fixed while the days scroll sideways;
  - the page opens scrolled to today.

### 5.3 Month
- A standard month grid: weeks are rows, and Monday to Sunday are columns.
- Each day cell is coloured and dithered by that day's busy fraction.
- Days outside the month are dimmed.
- Clicking a day opens it in the Day view.

### 5.4 Range
- **Picker:** a date picker for start and end that looks like shadcn's calendar, plus an **Apply** button.
  - Nothing updates until Apply is pressed.
  - Without JS, the picker is a GET form with two `<input type="date">` fields.
- **Validation:**
  - if the end date is before the start date, the dates are swapped;
  - ranges are capped at **62 days**;
  - if either date is invalid, fall back to this week.
- **Layout:**
  - ranges of up to 14 days are shown as Week-style columns;
  - longer ranges are shown as Month-style day cells.

### 5.5 Navigation
| Control | Day | Week | Month | Range |
|---|---|---|---|---|
| Today | today | the week containing today | the month containing today | **keep the range's length and move it so it starts today** |
| ‹ / › | previous / next day | previous / next week | previous / next month | shift the whole range back / forward by its own length |

- Today is disabled when the current period already contains the present moment.
- Arrows and Today are links, so they work without JS.

### 5.6 Current time
- In Day, Week and Range column layouts, a clear horizontal line marks the current time across today's column, using `--color-now`.
- In Month view and the Range day-cell layout, today's cell is outlined.
- Server rendering places the line correctly at request time, and JS moves it every minute.
- Slots earlier than now on today's date are slightly dimmed.

### 5.7 Mobile
- **Default view:** Day on narrow screens, Week on wide screens. An explicit `?view=` in the URL always wins.
- **Top bar:** two rows, as in §5.0.1.
- Nothing scrolls the whole page sideways, and the layout stays usable at 360 px wide.

### 5.8 The scrolling time window
Applies to Day, Week and the Range column layout.
- Each column covers 00:00–24:00, inside a vertically scrolling container. Scrolling moves the window through the day; the day labels stay fixed at the top and the time labels move with the rows.
- **Window height:**
  - on desktop, about **12 hours** fits by default (for example, 00:00–12:00);
  - on mobile, use the available height. It may show fewer hours if the rows would otherwise be too small to read or tap (each row at least 24 px tall).
- **Starting position:**
  - when the period contains now, scroll so the current-time line sits about a third of the way down the window;
  - **clamp** the scroll to the column's bounds. Near midnight, the line simply ends up nearer the top (just after 00:00) or the bottom (just before 24:00) instead of the window scrolling past the day;
  - otherwise, start at 08:00.
  - Without JS, each hour row has an anchor (`#h08`), and links land on `#h08` so the window still opens at 08:00.

### 5.9 Status notices and errors
Non-fatal messages appear as **toasts** in the floating notice layer (§5.0): top right on wide screens, full width with a small margin on narrow screens. They overlay the calendar but never block the top bar, and the calendar outside the toast stays usable.

- **Severity:** **warnings** use `--color-warning`; **errors** use `--color-error`. Each toast has an icon as well as colour, so colour isn't the only signal.
- **Two kinds of toast:**

  | Kind | Used for | Behaviour |
  |---|---|---|
  | **Sticky** | a condition that is still true while the page is open (for example, "Showing a saved copy. Times may be out of date.", or a part of the page that failed to load) | Stays until the condition ends. Its button **minimises** it rather than dismissing it: it shrinks to the notice indicator in the top bar (§5.0.1, item 6), shown in the toast's severity colour. Selecting the indicator re-opens the toast. The condition can't be hidden entirely, only minimised. |
  | **Transient** | a one-off event (for example, a failed copy that also shows in the button, or a range that was adjusted: "Range shortened to 62 days.") | Shows for about **6 seconds**, then hides itself. It pauses while hovered or focused, and has a close button. |

- **Stacking:** at most **three** toasts at once, sticky ones above transient ones, errors above warnings. Further transient toasts wait their turn.
- **Announcements:** warnings and transient toasts use a polite live region; errors use an assertive one. Showing a toast never moves keyboard focus.
- **Without JS:** sticky toasts are rendered by the server in the same floating position and simply stay open (no minimise). Transient toasts are not used without JS; their message appears inline where relevant (for example, beside the Range form).
- **Motion:** toasts slide or fade in briefly, and appear without animation under `prefers-reduced-motion`.
- **Fatal errors** (the calendar can't be drawn at all, for example the feed has failed and there's no saved copy, or it can't be parsed):
  - the error **replaces the calendar** in a larger panel, styled with `--color-error`;
  - it has a plain, readable **title** ("The calendar couldn't be loaded") and a short **description** of what that means for the visitor and what they can do (try again later, or use Contact me);
  - it also shows a **debug line** for Maxence: an error **code** naming the category (`FEED_FETCH`, `FEED_STATUS_403`, `FEED_PARSE`, `RANGE_EXPAND`, `INTERNAL`), a short random **reference** and the UTC time. For example: `FEED_FETCH · ref 7K2Q9M · 2026-11-02 14:03Z`;
  - **no stack traces, file paths, library names, URLs or upstream response bodies** are shown;
  - the full details (message, stack, upstream status) are written to the Worker log with the same reference, so `wrangler tail` or Workers Logs finds them by searching the reference;
  - the response status is 503 for feed problems and 500 for anything else.
- The error codes and what each one means are listed in the README.

### 5.10 Theme switcher
- A single icon button at the far right of the top bar (§5.0.1, item 10). It shows a **moon** in light mode (switch to dark) and a **sun** in dark mode (switch to light). Its `aria-label` says what pressing it does ("Switch to dark mode").
- **Default:** follow `prefers-color-scheme`. Once the viewer chooses, the choice is stored in `localStorage` and applied as `data-theme="light"` or `data-theme="dark"` on `<html>`, overriding the system setting.
  - Wrap every `localStorage` read and write in `try/catch`; if storage is unavailable, the toggle still works for that page view.
  - Apply the stored theme with a tiny script in `<head>` **before first paint**, so the page doesn't flash the wrong theme. Because the CSP forbids inline scripts, serve it as its own small file loaded with `<script src>` in `<head>` (not deferred).
- **Tokens:** `tokens.css` defines the light set on `:root`, the dark set under `@media (prefers-color-scheme: dark)` for `:root:not([data-theme="light"])`, and the dark set again under `:root[data-theme="dark"]`.
- Parula and the dither are the same in both themes; only the chrome changes. Check that the dither dots still read against both backgrounds.
- **Without JS:** the button is hidden and the page follows the system setting.

### 5.11 Time zone
- **The calendar is shown in the viewer's device time zone.** Everything that depends on the zone follows it: day boundaries, which column is "today", the current-time line, the hour labels, the period label, Today and the arrows.
- **Two URL parameters, and nothing else.** There is no cookie, no header and nothing stored.

  | Parameter | Meaning | Set by |
  |---|---|---|
  | `dtz` | the viewer's **device** zone | the `<head>` script, always present once JS has run |
  | `tz` | a zone the viewer **chose** | the time-zone selector only |

- **The rule:** the page uses `tz` if it is present and valid, otherwise `dtz` if it is valid, otherwise `Europe/London`. (When `tz` equals `dtz` this gives the same zone either way.)
- **Mode:** **pinned** when `tz` is present and differs from `dtz`; **device** otherwise. The label shows which (see below).

#### Keeping `dtz` correct
1. The small `<head>` script (the same file as the theme script, §5.10) reads `Intl.DateTimeFormat().resolvedOptions().timeZone`.
2. If the URL has no `dtz`, or a `dtz` different from the device's zone (for example, a link shared from someone else's device), it calls `location.replace` with `dtz` set to the device zone and every other parameter kept, including `tz`. This runs before the page paints, and at most **once** per page view (guarded, so a misbehaving zone can't cause a loop).
3. `location.replace` doesn't add a history entry, so Back still works.
4. Every link the server renders (tabs, Today, ‹ ›, the Range form, the time-zone selector, the export link) carries the current `dtz`, and `tz` if present. One helper builds every link, and a test checks that no link drops either parameter.

- **Sharing follows from this:**
  - a link **with `tz`** opens in the zone the sharer chose, for everyone;
  - a link **without `tz`** opens in each recipient's own device zone, because their browser corrects `dtz` on arrival.
- **Privacy:** a shared link reveals the sharer's device zone in `dtz` until the recipient's browser replaces it. Accepted: a time zone is low-risk and already implied by the times shown.
- **Without JS:** `dtz` is never set, so the page uses `tz` if present, otherwise `Europe/London`, and the label says so.

#### The time-zone selector (top bar, item 5)
- The time-zone label is a **button that opens a dropdown** to choose another zone.
- **Label:** always visible, showing the zone, its UTC offset and the mode, for example **"Europe/Paris · UTC+1"** with a small "device" or "pinned" marker.
  - If the visible period crosses a daylight-saving change, show both offsets: "Europe/London · UTC+1 → UTC+0".
  - Its accessible name spells it out ("Time zone: Europe/Paris, UTC plus 1, device default. Change").
- **Dropdown:**
  - a search field at the top, filtering the list as you type;
  - the first option is **"Device default"**, which removes `tz` from the URL;
  - then every IANA zone from `Intl.supportedValuesOf('timeZone')`, each with its current offset, grouped by region;
  - choosing a zone navigates to the current URL with `tz` set (all other parameters kept, including `dtz`). Choosing your own device's zone by name still sets `tz`, so a shared link pins it for others;
  - keyboard-operable: arrow keys move, Enter chooses, Escape closes and returns focus to the button.
- **Without JS:** the button links to `/tz?…`, a plain page with a GET form (a `<select>` of zones with "Device default" first, and an **Apply** button) that returns to the same view with `tz` set or removed. Without JS, "Device default" means Europe/London, and the page says so.
- **Validation:** only zone names that `Intl` accepts are used.
  - An invalid `tz` is ignored, so `dtz` is used, and a transient toast says so ("Unknown time zone. Showing device default.").
  - An invalid `dtz` is ignored; the head script replaces it with the real device zone.
- **Other places:**
  - `/help` explains that times are shown in the visitor's own time zone unless a link pins one, how to read the label, and how to choose another zone.
  - The download dialog states the range in the zone being shown. The export link carries the zone (it's a download, not the page URL). The `.ics` file itself uses UTC times, so calendar apps convert it correctly.
  - The fatal-error debug line stays in UTC.

## 6. Colour, dither and colour bar

- **Colour:** the busy fraction maps through MATLAB's **parula** colormap, from low to high. Store it as a fixed lookup table in `src/parula.ts`.
- **Dither:**
  - the same fraction drives an **ordered (Bayer 4×4) dither**, layered over the colour;
  - **the dither never reaches solid.** Even a fully busy cell keeps a visible pattern. Two constants in one place (`src/dither.ts`) set the range:
    - `DITHER_MIN_LEVEL = 0`: a free cell (fraction 0) has no dots;
    - `DITHER_MAX_LEVEL = 12`: a fully busy cell (fraction 1) has 12 of the 16 Bayer cells filled, which is 75% coverage.
  - map the fraction linearly onto that range, `level = round(MIN + fraction × (MAX − MIN))`, and draw each level as a small repeating SVG or CSS pattern;
  - the constants are validated at start-up (`0 ≤ MIN < MAX ≤ 15`), so a later change can't make busy cells solid by accident;
  - Use Bayer rather than Floyd–Steinberg because each cell's pattern depends only on its own value. Error diffusion would spread across neighbouring cells, so a pattern would change whenever a neighbour changed.
  - The dither must stay visible in greyscale, so colour is never the only signal.
- **Accessible labels:** every cell has one, for example "Tue 3 Nov, 14:00–14:30, 50% busy". Cells can be focused with the keyboard and have a visible focus ring.
- **Colour bar:**
  - a vertical bar on the right, showing the parula ramp with the dither over it, using the same capped dither range as the cells;
  - "Busy" at the top and "Free" at the bottom, with no other legend;
  - on narrow screens, it moves to a thin horizontal bar under the top bar, reading "Free" on the left and "Busy" on the right.

## 7. Routes (read-only by design)

| Route | Returns |
|---|---|
| `GET /` | the calendar, using the URL state from §2 |
| `GET /help` | the help template (§8) |
| `GET /contact` | the contact panel as a full page. JS opens the same content as an overlay from the top bar |
| `GET /free-busy.ics?from=&to=` | an iCalendar file of **busy blocks only** (one `VFREEBUSY`, or `VEVENT`s with summary "Busy") for **the range currently being viewed**, under the same privacy rule and the same 62-day cap. Sent with `Content-Disposition: attachment; filename="mutantcacti-busy.ics"` |
| `GET /export?from=&to=` | the no-JS fallback for the download dialog (§7.1) |
| `GET /tz` | the no-JS time-zone picker (§5.11) |
| static assets | CSS, JS, icons |

Any method other than GET or HEAD returns **405**. There are no forms that POST and no stored state.

### 7.1 Download dialog
- A **Download .ics** button in the top bar, near Help, opens a dialog. The dialog:
  - states the exact range that will be exported (for example, "Busy times from Mon 2 Nov to Sun 8 Nov 2026, Europe/London");
  - says the file contains busy blocks only;
  - has **Download** and **Cancel** buttons. Download is a plain link to `/free-busy.ics` with the current range.
- Without JS, the button links to `/export`, a page with the same content.

## 8. Help and contact

**`/help`** is a template with these sections:
- what time. is;
- what it shows and what it hides (busy blocks only, never details);
- how to read the colour and the dither;
- how to use the views, the arrows, Today and Range;
- what the `.ics` export is;
- why there's no booking or send button: you check here, then contact Maxence through any of the channels below.

**Contact me** lists the following:
- Discord (mutantcacti): https://discord.com/users/1129364853157535797
- GitHub: https://github.com/MutantCacti
- Email: `mutantcacti@gmail.com` as a **`mailto:` link, with a Copy button** next to it.
  - Copy uses the Clipboard API.
  - Confirmation happens **in the button itself**: its copy icon turns into a check mark with "Copied" for about 2 seconds, then returns. The button keeps its width, so nothing shifts.
  - Screen readers hear "Copied" through a polite live region.
  - If copying fails, the button shows a short failure state in the same place.
  - Without JS, the Copy button is hidden and the link remains.
- LinkedIn: https://www.linkedin.com/in/moreldierckxm/
- Instagram: https://instagram.com/maxencetmd

External links get `rel="noopener noreferrer"`. Use no third-party icons or scripts; inline SVG icons are fine.

## 9. Headers and deployment

- **Headers:**
  - HSTS;
  - `X-Content-Type-Options: nosniff`;
  - `Referrer-Policy: strict-origin`;
  - a strict CSP, with `self` only and no inline scripts;
  - `frame-ancestors 'none'`;
  - a `Cache-Control` short enough that the calendar is never long out of date.
- **Deployment:** the build session only builds and tests. It does not deploy and has no Cloudflare credentials. Maxence deploys from their own machine.
  - **`mutantcacti.com` is not on Cloudflare yet.** Moving the zone there is part of deployment. Maxence has Cloudflare experience, so the instructions can be concise, but they must be complete.
  - The README's deployment section covers, in order:
    1. **Before moving:** export or record every current DNS record at the existing provider (the apex site, existing subdomains, any MX, TXT and verification records); lower TTLs ahead of time; turn off DNSSEC at the registrar if it's on.
    2. **Add the zone** in Cloudflare and compare the imported records with the export, line by line. Keep existing records **DNS-only (grey cloud)** at first, so nothing else changes behaviour during the move.
    3. **Switch nameservers** at the registrar and wait for the zone to show as active. Check that the existing sites still resolve and serve as before.
    4. **Deploy time.:** `npx wrangler login`, `npx wrangler secret put ICAL_URL`, then `npx wrangler deploy`, with a route `{ pattern = "time.mutantcacti.com", custom_domain = true }` and `workers_dev = false`.
    5. **Verify:** a short checklist (the page loads over HTTPS; headers are present; `/free-busy.ics` downloads as `mutantcacti-busy.ics`; POST returns 405; with the secret temporarily wrong, the error panel shows a code and reference, and the same reference appears in `wrangler tail`).
    6. **Optional afterwards:** re-enable DNSSEC through Cloudflare.
    7. **Rollback:** restore the old nameservers (the existing records are unchanged at the old provider), or delete the Worker's custom domain.

## 10. Open items (ask Maxence before deciding)

None at present. If something comes up that this spec doesn't settle, choose the simplest option that keeps the site read-only and private, and note it in the decisions table.

## 11. Definition of done

- [ ] **Repo:**
  - `wrangler.toml`;
  - `src/`, containing the Hono app, iCal parsing, busy fractions, `parula.ts`, the dither, views and `.ics`;
  - `public/`, `test/` and `README.md`;
  - `.dev.vars.example`, naming `ICAL_URL`.
- [ ] **`npm run dev`** serves the site locally from a fixture feed, with no secret needed.
- [ ] **`npm test` passes**, with tests covering:
  - **Recurrence and expansion:**
    - a weekly recurring event with an EXDATE and one moved instance;
    - an all-day event;
    - an event that crosses midnight;
    - weeks across the **GMT/BST changeovers** (the last Sundays of October and March);
    - an empty calendar;
    - a transparent event, which is ignored.
  - **Feed failures:** a failure with a cached copy, and a failure without one.
  - **Privacy:** no event title in any HTML or `.ics` response.
  - **Views:**
    - Day, Week, Month and Range each render;
    - every row of the §5.5 navigation table works, including Today in Range;
    - Range swaps reversed dates, enforces the cap, and falls back when a date is invalid.
  - **Current time:** the current-time line is rendered only when the period contains now.
  - **Time window:** columns contain all 48 half-hour rows, and the `#h08` anchors exist.
  - **Export:** the `.ics` range matches the viewed range, respects the cap and the privacy rule, uses the filename `mutantcacti-busy.ics`, and `/export` states the range.
  - **Notices and errors:** a stale cache shows the warning notice; a fatal feed failure replaces the calendar with the error panel, returns 503, and shows a code and reference but no stack trace, path, URL or upstream body; the same reference is written to the log.
  - **Scroll clamp:** at 00:15 and 23:45 the starting scroll stays within the column.
  - **Colour and dither:** the busy fraction gives the same Bayer level and parula colour in every view; a fully busy cell is at `DITHER_MAX_LEVEL` and never solid; invalid dither constants are rejected.
  - **Top bar:** the HTML order matches §5.0.1; the notice indicator appears only while a sticky toast is minimised.
  - **Toasts:** a stale cache produces a sticky warning that minimises but can't be dismissed; a transient toast hides itself; no more than three show at once.
  - **Theme:** the stored choice overrides the system setting; the page still renders when `localStorage` throws.
  - **Time zone:**
    - the zone rule: `tz` beats `dtz`, which beats Europe/London; `tz` equal to `dtz` gives the same result;
    - the mode marker is "pinned" only when `tz` is present and differs from `dtz`;
    - every rendered link keeps both `dtz` and `tz` (if present), and never adds `tz` on its own;
    - an invalid `tz` falls back to `dtz` with a toast; an invalid `dtz` falls back to Europe/London;
    - the head-script logic (a unit test of the function it uses) replaces a missing or wrong `dtz`, keeps `tz`, and never replaces twice in one page view;
    - in zones like Pacific/Auckland and America/Los_Angeles, day boundaries, "today", the current-time line and Today/‹ › follow that zone;
    - the label shows both offsets when a period crosses a DST change;
    - no `Set-Cookie` is ever sent;
    - the `/tz` no-JS page sets and removes `tz` correctly; the `.ics` file is in UTC.
  - **Routes:** 405 for POST, PUT and DELETE.
  - **Colour rule:** no hex colours outside the two allowed files.
- [ ] **Without JS:** every view, every navigation control and the Range form work.
- [ ] **Accessibility:** cells can be focused with the keyboard, focus is visible, text contrast meets WCAG AA in both colour modes, and the dither can be read in greyscale.
- [ ] **Small screens:** the site works at 360 px wide with no sideways scrolling of the whole page.
- [ ] **README:**
  - what the site is;
  - how to run it locally;
  - how to deploy, including moving `mutantcacti.com` to Cloudflare, verifying, and rolling back (§9);
  - the error codes and what each means;
  - the decisions table;
  - how to change the window height, the starting hour, the range cap and the colours.
- [ ] **PRINTED OUTPUT:** every user-facing string is marked (§2.1), and the PR description reports the grep count and how missed strings were checked for.
- [ ] Work lands as a **pull request**, not a direct push to `main`.
