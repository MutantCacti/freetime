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

Tests run inside the Workers runtime (Vitest with `@cloudflare/vitest-pool-workers`), and they never fetch the real feed. Every test uses the `.ics` fixtures in `test/fixtures/`.

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
| `src/parula.ts`, `src/dither.ts`, `src/styles.ts` | Colour table, Bayer dither, and the generated `/css/calendar.css` |
| `src/export-ics.ts` | The busy-only `.ics` file |
| `src/views/` | JSX for the top bar, calendar, notices, panels and pages |
| `src/config.ts` | Settings you might change (see below) |
| `public/css/tokens.css` | Design tokens: raw values, then semantic tokens, light and dark |
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
| `vitest`, `@cloudflare/vitest-pool-workers` | dev | Tests that run in the Workers runtime, as the spec asks. |
| `typescript`, `@cloudflare/workers-types` | dev | Strict type checking (`npm run typecheck`). |

There's no UI framework, no date library (Intl does all the time-zone work) and no third-party script or icon set. Icons are inline SVG.

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
| **Chrome colours** | The raw values at the top of `public/css/tokens.css`. Each semantic token maps onto them for light and dark. `test/colour-rule.test.ts` checks AA contrast for both modes. |
| **Calendar colours** | The `PARULA` table in `src/parula.ts`. The cell CSS is generated from it. |
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
| Mode marker `default` when neither `tz` nor `dtz` is set (no JS) | Show "device" | The spec says the no-JS label "says so", and "device" would be wrong there. | — |
| Narrow-screen default view: the head script adds `view=day` (at ≤ 640 px, path `/`, no `view`) in the same `location.replace` as `dtz` | Detect on the server; CSS only | The server can't know the width, and one replace keeps the "at most once" rule. An explicit `view` always wins. | — |
| Head-script loop guard: once per page view, and not again within 5 s (sessionStorage, wrapped in try/catch) | A URL marker | Stops a loop even if a zone name gets rewritten. Leaves no trace in shared links. | — |
| `/tz` without JS: a GET form to `/tz?apply=1…` that redirects (302) to the clean calendar URL | A form straight to `/` | A GET form can't omit an empty field. Without the redirect, "Device default" would leave `tz=` in the URL instead of removing it. It's still read-only. | — |
| Invalid `date` in Day/Week/Month falls back to today silently. Range adjustments (swap, cap, invalid) each show a notice. | A notice for both | The spec only describes Range adjustments, so the other views use the simplest option. | Confused visitors. |
| No inline styles. Cell colours and dither are classes in a generated `/css/calendar.css`, and dither tiles are generated SVGs at `/img/dither/<level><tone>.svg`. | `style=""` attributes; data URIs | The CSP is `self` only, with no `unsafe-inline`. Generating the CSS from `parula.ts` keeps the hex values in one file. | — |
| Dither dots are black or white at 42% opacity, picked per parula entry by contrast, and the same in both themes | One dot colour | Dark dots vanish on dark blue and light dots on yellow. A test checks that the dots differ in lightness at every step, so the pattern reads in greyscale. | — |
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
| `compatibility_date = "2026-08-15"` | Today's date | The newest date the bundled `workerd` in the test pool supports. | Upgrading Wrangler. |
| `@cloudflare/vitest-pool-workers` kept, though it now prints a notice that it's been renamed to `@cloudflare/vitest-plugin` | Migrate | The spec names it. Moving is one codemod (`npx @cloudflare/codemods vitest:pool-workers-to-vitest-plugin`). | It stops working with a newer Vitest. |
| Range tab from Day/Week/Month opens the current period as a range | This week | Keeps the visitor's place. | — |
| Today is disabled whenever the period contains now, including a Range that contains today but starts earlier | Enable it for Range | Follows §5.5 literally. | — |
| Parula values are the widely circulated 64-entry `parula(64)` table **(unverified)** against MATLAB's current output | — | MATLAB isn't available here. | A visible mismatch. |
| Time-zone search matches the zone IDs the browser lists, which may use older names (Chrome lists `Asia/Calcutta`) | Alias table | Smallest option. | Visitors not finding their zone. |
