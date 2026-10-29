# time.mutantcacti.com

A read-only view of Maxence's free and busy time, in the style of when2meet. Visitors find a slot here, then get in touch through the contact panel. Nothing on the site sends, books or stores anything.

It's one Cloudflare Worker with one secret (`ICAL_URL`, which can list several calendars) and one custom domain. There's no storage, no login and no cookies. The full spec is in [`TIME-SPEC.md`](TIME-SPEC.md).

- **Views:** Day, Week, Month and Range, plus `/help`, the contact panel (`/contact`) and a busy-only `.ics` export.
- **Rendering:** HTML is rendered on the server, and every view, link and form works without JavaScript. Two small scripts in `public/js/` add the extras.
- **Display:** times are shown in the viewer's device time zone, unless the link pins a zone with `tz`.

## Run it locally

Requires Node 20 or later.

```bash
npm install
```

```bash
npm run dev
```

`npm run dev` serves the site at http://localhost:8787 from the fixture feed `test/fixtures/dev.ics`, so no secret is needed. It uses the `dev` environment in `wrangler.toml`, whose entry point is `src/dev.ts`. The fixture is never part of the production bundle.

To run locally against the real feed, copy `.dev.vars.example` to `.dev.vars`, put the secret iCal address in it, then:

```bash
npm run dev:live
```

Checks:

```bash
npm test
```

```bash
npm run typecheck
```

Tests run inside the Workers runtime (Vitest with `@cloudflare/vitest-plugin`), and they never fetch the real feed. Every test uses the `.ics` fixtures in `test/fixtures/`.

## Layout

| Path | What it is |
|---|---|
| `src/app.tsx` | The Hono app: routes, headers, 405/404 handling, error panel wiring |
| `src/ical.ts` | iCal parsing and recurrence expansion. Only start and end times leave this file |
| `src/busy.ts` | Merging busy intervals and computing busy fractions |
| `src/calendar.ts` | The calendar model: slots, day cells, labels, current-time line |
| `src/state.ts`, `src/links.ts` | URL state, the zone rule, navigation, and the one link builder |
| `src/tz.ts`, `src/dates.ts`, `src/format.ts` | Time-zone arithmetic (Intl only), civil dates, labels |
| `src/feed.ts` | Fetching `ICAL_URL`, the Cache API copy, stale/fatal handling |
| `src/levels.ts` | `LEVELS` (9) and the busy fraction → step mapping |
| `src/parula.ts`, `src/dither.ts`, `src/styles.ts` | Source parula table, the toned palette derived from it, Bayer dither, and the generated `/css/calendar.css` |
| `src/export-ics.ts` | The busy-only `.ics` file |
| `src/views/` | JSX for the top bar, calendar, notices, panels and pages |
| `src/config.ts` | Settings you might change (see below) |
| `public/css/tokens.css` | Design tokens: raw values, then semantic tokens, light and dark |
| `public/css/fonts.css`, `public/fonts/` | Self-hosted Figtree and Fragment Mono (WOFF2) and their OFL licences |
| `public/favicon.svg`, `public/apple-touch-icon.png` | The site icon, and a 180 px export of it |
| `public/css/app.css` | Component styles (tokens only) |
| `public/js/head.js` | Runs before first paint: applies the theme, corrects `dtz` |
| `public/js/app.js` | Toasts, time-zone dropdown, date picker, dialogs, Copy, current-time line, scroll |
| `test/` | Vitest suites, `.ics` fixtures and scrubbed when2meet pages (`test/fixtures/w2m/`) |
| `docs/W2M-GET-SPEC.md` | How to read and fill a when2meet event (for the when2meet add-on) |
| `src/w2m.ts` | when2meet links, fetching, parsing and the grid rule, per the GET spec |
| `src/match.ts`, `src/views/match.tsx` | Match mode: the event's grid in your zone, free or busy, and its toast |

## Dependencies

| Package | Kind | Why |
|---|---|---|
| `hono` | runtime | Router and server-side JSX (`hono/jsx`). The spec names it. Small, with no dependencies, and built for Workers. |
| `ical.js` | runtime | Parses iCal and expands RRULE, RDATE, EXDATE and RECURRENCE-ID overrides. Recurrence is easy to get wrong. This is Mozilla's parser (used by Thunderbird), and it has no dependencies. |
| `wrangler` | dev | Local dev server and deploys. |
| `vitest`, `@cloudflare/vitest-plugin` | dev | Tests that run in the Workers runtime. `@cloudflare/vitest-plugin` is the renamed `@cloudflare/vitest-pool-workers`; moving to it fixed every `npm audit` finding. |
| `typescript`, `@cloudflare/workers-types` | dev | Strict type checking (`npm run typecheck`). |

There's no UI framework, no date library (Intl does all the time-zone work) and no third-party script. Icons are inline SVG. The five contact icons are Tabler Icons v3.2.0 (outline), copied from the tagged release into `src/views/brand-icons.tsx`. Tabler is MIT licensed, and its licence is in `src/views/tabler-icons-LICENSE.txt`.

**Fonts** are files, not packages: Figtree (variable, 300–900) and Fragment Mono 400, Latin and Latin Extended subsets, taken from Fontsource 5.3.0 and committed to `public/fonts/` with their SIL OFL 1.1 licences. They're served from the site itself because the CSP allows `self` only.

`npm audit` reports 0 vulnerabilities, for production and dev dependencies alike.

## Deploy

