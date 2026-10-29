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
  - raw values first, then semantic tokens (`--color-bg`, `--color-surface`, `--color-text`, `--color-text-muted`, `--color-border`, `--color-divider`, `--color-grid`, `--color-link`, `--color-focus`, `--color-now`, `--color-warning`, `--color-error`);
  - `--color-grid` is the calendar's grid lines: the page colour (white) in light mode, a dark neutral in dark mode. `--color-divider` is the subtler line used for the top bar and panels;
  - component CSS uses only `var(--…)`;
  - a test fails the build if a hex colour appears anywhere except `tokens.css` and `src/parula.ts`;
  - dark mode is the default on every browser and device; light mode is only used when the viewer chooses it with the theme switcher (§5.10). `prefers-color-scheme` is not used;
  - the page chrome is neutral, and the calendar carries the colour.
- **Fonts:** Figtree for text, including the period label; Fragment Mono for times (hour labels, column dates and the time-zone label).
  - Both are self-hosted as WOFF2 in `public/fonts/` (Latin and Latin Extended subsets, `font-display: swap`), with their SIL OFL licence files next to them. The two faces used above the fold are preloaded.
  - Fallback stacks: `Figtree, system-ui, sans-serif` and `"Fragment Mono", ui-monospace, monospace`.
  - Tabular figures wherever numbers line up.
- **Favicon:** `public/favicon.svg` (`viewBox="0 0 32 32"`), as supplied by Maxence: two rounded day columns on a dark rounded tile, with busy blocks in the calendar's colours. Its colours are written as `rgb()` so the hex rule holds. A 180 px `apple-touch-icon.png` is exported from it.
- **Text standard:** all user-facing text follows the **PRINTED OUTPUT** method (§2.1). This matters most for `/help`. Maxence will rewrite `/help` heavily, so the agent produces a clean, well-structured template rather than final copy.
- **Time:**
  - all calculations use UTC epoch seconds;
  - display uses `Intl.DateTimeFormat` in **the viewer's device time zone** (§5.11);
  - weeks start on **Monday**.
- **Tests:**
  - Vitest with `@cloudflare/vitest-plugin` (the renamed `@cloudflare/vitest-pool-workers`);
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

- **`ICAL_URL`** is a Worker secret holding the secret iCal addresses of Maxence's calendars: one or more, separated by spaces, commas or new lines (at most 10). The addresses are never logged and never sent to the browser.
- **Several calendars:** each is fetched and cached on its own, and their busy time is merged (overlaps count once). If any calendar has neither a fresh fetch nor a saved copy, the error panel shows for the whole page; drawing the others alone would show its busy time as free. The log names the failing calendar by its position in `ICAL_URL`, never by its address.
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
**Wide screens (one row), left to right,** in three groups: controls on the left, context (items 5 and 6) centred in the bar, pages on the right.

| # | Item | Group | Shape |
|---|---|---|---|
| 1 | View tabs: **Day · Week · Month · Range** | left | segmented control |
| 2 | **Today** | left, directly after the tabs | pill |
| 3 | **‹** (previous): a left chevron icon (a plain 90° angle) | left | pill (round) |
| 4 | **›** (next): a right chevron icon | left | pill (round) |
| 5 | Period label: months and year only (§5.0.2) | centre | text |
| 6 | **Time-zone selector**, always visible (§5.11) | centre, after the label | pill, with chevron |
| 7 | Notice indicator: appears only while a sticky notice is minimised (§5.9) | right | pill (round) |
| 8 | **Download .ics** | right | pill |
| 9 | **Contact me** | right | pill |
| 10 | **Help** | right | pill |
| 11 | Theme switcher: a sun or moon icon (§5.10) | far right | pill (round) |

- "Pill" means `border-radius: 9999px`, with more inline padding than the tabs. The view tabs keep their segmented shape, so the two kinds of control look different.
- **The view tabs never change size.** The active tab is marked by fill and an underline plus `aria-current`; it never changes font weight or anything else that changes its width, so no tab moves when you switch views.

**When the three groups don't fit in one centred row (up to 1160 px wide): two rows.**

- **Row 1:** period label (5) · time-zone selector (6) on the left; the right-hand group (7–11) on the right. On phones (up to 640 px), items 8–10 go into a **menu** button.
- **Row 2, left-aligned:** view tabs as a compact segmented control (1) · **Today** (2) · **‹** (3) · **›** (4). Row 2 fills the width: the tabs share the free space, and every control in it is at least 44 px tall.
- The period label has extra inline padding on narrow screens.

The order of items in the HTML follows the wide-screen table, so keyboard and screen-reader order is the same at every width. Narrow-screen rows are achieved with CSS only.

