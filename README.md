# time.mutantcacti.com

A read-only view of Maxence's free and busy time, in the style of when2meet. Visitors find a slot here, then get in touch through the contact panel. Nothing on the site sends, books or stores anything.

It's one Cloudflare Worker with one secret (`ICAL_URL`) and one custom domain. There's no storage, no login and no cookies. The full spec is in [`TIME-SPEC.md`](TIME-SPEC.md).

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
| `test/` | Vitest suites and `.ics` fixtures |

## Dependencies

| Package | Kind | Why |
|---|---|---|
| `hono` | runtime | Router and server-side JSX (`hono/jsx`). The spec names it. Small, with no dependencies, and built for Workers. |
| `ical.js` | runtime | Parses iCal and expands RRULE, RDATE, EXDATE and RECURRENCE-ID overrides. Recurrence is easy to get wrong. This is Mozilla's parser (used by Thunderbird), and it has no dependencies. |
| `wrangler` | dev | Local dev server and deploys. |
| `vitest`, `@cloudflare/vitest-plugin` | dev | Tests that run in the Workers runtime. `@cloudflare/vitest-plugin` is the renamed `@cloudflare/vitest-pool-workers`; moving to it fixed every `npm audit` finding. |
| `typescript`, `@cloudflare/workers-types` | dev | Strict type checking (`npm run typecheck`). |

There's no UI framework, no date library (Intl does all the time-zone work) and no third-party script or icon set. Icons are inline SVG.

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

When the calendar can't be drawn, the panel shows a code, a short random reference and the UTC time, for example `FEED_FETCH · ref 7K2Q9M · 2026-11-02 14:03Z`. The Worker log has the full details (message, stack, upstream status) under the same `ref`. Search for it in `wrangler tail` or Workers Logs. `ICAL_URL` is replaced by `[ICAL_URL]` in logs and never reaches the browser.

| Code | Meaning | Status |
|---|---|---|
| `FEED_FETCH` | The feed couldn't be reached: network error, timeout (10 s), or `ICAL_URL` not set. | 503 |
| `FEED_STATUS_<n>` | The feed answered with HTTP status `<n>`, for example `FEED_STATUS_403` (address revoked or wrong) or `FEED_STATUS_404`. The body is never shown or logged. | 503 |
| `FEED_PARSE` | The feed arrived but isn't a usable iCalendar file. | 503 |
| `RANGE_EXPAND` | Expanding recurrences for the requested period failed. | 500 |
| `INTERNAL` | Anything else. | 500 |

If a fetch fails but a good copy from the last 7 days is saved, the page still renders from it with a sticky warning ("Showing a saved copy. Times may be out of date."). The log gets a `warn` entry with the code.

## Changing settings