The build session only builds and tests; it has no Cloudflare credentials. Maxence deploys from their own machine. `mutantcacti.com` isn't on Cloudflare yet, so moving the zone comes first.

### 1. Before moving

1. At the current DNS provider, export the zone file (BIND format, if offered) **and** record every record by hand as a check: the apex (`A`/`AAAA`/`ALIAS`/`CNAME`), `www`, every existing subdomain, all `MX`, all `TXT` (SPF, DKIM, DMARC, site verifications), and any `CAA` and `SRV` records.
2. Lower the TTL of every record to 300 seconds. Do this at least one old TTL ahead of the move (often 24–48 hours).
3. If DNSSEC is on at the registrar, turn it off (remove the DS record). Then wait for the DS record's TTL to pass before changing nameservers, or resolvers will reject the zone.

### 2. Add the zone

1. In the Cloudflare dashboard: **Add a domain** → `mutantcacti.com` → Free plan.
2. Compare the records Cloudflare imported with your export, **line by line**. Add anything missing, and fix any wrong values.
3. Set every existing record to **DNS only (grey cloud)** for now, so nothing changes behaviour during the move.
4. Make sure there's no existing `time` record. The Worker's custom domain creates it.

### 3. Switch nameservers

1. At the registrar, replace the nameservers with the two Cloudflare gives you.
2. Wait until the zone shows **Active** in the dashboard (Cloudflare also emails you).
3. Check that everything still resolves and serves as before:

```bash
dig NS mutantcacti.com +short
```

```bash
dig mutantcacti.com +short
```

```bash
dig MX mutantcacti.com +short
```

Then load the apex site and each existing subdomain in a browser, and send a test email to an address on the domain.

### 4. Deploy time.

`wrangler.toml` already sets `workers_dev = false` and the route `{ pattern = "time.mutantcacti.com", custom_domain = true }`.

```bash
npm ci && npm test
```

```bash
npx wrangler login
```

```bash
npx wrangler secret put ICAL_URL
```

At the prompt, paste the calendar's **secret address in iCal format** (Google Calendar: Settings → the calendar → Integrate calendar). If Wrangler offers to create the Worker because it doesn't exist yet, accept. **(unverified)**

**Several calendars:** paste all their secret addresses on the one line, separated by spaces (commas also work). Busy time from all of them is merged. The most is 10. To add or remove a calendar later, run `npx wrangler secret put ICAL_URL` again with the full new list; the secret is replaced, not appended to.

```bash
npx wrangler deploy
```

### 5. Verify