### 5.0.2 Period label
- Months and year only, since the calendar already shows the dates: one month "Oct 2026"; two or more months "Oct – Nov 2026"; across a year "Dec 2026 – Jan 2027". This applies to every view.
- Its accessible name spells out the full dates ("Mon 26 Oct – Sun 1 Nov 2026").

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
- Clicking a day opens it in the Day view. With a mouse, hovering a day draws a 5 px ring of grid colour inside its edge, over 100 ms, so it looks slightly shrunk. The ring is overlaid on the cell: the cell and its dither pattern never change size. This also applies to Range day cells, and it's instant under `prefers-reduced-motion`.

### 5.4 Range
- **Picker:** a date picker for start and end that looks like shadcn's calendar, plus an **Apply** button.
  - Nothing updates until Apply is pressed.
  - Without JS, the picker is a GET form with two `<input type="date">` fields.
  - The two date fields sit on one line with a single inline "to" between them, and no "From"/"To" labels above, so the form takes little vertical space. Each field's accessible name says which date it is ("Start date", "End date").
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

- Today is always clickable. When the current period already contains the present moment it's a no-op (JS stops the click; without JS it reloads the same period).
- Arrows and Today are links, so they work without JS.

### 5.6 Current time
- In Day, Week and Range column layouts, a clear horizontal line marks the current time across today's column, using `--color-now`.
- Server rendering places the line correctly at request time, and JS moves it every minute.
- **All past time is dimmed**, in every view: every slot and day cell before now, including all days before today (Month and Range day cells too). Dimming is a veil in the page colour over the cell, as for earlier slots today, plus slightly reduced saturation. The slot holding now is split: its part before the line is dimmed, the rest normal, using the same `m0`–`m29` minute classes as the line (no inline styles).
- In Month view and the Range day-cell layout, today's cell is outlined in `--color-now`, in the same style as the current-time line.
- The now line never covers the column headers: the headers stay sticky and above the line, and the line is clipped to the scrolling body.

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
  | **Sticky** | a condition that is still true while the page is open (for example, "Showing a saved copy. Times may be out of date.", or a part of the page that failed to load) | Stays until the condition ends. Its button **minimises** it rather than dismissing it: it shrinks to the notice indicator in the top bar (§5.0.1, item 7), shown in the toast's severity colour. Selecting the indicator re-opens the toast. The condition can't be hidden entirely, only minimised. |
  | **Transient** | a one-off event (for example, a failed copy that also shows in the button, or a range that was adjusted: "Range shortened to 62 days.") | Shows for about **6 seconds**, then hides itself. It pauses while hovered or focused, and has a close button. |