| To change | Edit |
|---|---|
| **Window height** (hours visible at once) | `--visible-hours` in `public/css/tokens.css` (default 12). `--row-min` sets the smallest row height (24 px). |
| **Starting hour** (where the window opens when the period doesn't contain now) | `START_HOUR` in `src/config.ts`. The anchors (`#h08`), links and client JS follow it. |
| **Range cap** | `RANGE_CAP_DAYS` in `src/config.ts`. The export, the notice text and `/help` follow it. `RANGE_COLUMN_MAX_DAYS` sets where Range switches from columns to day cells. |
| **Chrome colours** | The raw values at the top of `public/css/tokens.css`. Each semantic token maps onto them for light and dark. `test/colour-rule.test.ts` checks AA contrast for both modes. `--color-grid` (calendar grid lines) and `--color-divider` (top bar and panel lines) are there too. |
| **Calendar colours** | `PALETTE_CHROMA`, `PALETTE_L_MIN` and `PALETTE_L_MAX` in `src/parula.ts` tone the source table (`PARULA_SOURCE`). The cell CSS is generated from the result. |
| **Number of steps** | `LEVELS` in `src/levels.ts` (9). Colour, dither and the colour bar all follow it. |
| **Fonts** | `public/css/fonts.css` (faces) and `--font-sans` / `--font-mono` in `tokens.css` (stacks). Update the two preloads in `src/views/layout.tsx` if the above-the-fold files change. |
| **Dither range** | `DITHER_MIN_LEVEL` and `DITHER_MAX_LEVEL` in `src/dither.ts`. They're checked at start-up (`0 ≤ MIN < MAX ≤ 15`). |
| **Default zone** (no JS, all-day and floating events) | `DEFAULT_TZ` in `src/config.ts`. |
| **Feed freshness** | `FEED_FRESH_SECONDS` and `FEED_KEEP_SECONDS` in `src/config.ts`. |

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
| Saved copy: one Cache API entry per feed, keyed by a hash of `ICAL_URL` and stamped with its fetch time. It counts as fresh for 5 minutes and is kept 7 days for failures. | Two entries; KV | The spec rules out storage, and the Cache API is a cache. One entry with a timestamp makes "fresh" testable with a fake clock. Keying by feed makes the wrong-secret check in §9 show the error panel. The Cache API is per data centre and doesn't work on `workers.dev` **(unverified)**, which is why the site runs on a custom domain. | Frequent "saved copy" warnings from cold data centres. |
| The feed is validated before it's saved | Save whatever arrives | A broken upstream response never replaces a good copy. | — |
| `FEED_*` → 503; `RANGE_EXPAND` and `INTERNAL` → 500. `FEED_STATUS_<n>` for any non-2xx. | `RANGE_EXPAND` as 503 | Matches "503 for feed problems, 500 for anything else". Expansion failing is a bug here, not the feed being down. | — |
| `.ics` export as one `VEVENT` per merged busy block ("Busy"), clipped to the range, in UTC | One `VFREEBUSY` | Both are allowed. Google Calendar and Apple Calendar import `VEVENT`s, but many apps ignore `VFREEBUSY` on import **(unverified)**. | A request for VFREEBUSY. |
| Zone names are validated by Intl. Casing is normalised; aliases are kept as given | Intl's canonical name | Intl turns `Asia/Kolkata` into `Asia/Calcutta`. That would rename the viewer's choice and disagree with the browser's name, so the head script would rewrite `dtz` on every page. | — |
| Mode `default` when neither `tz` nor `dtz` is set (no JS) | Show "device" | The spec says the no-JS label "says so", and "device" would be wrong there. Since review 1 the mode appears in the accessible name, the dropdown summary and on `/tz`, not on the button. | — |
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
| Fragment Mono for hour labels, column dates, the period label, the zone label and the debug line; tabular figures on those plus day numbers, the date picker and offsets | Mono everywhere numbers appear | Matches the review's list. The debug line is code, so mono reads better. | — |
| Top-bar rows on narrow screens use a flex row with an `::after` line break and `order` (review 1) | CSS grid areas | Row 2 is left-aligned and its items differ in width from row 1's, which a shared grid can't do without one row's widths shaping the other's. The zone selector takes row 1's leftover space (`flex: 1 1 0`) and truncates with an ellipsis rather than wrapping. | — |
| Active tab: background fill plus a 2 px inset underline (`box-shadow`), no weight change (review 1) | A border-bottom; bold | `box-shadow` and background never affect layout, so no tab can move. A Playwright check confirmed identical tab widths and positions in all four views. | — |
| Period label: visible months-and-year text is `aria-hidden`, and a visually hidden span gives the full dates (review 1) | `aria-label` on the `<h1>` | Screen readers reliably read text content; `aria-label` on headings is unevenly supported. `<title>` keeps the full dates too. | — |
| Months are formatted by `Intl` (en-GB short), so September is "Sept" | A fixed three-letter table | Display uses `Intl.DateTimeFormat` throughout, per §2. | Maxence wanting "Sep". |
| Zone selector shows the zone name only; the offset and mode are in the accessible name, a summary line at the top of the dropdown ("Europe/Paris · UTC+1 · device") and on `/tz` (review 1) | A tooltip | Visible on demand without a hover-only control. | — |
| Past time is greyed with `backdrop-filter: grayscale(1)` plus a light veil, on a `::after` layer (review 1) | `filter: grayscale()` on the cell; a plain veil | The overlay can cover just part of the slot holding now (height from the `m0`–`m29` classes), which `filter` on the cell can't. The dither stays visible, so the busy amount still reads. Browsers without `backdrop-filter` get the veil alone. | — |
| The slot holding now is split; slots on earlier days and earlier today are fully greyed. JS keeps both up to date each minute (review 1) | Grey only whole slots | It needed no refactor, only one generated rule per minute step. | — |
| `--color-grid` is one value in both themes (review 1) | A per-theme value | "A dark neutral in both themes": one value keeps the calendar identical across themes, like parula and the dither. | — |
| Dividers (top bar, panels, dialogs) use a new `--color-divider`; buttons and inputs keep `--color-border` (review 1) | Lighten `--color-border` | Controls keep their visible edges while lines that only separate regions get subtler. | — |
| Help, Contact and Download are `<dialog>`s rendered into the page. Any link with `data-dialog` opens one; a link inside a dialog (Help → Contact) switches dialogs and keeps the original opener for focus return (review 1) | One handler per dialog | One rule covers all three. | — |
| `/tz` also gets the top-right Close (review 1) | Leave it with a back link | "Remove the back links" plus the same page header everywhere. | — |
| Favicon drawn from the review's description, because the `favicon.svg` it refers to wasn't attached (review 1) | Wait for the file | It's a single file to swap. The description gives the shapes (dark rounded tile, two rounded columns, one busy block each, no now line) and the palette gives the colours: tile `--color-grid`; columns a blue lifted from step 0 to step 1 so they read on the tile at 16 px; teal-green step 4 and yellow step 8 blocks. A faint lighter edge keeps the tile visible on dark browser chrome. The SVG uses `rgb()` so the hex rule holds. | The intended `favicon.svg`. |
| `apple-touch-icon.png` has a square tile | Rounded with transparent corners | iOS rounds the icon itself and fills transparency with black. | — |
| Head-script loop guard: once per page view, and never again on the exact URL the last replace went to (review 1 fix) | A 5-second window | The 5-second window could skip a legitimate `dtz` fix if a visitor opened several typed URLs quickly (found while testing review 1). Matching the exact URL is what a loop would actually repeat. | — |
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
| Today is disabled whenever the period contains now, including a Range that contains today but starts earlier | Enable it for Range | Follows §5.5 literally. | — |
| The source values are the widely circulated 64-entry `parula(64)` table **(unverified)** against MATLAB's current output | — | MATLAB isn't available here. | A visible mismatch. |
| Time-zone search matches the zone IDs the browser lists, which may use older names (Chrome lists `Asia/Calcutta`) | Alias table | Smallest option. | Visitors not finding their zone. |