- [ ] `https://time.mutantcacti.com/` loads over HTTPS with a valid certificate.
- [ ] The headers are present (HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Content-Security-Policy` with `frame-ancestors 'none'`, `Cache-Control`):

```bash
curl -sI https://time.mutantcacti.com/
```

- [ ] `/free-busy.ics` downloads as `mutantcacti-busy.ics`. This command saves it under the server's filename:

```bash
curl -sOJ https://time.mutantcacti.com/free-busy.ics && ls mutantcacti-busy.ics
```

- [ ] POST returns 405:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://time.mutantcacti.com/
```

- [ ] The error path works. Set the secret to a wrong address, for example the real one with a character changed. The saved copy belongs to one `ICAL_URL`, so a wrong one has none to fall back on. In a second terminal, start the log tail:

```bash
npx wrangler secret put ICAL_URL
```

```bash
npx wrangler tail --format pretty
```

  Load the site. The calendar should be replaced by "The calendar couldn't be loaded", with a line like `FEED_STATUS_404 · ref 7K2Q9M · 2026-11-02 14:03Z`, and the same `ref` should appear in the tail output. Then put the correct secret back with `npx wrangler secret put ICAL_URL` and reload.

### 6. Optional afterwards

Re-enable DNSSEC through Cloudflare (**DNS → Settings → Enable DNSSEC**), then add the DS record it shows at the registrar.

### 7. Rollback

- **Whole zone:** put the old nameservers back at the registrar. The records at the old provider were never changed.
- **Just time.:** remove the custom domain under **Workers & Pages → time-mutantcacti → Settings → Domains & Routes**, or delete the Worker with `npx wrangler delete`. Nothing else in the zone depends on it.

## Error codes

When the calendar can't be drawn, the panel shows a code, a short random reference and the UTC time, for example `FEED_FETCH · ref 7K2Q9M · 2026-11-02 14:03Z`. The Worker log has the full details (message, stack, upstream status) under the same `ref`. Search for it in `wrangler tail` or Workers Logs. `ICAL_URL`, and each address in it, is replaced by `[ICAL_URL]` in logs and never reaches the browser.

With several calendars, the log entry also has `feed`: the failing calendar's position in `ICAL_URL` (1 for the first). It's in the log only, never on the page.

| Code | Meaning | Status |
|---|---|---|
| `FEED_FETCH` | A feed couldn't be reached: network error, timeout (10 s), `ICAL_URL` not set, or more than 10 addresses in it. | 503 |
| `FEED_STATUS_<n>` | The feed answered with HTTP status `<n>`, for example `FEED_STATUS_403` (address revoked or wrong) or `FEED_STATUS_404`. The body is never shown or logged. | 503 |
| `FEED_PARSE` | The feed arrived but isn't a usable iCalendar file. | 503 |
| `RANGE_EXPAND` | Expanding recurrences for the requested period failed. | 500 |
| `W2M_URL` | The when2meet link (or the `w2m` parameter) isn't an event link. From the form it's shown next to the field, and nothing is fetched. | 400 |
| `W2M_FETCH` | when2meet couldn't be reached or timed out (10 s). | 503 |
| `W2M_STATUS_<n>` | when2meet answered with status `<n>`, including any redirect. | 503 |
| `W2M_NOT_FOUND` | The event doesn't exist. | 404 |
| `W2M_TOO_LARGE` | The event page is over 8 MiB. | 502 |
| `W2M_PARSE` | The page loaded but doesn't match `docs/W2M-GET-SPEC.md`: **when2meet has changed**. No grid is drawn. | 502 |
| `INTERNAL` | Anything else. | 500 |

when2meet errors are logged with the event id only, never the link or its code.

If a fetch fails but a good copy from the last 7 days is saved, the page still renders from it with a sticky warning ("Showing a saved copy. Times may be out of date."). The log gets a `warn` entry with the code. Each calendar has its own saved copy.

With several calendars, **any one failing with no saved copy shows the error panel** for the whole page. Drawing the others alone would show that calendar's busy time as free.

## Changing settings

| To change | Edit |
|---|---|
| **Window height** (hours visible at once) | `--visible-hours` in `public/css/tokens.css` (default 12). `--row-min` sets the smallest row height (24 px). |
| **Starting hour** (where the window opens when the period doesn't contain now) | `START_HOUR` in `src/config.ts`. The anchors (`#h08`), links and client JS follow it. |
| **Range cap** | `RANGE_CAP_DAYS` in `src/config.ts`. The export, the notice text and `/help` follow it. `RANGE_COLUMN_MAX_DAYS` sets where Range switches from columns to day cells. |
| **Chrome colours** | The raw values at the top of `public/css/tokens.css`. Each semantic token maps onto them for light and dark. `test/colour-rule.test.ts` checks AA contrast for both modes. `--color-grid` (calendar grid lines: white in light mode, dark in dark mode) and `--color-divider` (top bar and panel lines) are there too. |
| **Calendar colours** | `PALETTE_CHROMA`, `PALETTE_L_MIN` and `PALETTE_L_MAX` in `src/parula.ts` tone the source table (`PARULA_SOURCE`). `THEME_PALETTES` there sets which way round each theme uses it (light mode is inverted). The cell CSS is generated from the result. |
| **Number of steps** | `LEVELS` in `src/levels.ts` (9). Colour, dither and the colour bar all follow it. |
| **Past dimming** | `PAST_CHROMA` in `src/parula.ts` (saturation of past cells) and `--color-veil` in `tokens.css` (the veil). |
| **Fonts** | `public/css/fonts.css` (faces) and `--font-sans` / `--font-mono` in `tokens.css` (stacks). Update the two preloads in `src/views/layout.tsx` if the above-the-fold files change. |
| **Dither range** | `DITHER_MIN_LEVEL` and `DITHER_MAX_LEVEL` in `src/dither.ts`. They're checked at start-up (`0 ≤ MIN < MAX ≤ 15`). |
| **Default zone** (no JS, all-day and floating events) | `DEFAULT_TZ` in `src/config.ts`. |
| **Feed freshness** | `FEED_FRESH_SECONDS` and `FEED_KEEP_SECONDS` in `src/config.ts`. |
| **when2meet** | `W2M_TIMEOUT_MS`, `W2M_MAX_BYTES`, `W2M_CACHE_SECONDS` and `W2M_BUSY_THRESHOLD` in `src/config.ts`. Match-mode colours are `--color-w2m-free`, `--color-w2m-busy` and `--color-w2m-hatch` in `tokens.css`; the row height is `--match-row-h`. |

## when2meet match mode

Paste a when2meet event link (top bar → **when2meet**, or `/w2m`) and the calendar becomes that event's grid, as when2meet shows it to you: the same columns and rows in your time zone, each slot **free** or **busy**. The match is carried by `w2m=<id>-<code>` on every link; for a days-of-the-week event, `w2mweek=<Monday>` picks the week. Closing the toast ends it.

**The free/busy rule**, for anything that needs to reproduce it: a slot `[start, start + slot length)` is **busy** if the busy times from `/free-busy.ics` overlap it by more than `W2M_BUSY_THRESHOLD` seconds (0: any overlap at all), and **free** otherwise. Busy times from all feeds are merged first, so overlapping events never count twice.

How the event is read, and what is never read (other people's names and availability), is in `docs/W2M-GET-SPEC.md`. Only the event's structure is cached, for `W2M_CACHE_SECONDS`. `npm run dev` serves the four test events from `test/fixtures/w2m/` under their placeholder links (try `/?w2m=10000002-Test2` or `/?w2m=10000004-Test4`), and fetches any other link from when2meet as production does.

## User-facing text

Every string a visitor can see or hear has a `PRINTED OUTPUT` marker comment beside it (spec §2.1). To find them all:

```bash
grep -rn "PRINTED OUTPUT" src public
```

`/help` (`HelpPage` in `src/views/pages.tsx`) is a template, ready to be rewritten. Each section has its own marker.

## Decisions

Anything not checked against current documentation is marked **(unverified)**.

| Chosen | Alternatives | Why | Would change my mind |
|---|---|---|---|
| `ical.js` for parsing and recurrence | `node-ical`, `rrule` + a hand parser | Handles RRULE, EXDATE, RDATE and RECURRENCE-ID in one place, and has no dependencies. It runs in Workers without Node shims. | Feeds with a recurrence case it gets wrong. |
| Times resolved with `Intl` (TZID → instant), falling back to the feed's VTIMEZONE, then Europe/London for floating times | ical.js's own zone handling only | Google feeds use IANA TZIDs, which Intl knows exactly. Feeds that use VTIMEZONE-only names (Outlook) still work. | A feed whose VTIMEZONE disagrees with Intl. |
| All-day and floating events are read in Europe/London (`DEFAULT_TZ`) | The viewer's zone | An all-day event is a day of Maxence's, not of the viewer's. The parser stays independent of the viewer. | Maxence living in another zone: change `DEFAULT_TZ`. |
| Saved copy: one Cache API entry per feed, keyed by a hash of that feed's address and stamped with its fetch time. It counts as fresh for 5 minutes and is kept 7 days for failures. | Two entries; KV | The spec rules out storage, and the Cache API is a cache. One entry with a timestamp makes "fresh" testable with a fake clock. Keying by feed makes the wrong-secret check in §9 show the error panel. The Cache API is per data centre and doesn't work on `workers.dev` **(unverified)**, which is why the site runs on a custom domain. | Frequent "saved copy" warnings from cold data centres. |
| The feed is validated before it's saved | Save whatever arrives | A broken upstream response never replaces a good copy. | — |
| `FEED_*` → 503; `RANGE_EXPAND` and `INTERNAL` → 500. `FEED_STATUS_<n>` for any non-2xx. | `RANGE_EXPAND` as 503 | Matches "503 for feed problems, 500 for anything else". Expansion failing is a bug here, not the feed being down. | — |
| `.ics` export at the feeds' own precision: one `VEVENT` ("Busy") per event occurrence, unmerged and unclipped; timed events in UTC to the second; all-day events as `VALUE=DATE` dates; an event two feeds share listed once (replacing merged, clipped busy blocks) | Merged busy blocks clipped to the range; one `VFREEBUSY` | Rounding to slots is only for display; a file has no reason to lose precision. Seconds are now kept for zoned times too. All-day events stay all-day so calendar apps show them as such. Still only start and end times. It does reveal where one event ends and the next starts, which merged blocks hid. | Wanting the old privacy of merged blocks: merge in `exportEvents`. |
| Zone names are validated by Intl. Casing is normalised; aliases are kept as given | Intl's canonical name | Intl turns `Asia/Kolkata` into `Asia/Calcutta`. That would rename the viewer's choice and disagree with the browser's name, so the head script would rewrite `dtz` on every page. | — |
| No time-zone "mode" (device, pinned or default) anywhere: not on the button, in its accessible name, in the dropdown or on `/tz` | Showing the mode (review 1) | It isn't needed and added noise in several places; whichever rule picked it, it's just a time zone. The `tz` → `dtz` → Europe/London rule is unchanged. | — |
| Narrow-screen default view: the head script adds `view=day` (at ≤ 640 px, path `/`, no `view`) in the same `location.replace` as `dtz` | Detect on the server; CSS only | The server can't know the width, and one replace keeps the "at most once" rule. An explicit `view` always wins. | — |
| `/tz` without JS: a GET form to `/tz?apply=1…` that redirects (302) to the clean calendar URL | A form straight to `/` | A GET form can't omit an empty field. Without the redirect, "Device default" would leave `tz=` in the URL instead of removing it. It's still read-only. | — |
| Invalid `date` in Day/Week/Month falls back to today silently. Range adjustments (swap, cap, invalid) each show a notice. | A notice for both | The spec only describes Range adjustments, so the other views use the simplest option. | Confused visitors. |
| No inline styles. Cell colours and dither are classes in a generated `/css/calendar.css`, and dither tiles are generated SVGs at `/img/dither/<level><tone>.svg`. | `style=""` attributes; data URIs | The CSP is `self` only, with no `unsafe-inline`. Generating the CSS from `parula.ts` keeps the hex values in one file. | — |
| Dither dots are black or white at 42% opacity, picked per palette step by contrast, and the same in both themes | One dot colour | Dark dots vanish on dark blue and light dots on yellow. A test checks that the dots differ in lightness at every step of the toned palette, so the pattern reads in greyscale. | — |
| Toned palette: OKLCH conversion written out in `src/parula.ts` (about 60 lines). Out-of-gamut colours keep L and h and reduce chroma by bisection. The source table's own lightness range (0.36–0.96) is mapped linearly onto 0.36–0.90 (review 1) | A colour library; CSS `oklch()` | No dependency, and the generated CSS stays plain hex, which every browser renders the same. With the starting constants the change is subtle: lightness drops by at most 0.05, and hues stay within 0.08 rad of the source (tested). | It looking muddy: raise `PALETTE_CHROMA` towards 1 first. |
| Busy fraction → 9 steps by rounding, except that any busy time is at least step 1 and anything short of fully busy is at most step 7 (review 1) | Plain rounding | With plain rounding, a slot with 3 busy minutes would look free and a slot one minute short of full would look fully busy. That's the wrong way round for a page people use to find free time. Labels still give the exact percentage. | Maxence preferring plain rounding. |
| Palette step `s` uses toned-table entry `round(s / 8 × 63)` | Re-deriving 9 colours directly | The review asks for "the toned table sampled at the 9 steps". Ends are exact (steps 0 and 8 are the table's first and last entries). | — |
| Fonts from Fontsource 5.3.0: Figtree **variable** (one file per subset, weights 300–900) and Fragment Mono 400 (review 1) | Static Figtree weights | One file covers every weight used (400, 600), so preloading one Figtree file is enough. Fragment Mono only comes in 400. | — |
| Fonts preloaded: Figtree Latin and Fragment Mono Latin (the Latin Extended files load only if a character needs them) | Preload all four | Those are the two faces above the fold for English text. | Non-Latin zone names becoming common. |
| Fragment Mono for hour labels, column dates, the zone label and the debug line; Figtree for everything else, including the period label (review 2). Tabular figures on the mono text plus the period label, day numbers, the date picker and offsets | Mono everywhere numbers appear | Matches the reviews. The debug line is code, so mono reads better. | — |
| Top-bar rows on narrow screens use a flex row with an `::after` line break and `order` (review 1) | CSS grid areas | Row 2 is left-aligned and its items differ in width from row 1's, which a shared grid can't do without one row's widths shaping the other's. The zone selector takes row 1's leftover space (`flex: 1 1 0`) and truncates with an ellipsis rather than wrapping. | — |
| Active tab: background fill plus a 2 px inset underline (`box-shadow`), no weight change (review 1) | A border-bottom; bold | `box-shadow` and background never affect layout, so no tab can move. A Playwright check confirmed identical tab widths and positions in all four views. | — |
| Period label: visible months-and-year text is `aria-hidden`, and a visually hidden span gives the full dates (review 1) | `aria-label` on the `<h1>` | Screen readers reliably read text content; `aria-label` on headings is unevenly supported. `<title>` keeps the full dates too. | — |
| Months are formatted by `Intl` (en-GB short), so September is "Sept" | A fixed three-letter table | Display uses `Intl.DateTimeFormat` throughout, per §2. | Maxence wanting "Sep". |
| Zone selector shows the zone name only; the offset in effect right now is in the accessible name, a summary line at the top of the dropdown ("Europe/Paris · UTC+1") and on `/tz` | Both offsets when the visible period crosses a DST change ("UTC+1 → UTC+0") | One offset, the current one, is what a visitor needs; the second only explained a clock change and read as noise. | — |
| Past time is dimmed as in the first version (a veil in the page colour, `--color-veil`), over a less saturated palette: `PALETTE_PAST` is each step with chroma × `PAST_CHROMA` (0.5), served as `.past.pN` classes (review 2) | `backdrop-filter: grayscale()` on every past cell (review 1) | Keeps the original dimming, adds the reduced saturation you liked, and costs nothing to paint. The review-1 backdrop filter on hundreds of cells was a likely cause of slow rendering in Firefox on low-end machines. Only the slot holding now still uses one (`saturate(0.5)`, for its past part), because a partial overlay is the only way to dim part of a cell. | — |
| The slot holding now is split; slots on earlier days and earlier today are fully greyed. JS keeps both up to date each minute (review 1) | Grey only whole slots | It needed no refactor, only one generated rule per minute step. | — |
| `--color-grid`: white (the page colour) in light mode, a dark neutral in dark mode (review 3, replacing review 1's single dark value) | One dark value in both themes | With the light-mode map inverted, cells are separated well enough by white lines, as in the first version. | — |
| Dividers (top bar, panels, dialogs) use a new `--color-divider`; buttons and inputs keep `--color-border` (review 1) | Lighten `--color-border` | Controls keep their visible edges while lines that only separate regions get subtler. | — |
| Help, Contact and Download are `<dialog>`s rendered into the page. Any link with `data-dialog` opens one; a link inside a dialog (Help → Contact) switches dialogs and keeps the original opener for focus return (review 1) | One handler per dialog | One rule covers all three. | — |
| `/tz` also gets the top-right Close (review 1) | Leave it with a back link | "Remove the back links" plus the same page header everywhere. | — |
| Favicon: Maxence's `favicon.svg`, shapes unchanged, with its five hex colours rewritten as the identical `rgb()` values (review 2) | Exempt the file from the hex rule | The spec's rule allows hex only in `tokens.css` and `parula.ts`; `rgb()` renders the same. | — |
| `apple-touch-icon.png` has a square tile | Rounded with transparent corners | iOS rounds the icon itself and fills transparency with black. | — |
| Head-script loop guard: once per page view, and never again on the exact URL the last replace went to (review 1 fix) | A 5-second window | The 5-second window could skip a legitimate `dtz` fix if a visitor opened several typed URLs quickly (found while testing review 1). Matching the exact URL is what a loop would actually repeat. | — |
| Prev/next arrows are inline SVG chevrons (a plain 90° angle, 2 px stroke), also used in the date picker through `<template>`s (review 2) | A different glyph font | An icon draws the same everywhere and needs no font. The links keep their accessible names ("Previous week"). | — |
| Contact: every link has a Copy button. Copy puts the link URL on the clipboard, and the address for email. Each button's accessible name says what it copies ("Copy Discord link") (review 2) | Copy the visible handle | A URL works wherever it's pasted. For Discord the user page link is unambiguous, while the handle alone needs the app. | Visitors wanting the handle. |
| Contact rows are a three-column grid (name, link, Copy), with `display: contents` on each `<div>` row inside the `<dl>` | A table | Keeps the `dl` semantics, and the Copy column lines up on the right. | — |
| Narrow top bar: row 2 controls are at least 44 px tall, the tabs share the free width, and the arrows are 40 px wide (review 2) | Full-width equal tabs | At 360 px, 44 px-tall controls with equal-width tabs don't fit beside Today and both arrows; sizing tabs to content lets them fit. Measured: everything fits at 360 px. | — |
| Performance (review 2): `canonicalZone` memoised (it built a new `Intl.DateTimeFormat` for every event time); zone offsets memoised per 15-minute bucket; occurrences skipped on their local clock time before any zone conversion; parsed events built once per feed; expansions cached per feed in aligned 5-week windows | A different iCal library; caching rendered HTML | Profiling showed expansion was 90% of request time: about 670 ms for a week view in the test runtime. A week request went from about 360 ms to about 11 ms, and calendar pages on the dev server from 400–870 ms to 15–30 ms. All caches are per isolate and keyed by the parsed feed, so a new fetch starts fresh. | Profiling showing a new hot spot. |
| Remaining first-visit cost: without `dtz` in the URL, the head script's redirect means two GETs | Server-side zone guessing | The spec requires the device zone, which only the browser knows. Every rendered link carries `dtz`, so only the first page of a visit pays. | — |
| No compression in the Worker | `CompressionStream` | Cloudflare compresses HTML, CSS and JS at the edge **(unverified)**; `wrangler dev` doesn't, so local pages look bigger than they are. | Measured uncompressed responses in production. |
| Light mode inverts the colour map, so free is the yellow end and busy the dark purple end; dark mode keeps parula's direction. Each step class `pN` takes its colour, past colour and dot pattern from per-theme CSS variables generated from `THEME_PALETTES` (review 3) | One map for both themes; light grid lines in a dark colour (review 1) | On a white page, busy cells that are dark read as "taken", and light-mode grid lines can go back to the page colour. Same structure as `tokens.css` (dark on `:root`, light when chosen), so the theme switcher flips the calendar too. The dither level per step is unchanged; the dot tone (black or white) is chosen for the colour underneath in each theme. | — |
| Top bar in three grid columns: `minmax(max-content, 1fr)`, `minmax(0, max-content)`, `minmax(max-content, 1fr)`, so equal side columns centre the context exactly; the context shrinks (the zone name truncates) before anything overlaps. Two rows up to 1160 px (review 3) | Two rows only on phones | Below about 1150 px the left group is wider than half the leftover space, so the context can't be centred; the two-row layout keeps it tidy instead. Measured: centred at 1161, 1280 and 1440 px, and no overlap with a long zone name. | Wanting one row on smaller laptops: shorten the right-hand labels. |
| Range form: one inline "to" between the date fields (`aria-hidden`), with the fields named by `aria-label` ("Start date", "End date") (review 3) | Visually hidden `<label>`s | The visible "to" would be read between two unlabelled fields otherwise; `aria-label` gives each field its own name, and the "to" adds nothing for screen readers. | — |
| Contact icons: Tabler v3.2.0 path data inlined in JSX at 18 px, `aria-hidden` (review 3) | `<img>` files; a sprite | Inline needs no request and inherits `currentColor` in both themes. Fetched from `raw.githubusercontent.com/tabler/tabler-icons/v3.2.0/…`, never `main`. | — |
| Dialog heads use the body's inline padding (24 px, 16 px on phones), so Close lines up with the content's right edge (review 3) | Equal padding on both sides of Close | Asked for. Measured: Close, Cancel and every Copy button share the same right edge. | — |
| Prev/next chevrons 16 px, down from 18 (review 3) | 17 px | "Very slightly smaller", on the same 16 px grid as the other icons. | — |
| Dark by default on every device; `prefers-color-scheme` isn't used anywhere. Light only when chosen with the switcher (stored in `localStorage`) | Follow the system setting (as before) | Maxence's call: one look for everyone unless they choose otherwise. Without JS the page is dark. | — |
| Motion: "grow from the source". One effect (fade, scale from 0.96 and a 6 px nudge, with `transform-origin` at the opening control) for dialogs, the menu, the zone dropdown, the date picker and toasts; reversed and quicker on exit. Tokens `--motion-in` (160 ms), `--motion-out` (110 ms), `--motion-ui` (100 ms), `--motion-glide` (400 ms) | A different effect per element; slide-ups | One consistent effect, and it always starts where the eye and pointer are. | — |
| Exits play a keyframe animation (`is-closing`, `anim-out`), then JS closes or removes the element: a ~25-line `play()` helper with a 400 ms fallback timer. Escape on a dialog is intercepted (`cancel`) so it runs the same exit | CSS-only exits with `@starting-style`, `transition-behavior: allow-discrete` and `overlay` | Firefox doesn't support `overlay`, so CSS-only dialog exits would be instant there; Maxence uses Firefox. Entrances are plain CSS keyframes, which work everywhere. | — |
| The narrow-screen menu (a native popover) animates in but closes instantly | JS-managed popover | It closes natively on outside click and Escape; delaying that would need taking over the popover's behaviour, for an exit on phones only. | Wanting the exit too. |
| A minimised sticky toast shrinks to the indicator's position (a vector measured at the time), and focus moves to the indicator only after it appears | Fade out | Shows where the notice went, and where it will come back from. Focus can't go to a hidden element. | — |
| Page colours never animate when switching theme; only the toggle's icons turn | Cross-fade colours | Maxence's call, and cross-fading hundreds of cells is costly to paint. | — |
| No navigation animation | Slide in from the arrow's side | That would need the direction carried in the URL (or the `Referer`), which isn't worth it for a page load. | — |
| Reduced motion: one rule sets every animation and transition duration to 0 (including `::backdrop`), and JS calls exit callbacks immediately | Per-element opt-outs | Nothing can be missed by a later addition. | — |
| Drag to scroll with a mouse: Pointer Events on every `.cal-scroll`, mouse only (touch and pens already scroll natively), 5 px threshold before a press becomes a drag, pointer capture during the drag, the click after a drag swallowed, native link dragging blocked. On release it glides with the speed of the last few moves, slowing by 0.5% per ms (stops in about a second); no glide under reduced motion. A wheel or key stops a glide | A library; CSS-only `scroll-snap` | About 100 lines, no dependency. The threshold keeps clicks working: cells focus, Month days open. | Users finding the glide too long or short: change 0.995 in `glideStep`. |
| Several calendars: `ICAL_URL` lists one or more addresses separated by spaces, commas or new lines; fetched in parallel, each with its own saved copy, busy time merged. Any feed with neither a fresh fetch nor a saved copy fails the whole page; a feed on its saved copy shows the usual warning. At most 10 (`MAX_FEEDS`) | Separate secrets (`ICAL_URL_2`, …); drawing whichever feeds loaded | One secret keeps the deploy step the same, and a single address works as before (same saved-copy key). A partial calendar would show a failed feed's busy time as free, which is the one thing this site must not do. The cap bounds subrequests per refresh. | Needing per-calendar settings (for example, one counted as tentative). |
| Hovering a cell draws a 2 px inset ring of grid colour over 40 ms (`--motion-hover`), so it looks slightly shrunk: Month and long-Range days, and the slots in Day, Week and short Range. Only on devices that can hover, not while drag-scrolling, and not over a slot that has keyboard focus (its focus ring wins) | Scaling the cell; an outline; a brightness change | Scaling would shrink the dither pattern too; the ring is an inset `box-shadow` painted over the background, so cells and their dots keep their size. Grid colour reads over every cell colour in both themes. An outline would compete with today's red outline and the focus ring, and brightness barely shows on the yellow free cells in light mode. Thin and quick so it reads as a cue, not an animation. Instant under reduced motion. | — |
| "·" separators in page text are wrapped in `<span class="sep">` and coloured `--color-sep` (subtle): the debug line, the zone summary (dropdown and `/tz`), error-page messages | Leave them in the text colour | Subtle separators let the parts read as separate. The text and what screen readers read are unchanged. Browser tab titles and `<select>` options can't be styled, so they keep a plain "·". | — |
| Zone dropdown in the shadcn command style: flush search field, one lighter-fill highlight shared by pointer and keyboard (no outline), nothing highlighted on open, typing highlights the first match, Device default styled like every other option, 6 px corners (options 4 px) | Keep the first option pre-selected; an icon on Device default | Device default is just another zone, so it shouldn't look chosen or special. Keyboard users still see where they are: Down highlights the first option. The search field's focus shows as a focus-coloured bottom border. | — |
| `/tz` without JS (no `dtz`) doesn't list Device default at all, and selects the zone in use | Listing it with a note that it means Europe/London | Without JS the device's zone is unknowable, so the option would only mislead. | — |
| The `/tz` select has an `aria-label` ("Time zone") | A visible label | The visible label was removed for brevity; an accessible name is still required, and the page heading already says "Time zone". | — |
| Fatal error panel: 2 px corners and a 20 px ✕ with space above | Rounded like the dialogs | Reads as a plain notice rather than a card. | — |
| The date picker has no hint text | "Select the start date" hint | The selected range is visible in the picker and the fields; the hint was noise. | — |
| Wall-clock rows on DST days: always 48 rows. Skipped half-hours are labelled "skipped by clock change", and the repeated hour folds into the 01:30 row. | 46 or 50 rows | Keeps columns aligned across a week, and the spec asks for 48 rows. | — |
| Current-time line and slot positions use classes (`m0`–`m29`) rather than inline `top:` | Inline style | CSP. JS moves it by changing the class. | — |
| Narrow menu is a native `popover` (works without JS); on wide screens CSS shows the same items inline | A `<details>` menu; JS menu | One element serves both widths, keeps the HTML order of §5.0.1, and needs no JS. | Needing to support browsers without popover (they show the items inline). |
| Notices layer is absolutely positioned at the top of the calendar region | `position: fixed` under the top bar | It sits under the top bar, and under the colour strip on narrow screens, without measuring either. | — |
| Contact and Download overlays are `<dialog>`s rendered into the page, opened by JS. Without JS the links go to `/contact` and `/export`. | Fetching the content | No extra request, and the content is the same component as the full pages. | — |
| Slots get `tabindex="0"`. With JS there's one tab stop and arrow keys move between cells. | 336 tab stops | Keyboard focus works without JS, and with JS it's usable. | — |
| `Cache-Control`: pages and `.ics` `private, max-age=60`; static files `public, max-age=3600`; errors `no-store` | `no-store` everywhere | "Short enough that the calendar is never long out of date", and the current-time line is at most a minute stale on load. | — |
| HSTS `max-age=31536000; includeSubDomains`, no `preload` | `preload` | Preload commits the whole domain, which is out of scope. `includeSubDomains` only covers `*.time.mutantcacti.com`. | — |
| `run_worker_first = true` for static assets **(unverified)** | Assets served before the Worker; `_headers` file | Security headers and the GET/HEAD-only rule then apply to every response, from one place. | Asset request costs. |
| Dev fixture via `[env.dev]` with its own `main` (`src/dev.ts`) | A flag in production code | The fixture never ships, and `npm run dev` needs no secret. | — |
| `compatibility_date = "2026-10-01"` | Today's date | A recent date the bundled `workerd` supports. | Upgrading Wrangler. |
| Tests use `@cloudflare/vitest-plugin` 1.4.9 and Wrangler 4.154.0 (review 1) | Keep `@cloudflare/vitest-pool-workers` 0.23.0; `npm audit fix --force` | All six high `npm audit` findings (undici, sharp, zod, and miniflare and wrangler, which pull them in) came only through the deprecated pool package, which pins exact old versions. `npm audit fix` couldn't move them, and `--force` would *downgrade* the pool to 0.12. Its deprecation notice says it was renamed, and here the move changed only the import name. Production dependencies (hono, ical.js) had no findings. | A regression in the plugin. |
| Range tab from Day/Week/Month opens the current period as a range | This week | Keeps the visitor's place. | — |
| Today is always a link. When the period already contains now it's marked `data-noop` and JS cancels the click; without JS it reloads the same period (review 2) | `aria-disabled` | "Always clickable, just a no-op." | — |
| The source values are the widely circulated 64-entry `parula(64)` table **(unverified)** against MATLAB's current output | — | MATLAB isn't available here. | A visible mismatch. |
| Time-zone search matches the zone IDs the browser lists, which may use older names (Chrome lists `Asia/Calcutta`) | Alias table | Smallest option. | Visitors not finding their zone. |
| when2meet phase 0 was done from raw pages Maxence captured with `curl` and DevTools (four test events, one reloaded grid, a missing event, the home page and the headers), not from the live site | Wait for `www.when2meet.com` to be allowed | The proxy refuses when2meet, and the pages hold all of when2meet's own logic inline. What no capture shows is marked **(unverified)** in `docs/W2M-GET-SPEC.md`; only the save-order question (Q5) is still open. A missing event answers 200, so it's recognised by its content. | Phase 1 reaching the live site and finding a difference. |
| Match mode uses the viewer's zone, not the event's, and rebuilds when2meet's grid itself (GET spec §2.2) | The event's zone (the original `W2M-SPEC.md` §1.3); calling `AvailabilityGrids.php` | when2meet reloads a dates event's grid in each visitor's zone, so only the viewer's zone lines up cell for cell (review of phase 0, agreed by Maxence). The reloaded grid follows a simple rule that reproduces the captured one exactly, so no POST to when2meet is needed. | A reloaded grid that breaks the rule. |
| Days-of-the-week events: you pick the week (`w2mweek`), defaulting to the coming week | Always the coming week | Maxence's answer: the week the meeting actually happens is what matters. | — |
| The bookmarklet makes the grid match time. exactly: it also clears slots you'd marked available that are now busy | Only ever add availability | Maxence's answer. The overlay states both counts before anything changes. | — |
| The bookmarklet waits for each save by watching resource timing (`PerformanceObserver`), not by wrapping `window.fetch` | Wrap `fetch`; poll `AvailableAtSlot` | Wrapping is invasive on someone else's page, and `AvailableAtSlot` changes before the save is even sent, so polling it shows nothing. | Resource timing not showing the page's saves (GET spec Q5). |
| No `research/EVENTS.md`; fixtures use placeholder links (`10000001-Test1`, `10000002-Test2`) | Commit the test events' links | Anyone with an event's link can edit it, so the links stay out of the repo, as phase 3 does with canaries. | — |
| Fixture privacy is checked structurally (no participants, empty availability, no third-party scripts) plus a deny-list that is empty for now | A deny-list only | No names were given, and nobody had signed in on the test events. The structural check also catches names that aren't on any list. | Maxence signing in on a test event: add the name to `DENY_NAMES`. |
| Match mode replaces the view: no view tabs, Today or arrows while it's on, and the period label shows the event's dates | Keep the controls and let them change nothing; let them leave the match | The grid is the event's, so there's no period to move through. Closing the toast is the one way out, and it's always on screen (or in the indicator when minimised). | Visitors looking for the views mid-match. |
| Days-of-the-week events default to the next Monday from today (today if it's a Monday) | This week | "The coming week" (W2M-SPEC §1.3) read as the next full week ahead; `w2mweek` and the toast's week links change it. | — |
| A bad `w2m` parameter on `/` shows the error panel (`W2M_URL`, 400) with the normal controls, instead of silently showing the normal calendar | Ignore it | Fails visibly, like every other when2meet error. | — |
| The match grid is a CSS grid with generated column classes (`.mgrid.c1`–`.c62`), one row per slot and a full-height gap row at a break | Inline styles; a table | The CSP has no `unsafe-inline`, and rows in DOM order keep the Week view's arrow-key navigation and the client's minute tick working unchanged. | — |
| The top bar's two-row breakpoint moved from 1160 px to 1300 px | Shrink the pills | The extra **when2meet** item would otherwise squeeze the zone name between 1160 and 1300 px. | — |
| `npm run dev` serves the when2meet fixtures for their placeholder links, and fetches every other link live | Fixtures only; live only | The fixtures keep dev repeatable without a network, and real links behave as in production. (Fixtures only made every real link look missing.) | — |