- **Stacking:** at most **three** toasts at once, sticky ones above transient ones, errors above warnings. Further transient toasts wait their turn.
- **Announcements:** warnings and transient toasts use a polite live region; errors use an assertive one. Showing a toast never moves keyboard focus.
- **Without JS:** sticky toasts are rendered by the server in the same floating position and simply stay open (no minimise). Transient toasts are not used without JS; their message appears inline where relevant (for example, beside the Range form).
- **Motion:** toasts follow §5.12: they grow in at the top right and shrink away; a minimised sticky toast shrinks into the notice indicator and grows back out of it.
- **Fatal errors** (the calendar can't be drawn at all, for example the feed has failed and there's no saved copy, or it can't be parsed):
  - the error **replaces the calendar** in a larger panel, styled with `--color-error`;
  - it has a plain, readable **title** ("The calendar couldn't be loaded") and a short **description** of what that means for the visitor and what they can do (try again later, or use Contact me);
  - it also shows a **debug line** for Maxence: an error **code** naming the category (`FEED_FETCH`, `FEED_STATUS_403`, `FEED_PARSE`, `RANGE_EXPAND`, `INTERNAL`), a short random **reference** and the UTC time. For example: `FEED_FETCH · ref 7K2Q9M · 2026-11-02 14:03Z`;
  - **no stack traces, file paths, library names, URLs or upstream response bodies** are shown;
  - the full details (message, stack, upstream status) are written to the Worker log with the same reference, so `wrangler tail` or Workers Logs finds them by searching the reference;
  - the response status is 503 for feed problems and 500 for anything else.
- The error codes and what each one means are listed in the README.

### 5.10 Theme switcher
- A single icon button at the far right of the top bar (§5.0.1, item 11). It shows a **moon** in light mode (switch to dark) and a **sun** in dark mode (switch to light). Its `aria-label` says what pressing it does ("Switch to dark mode").
- **Default:** dark, on every browser and device; the system setting (`prefers-color-scheme`) is ignored. Once the viewer chooses, the choice is stored in `localStorage` and applied as `data-theme="light"` or `data-theme="dark"` on `<html>`.
  - Wrap every `localStorage` read and write in `try/catch`; if storage is unavailable, the toggle still works for that page view.
  - Apply the stored theme with a tiny script in `<head>` **before first paint**, so the page doesn't flash the wrong theme. Because the CSP forbids inline scripts, serve it as its own small file loaded with `<script src>` in `<head>` (not deferred).
- **Tokens:** `tokens.css` defines the dark set on `:root` and the light set under `:root[data-theme="light"]`.
- The dither is the same in both themes. The colours are not: light mode inverts the colour map (§6), so busy cells stay dark against a white page. Check that the dither dots still read in both.
- **Without JS:** the button is hidden and the page is dark.

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

#### The time-zone selector (top bar, item 6)
- The time-zone label is a **button that opens a dropdown** to choose another zone.
- **Label:** always visible, showing only the zone name, for example **"Europe/London"**, with a chevron at every width so it's obviously a control.
  - The UTC offset and the mode ("device", "pinned", or "default" without JS) are in its accessible name ("Time zone: Europe/Paris, UTC plus 1, device default. Change") and at the top of the dropdown ("Europe/Paris · UTC+1 · device").
  - If the visible period crosses a daylight-saving change, the dropdown summary and accessible name show both offsets ("UTC+1 → UTC+0"); the label doesn't.
- **Dropdown:**
  - a search field at the top, filtering the list as you type;
  - the first option is **"Device default"**, which removes `tz` from the URL;
  - then every IANA zone from `Intl.supportedValuesOf('timeZone')`, each with its current offset, grouped by region;
  - choosing a zone navigates to the current URL with `tz` set (all other parameters kept, including `dtz`). Choosing your own device's zone by name still sets `tz`, so a shared link pins it for others;
  - keyboard-operable: arrow keys move, Enter chooses, Escape closes and returns focus to the button.
- **Without JS:** the button links to `/tz?…`, a plain page showing the same summary, with a GET form (a `<select>` of zones with "Device default" first, and an **Apply** button) that returns to the same view with `tz` set or removed. Without JS, "Device default" means Europe/London, and the page says so.
- **Validation:** only zone names that `Intl` accepts are used.
  - An invalid `tz` is ignored, so `dtz` is used, and a transient toast says so ("Unknown time zone. Showing device default.").
  - An invalid `dtz` is ignored; the head script replaces it with the real device zone.
- **Other places:**
  - `/help` explains that times are shown in the visitor's own time zone unless a link pins one, how to read the label, and how to choose another zone.
  - The download dialog states the range in the zone being shown. The export link carries the zone (it's a download, not the page URL). The `.ics` file itself uses UTC times, so calendar apps convert it correctly.
  - The fatal-error debug line stays in UTC.

### 5.11.1 Drag to scroll
- With a mouse on desktop, the calendar (every view) can be clicked and dragged to scroll, as on a touch screen, with a grab cursor.
- A press that moves less than 5 px is still a click, so cells can be focused and Month's day cells still open. The click that ends a drag does nothing.
- On release the calendar glides to a stop, as touch scrolling does; not under `prefers-reduced-motion`.
- Touch and pens keep their native scrolling. Without JS, the calendar scrolls as usual.

### 5.12 Motion
- **One effect: grow from the source.** Anything that appears grows out of the control that opened it (fade, scale from 0.96, a 6 px nudge from that side, with `transform-origin` at the control), and shrinks back into it when it goes. The eye travels from the thing that was clicked.
  - Download, Contact and Help dialogs: from the top right, where their buttons are; the backdrop fades with them.
  - Narrow-screen menu: from the menu button (top right).
  - Time-zone dropdown and date picker: from just under the button that opened them.
  - Toasts: grow in at the top right. Minimising a sticky toast shrinks it into the notice indicator, which then pops in, and focus follows it; restoring grows the toast back out of the indicator.
  - Copy: the label cross-fades in place ("Copied", "Copy failed"); the width never changes.
  - Theme switcher: the sun and moon swap with a quarter turn. **Page colours switch instantly**; they are never animated.
  - The current-time line and the split slot glide to their new place each minute.
  - Hover and press look the same on every control: a quick background change, and a 0.97 scale while pressed.
- **Fast:** entrances 160 ms, exits 110 ms (exits are quicker), hover 100 ms, set once as tokens in `tokens.css`.
- **Plain CSS where possible**, with a little JS so exits also animate where CSS can't (dialog exits in Firefox): JS plays the exit animation, then closes or removes the element. Only `opacity` and transforms animate.
- **Nothing animates across page loads**: navigation (tabs, arrows, Today, the Range form) is a plain page load. Focus rings never animate.
- **`prefers-reduced-motion: reduce` turns all of it off**: every animation and transition is instant, and JS doesn't wait for exits.

## 6. Colour, dither and colour bar

- **Levels:** the busy fraction is quantised into **`LEVELS = 9` steps** (0, 1/8, …, 1), set in one constant. Colour and dither both use the same step. Cell labels still state the real percentage.
- **Colour:** MATLAB's **parula** colormap, toned down slightly. **In dark mode, free is the low (dark purple) end and busy the high (yellow) end; in light mode the map is inverted**, so free is yellow and busy is dark purple. Only the colours change between themes; each step's dither level is the same, and the dot colour (black or white) follows the colour underneath. `src/parula.ts` keeps the original 64-entry table for reference and derives the toned table from it at start-up, through OKLCH:
  - same hue path;
  - chroma scaled by `PALETTE_CHROMA = 0.85`;
  - lightness compressed into `PALETTE_L_MIN = 0.36` … `PALETTE_L_MAX = 0.90`.
  - The calendar's palette is the toned table sampled at the 9 steps.
- **Dither:**
  - the same step drives an **ordered (Bayer 4×4) dither**, layered over the colour;
  - **the dither never reaches solid.** Even a fully busy cell keeps a visible pattern. Two constants in one place (`src/dither.ts`) set the range:
    - `DITHER_MIN_LEVEL = 0`: a free cell (step 0) has no dots;
    - `DITHER_MAX_LEVEL = 12`: a fully busy cell (step 8) has 12 of the 16 Bayer cells filled, which is 75% coverage.
  - map the step linearly onto that range, `level = round(DITHER_MIN_LEVEL + step / (LEVELS − 1) × (DITHER_MAX_LEVEL − DITHER_MIN_LEVEL))`, and draw each level as a small repeating SVG or CSS pattern;
  - the constants are validated at start-up (`0 ≤ MIN < MAX ≤ 15`), so a later change can't make busy cells solid by accident;
  - Use Bayer rather than Floyd–Steinberg because each cell's pattern depends only on its own value. Error diffusion would spread across neighbouring cells, so a pattern would change whenever a neighbour changed.
  - The dither must stay visible in greyscale, so colour is never the only signal; the dot colour (black or white) must contrast with the colour under it at every step.
- **Accessible labels:** every cell has one, for example "Tue 3 Nov, 14:00–14:30, 50% busy". Cells can be focused with the keyboard and have a visible focus ring.
- **Colour bar:**
  - a vertical bar on the right, showing the same 9 steps as the cells as 9 separate bands (not a smooth ramp), each with its dither;
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
- A **Download .ics** button in the top bar opens a dialog. The dialog:
  - states the exact range that will be exported (for example, "Busy times from Mon 2 Nov to Sun 8 Nov 2026, Europe/London");
  - says the file contains busy blocks only;
  - has **Download** and **Cancel** buttons, plus the Close (×) at the top right (§8). Cancel and × do the same thing. Download is a plain link to `/free-busy.ics` with the current range.
- Without JS, the button links to `/export`, a page with the same content.

## 8. Help and contact

**Help** opens as a modal with JS, rendered into the page like Contact and Download. Without JS, the Help link goes to `/help`.

**Close at the top right, everywhere.** Help, Contact and Download, as modals or as pages, all have a Close (×) button at the top right. There are no "back" links. In a modal, Close is aligned with the content, not with the dialog's edge: its right edge lines up with the content's right edge (Download's Cancel button, Contact's Copy buttons).
- On a page, Close is a link back to the calendar with the same view state (view, date or range, `dtz`, `tz`).
- In a modal, Close closes it, and so does Escape. Focus returns to the button that opened it.
- Contact me has no other close control. Download keeps its Cancel button next to Download.

**`/help`** is a template with these sections:
- what time. is;
- what it shows and what it hides (busy blocks only, never details);
- how to read the colour and the dither;
- how to use the views, the arrows, Today and Range;
- what the `.ics` export is;
- why there's no booking or send button: you check here, then contact Maxence through any of the channels below.

**Contact me** lists the following, in this order, with no introductory text above it. Each medium has an icon before its name: Tabler Icons v3.2.0 outline (`mail`, `brand-discord`, `brand-github`, `brand-instagram`, `brand-linkedin`), taken from the tagged release (never `main`) and inlined as SVG. Tabler Icons is MIT licensed; the licence is kept next to the icons in the source.
- Email: `mutantcacti@gmail.com` as a **`mailto:` link**
- Discord (mutantcacti): https://discord.com/users/1129364853157535797
- GitHub: https://github.com/MutantCacti
- Instagram: https://instagram.com/maxencetmd
- LinkedIn: https://www.linkedin.com/in/moreldierckxm/

**Every link has its own Copy button**, aligned to the right of the panel. Copy puts the link on the clipboard (the address, for email).
- Copy uses the Clipboard API.
- Confirmation happens **in the button itself**: its copy icon turns into a check mark with "Copied" for about 2 seconds, then returns. The button keeps its width, so nothing shifts.
- Screen readers hear "Copied" through a polite live region.
- If copying fails, the button shows a short failure state in the same place.
- Without JS, the Copy buttons are hidden and the links remain.

External links get `rel="noopener noreferrer"`. Use no third-party scripts, and load nothing from other origins; icons are inline SVG.

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
  - **Several calendars:** busy time from every feed is merged; each keeps its own saved copy; one feed failing with no copy shows the error panel, and no address reaches the page or the log.
  - **Privacy:** no event title in any HTML or `.ics` response.
  - **Views:**
    - Day, Week, Month and Range each render;
    - every row of the §5.5 navigation table works, including Today in Range; Today is always a link, marked as a no-op when the period contains now;
    - Range swaps reversed dates, enforces the cap, and falls back when a date is invalid.
  - **Current time:** the current-time line is rendered only when the period contains now.
  - **Time window:** columns contain all 48 half-hour rows, and the `#h08` anchors exist.
  - **Export:** the `.ics` range matches the viewed range, respects the cap and the privacy rule, uses the filename `mutantcacti-busy.ics`, and `/export` states the range.
  - **Notices and errors:** a stale cache shows the warning notice; a fatal feed failure replaces the calendar with the error panel, returns 503, and shows a code and reference but no stack trace, path, URL or upstream body; the same reference is written to the log.
  - **Scroll clamp:** at 00:15 and 23:45 the starting scroll stays within the column.
  - **Colour and dither:** the busy fraction gives the same step, Bayer level and palette colour in every view; a fully busy cell is at `DITHER_MAX_LEVEL` and never solid; invalid dither constants are rejected.
  - **Top bar:** the HTML order matches §5.0.1; the notice indicator appears only while a sticky toast is minimised; the rendered tab widths don't depend on which tab is active (no weight or size change on the active tab).
  - **Period label:** one month, two months and across a year, in each view.
  - **Past:** days before today are greyed in Day, Week, Month and Range; the slot holding now is split.
  - **Levels:** busy fractions map to 9 steps, and colour and dither use the same step; the colour bar shows the same 9 bands.
  - **Dialogs:** each one has a top-right Close, and each page's Close link keeps the view state.
  - **Contact:** in the order above, each with its icon; every link has its own Copy button, right-aligned, and there's no text above the list.
  - **Theme colours:** light mode inverts the colour map (free is the yellow end), dark mode doesn't, and each step's dither level is the same in both.
  - **Drag to scroll:** the glide slows down and stops; only the mouse is handled; a grab cursor shows.
  - **Motion:** under `prefers-reduced-motion` every animation and transition is off; only opacity and transforms animate; durations come from the shared tokens; dialogs and toasts grow from the top right.
  - **Layout:** the top bar has the three groups in order; the Range form has one inline "to" and no labels; dialog heads use the body's inline padding.
  - **Fonts:** the font files are served from `self`, and the CSP still has no external origins.
  - **Toasts:** a stale cache produces a sticky warning that minimises but can't be dismissed; a transient toast hides itself; no more than three show at once.
  - **Theme:** dark is the default with no system-preference rules anywhere; a stored light choice applies it; the page still renders when `localStorage` throws.
  - **Time zone:**
    - the zone rule: `tz` beats `dtz`, which beats Europe/London; `tz` equal to `dtz` gives the same result;
    - the mode marker is "pinned" only when `tz` is present and differs from `dtz`;
    - every rendered link keeps both `dtz` and `tz` (if present), and never adds `tz` on its own;
    - an invalid `tz` falls back to `dtz` with a toast; an invalid `dtz` falls back to Europe/London;
    - the head-script logic (a unit test of the function it uses) replaces a missing or wrong `dtz`, keeps `tz`, and never replaces twice in one page view;
    - in zones like Pacific/Auckland and America/Los_Angeles, day boundaries, "today", the current-time line and Today/‹ › follow that zone;
    - the label shows only the zone name; its summary and accessible name show both offsets when a period crosses a DST change;
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
