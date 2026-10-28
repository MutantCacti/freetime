# time.mutantcacti.com — when2meet add-on spec

An add-on to TIME-SPEC.md, built **after the pilot has merged**. It helps Maxence copy their availability into a when2meet event, on desktop and on mobile. Everything in TIME-SPEC.md still applies (stack, PRINTED OUTPUT, plain language, no storage, no cookies), unless this file says otherwise.

It has four phases. Phase 0 is research and produces the **GET spec** that phases 1 and 2 build on. Each phase is its own pull request.

| Phase | What | Needs |
|---|---|---|
| 0 | Experiment: inspect when2meet and write `docs/W2M-GET-SPEC.md` | when2meet reachable from the session (see §0.1) |
| 1 | Match: paste a when2meet link; the calendar switches to that event's exact grid, in a binary copy-ready look | Phase 0 |
| 2 | Bookmarklet: fill when2meet from time.'s busy blocks, then hand control back to you | Phase 0 |
| 3 | Heartbeat: scheduled self-check that alerts Maxence when something breaks | Phase 1 |

Maxence's own command-line fill tool is **out of scope** and lives only on his device (§5).

---

## 0. Phase 0: experimentation → GET spec

**Goal:** understand when2meet well enough to read an event's structure reliably, and to fill a grid from a script, without guessing. **No product code in this phase.**

### 0.1 Access
- The cloud session's network allowlist probably doesn't include `when2meet.com`. **Check first.** If it's blocked, stop and tell Maxence. Then either Maxence adds `www.when2meet.com` to the cloud environment's allowed domains, or saves the pages listed in §0.2 and commits them under `research/raw/` (gitignored after phase 0, see §0.4).
- Maxence creates **two test events** they own and nobody else uses: one with specific dates, one with days of the week. Their links go in `research/EVENTS.md`.

### 0.2 What to investigate
Use the test events only. Inspect each on desktop Chromium and on a mobile viewport with touch emulation, using the pre-installed Playwright.

1. **Event structure in the HTML:**
   - where the event's dates or weekdays, hours, slot length and time zone are encoded (HTML, inline script variables, attributes);
   - how each slot is identified (for example, an id containing a timestamp);
   - how "days of the week" events differ from date events.
2. **The page's own JavaScript:**
   - the functions or handlers that select and deselect slots for the signed-in person;
   - whether they work the same with touch and with mouse;
   - when availability is saved (on each change, on mouse-up, or on a button).
3. **Sign-in:** what the page needs before slots can be painted (name and optional password) and how that state is held.
4. **Headers:** `Content-Security-Policy` (does it block a bookmarklet's `fetch` to `time.mutantcacti.com`?), `X-Frame-Options` and `frame-ancestors` (can it be framed?), and whether the page sets CORS headers.
5. **Stability signals:** anything versioned, any obvious recent changes, and how a missing or deleted event looks.

**Do not** send any request that writes to when2meet (no saving availability, no creating events) except on the test events, and only to confirm item 2. Never touch other people's events.

### 0.3 Output: `docs/W2M-GET-SPEC.md`
A precise, testable contract:
- **Accepted URLs:** the exact pattern of an event link (for example `https://www.when2meet.com/?<id>-<code>`), as a regex.
- **Fetch:** method, headers, timeout, size limit, and what a missing event returns.
- **Parse contract:** for each field (event kind, dates or weekdays, first and last slot, slot length, time zone, ordered slot list), where it comes from in the page and how to extract it, with a worked example from each test event.
  - **Slot length is parsed, never assumed.** Derive it from the slot list: the difference between consecutive slot start times within a day, cross-checked against (day span ÷ slots per day). If the two disagree, or slots are uneven, that's `W2M_PARSE`.
- **Fill contract** (for phase 2): the selection functions or events to use, in order, for mouse and for touch, and when saving happens.
- **Failure modes:** what changes in the page would break each part, and how each failure is detected (for example, "slot list empty", "time zone missing").
- **Privacy:** event pages include other participants' names and availability. The parser reads **only the event structure** and never the participants. Say exactly which parts of the page are ignored.
- Mark anything inferred rather than observed as **(unverified)**.

### 0.4 Fixtures
- Save one HTML snapshot per test event as `test/fixtures/w2m/*.html`, **scrubbed** of participant names and availability. A test checks the fixtures contain no names from a deny-list Maxence provides (his own test names).
- Raw unscrubbed captures never get committed.

**Done when:** `docs/W2M-GET-SPEC.md` and the scrubbed fixtures are merged, and Maxence has approved the spec.

---

## 1. Phase 1: match the calendar to an event

### 1.1 Entry point
- A new top-bar item, **when2meet**, placed directly after **Download .ics** (and inside the narrow-screen menu in the same position). Same pill style as its neighbours.
- With JS, it opens a modal (top-right × to close, like the others). Without JS, it links to `GET /w2m`.
- The form: one text field ("when2meet link"), and a **Go** button. It submits as a GET to `/w2m?url=…`, keeping `dtz` and `tz`.

### 1.2 Server behaviour (`GET /w2m?url=`)
- **Validate before fetching:** the URL must match the phase 0 regex exactly. Anything else is rejected without a request (this prevents the server being used to fetch arbitrary addresses). Rebuild the URL from the parsed id and code; never fetch the raw input.
- **Fetch:** one GET, with the timeout and size limit from the GET spec, and a plain `User-Agent` naming the site (for example `time.mutantcacti.com (+https://time.mutantcacti.com/help)`).
- **Cache** the parsed event structure (not the page) with the Cache API for a few minutes, keyed by event id, so reloads don't refetch.
- **Nothing is stored or logged** except the event id on errors. The pasted link isn't kept anywhere else.

### 1.3 Match mode: the calendar becomes the event's grid
There is no separate page. `/w2m` validates and parses the event, then redirects (302) to the main calendar in **match mode**, carried by a `w2m=<id>-<code>` parameter. Links in the page keep it; closing the toast drops it.

The goal is that copying into when2meet is cell-for-cell, with nothing to translate.

- **Same grid as when2meet:**
  - columns = the event's days, in when2meet's order (for a days-of-the-week event, the coming week, labelled as such in the toast);
  - rows = **the event's slots exactly**: its parsed slot length, starting at its first slot and ending at its last. No hours outside the event are drawn, so row 1 here is row 1 there;
  - time zone = the event's own zone, via `tz`, so the columns and rows line up with when2meet's. The selector still works, and changing it is noted in the toast ("Not the event's time zone").
- **Binary look**, so it reads like when2meet rather than like the heatmap:
  - each slot is **free** or **busy**: busy if it overlaps any busy block at all (`W2M_BUSY_THRESHOLD = 0`, a constant, so it can later allow, say, a 5-minute overlap);
  - free slots use one colour token, `--color-w2m-free`; busy slots use `--color-w2m-busy` plus a fixed hatch, so colour isn't the only signal;
  - no parula, no levels, no dither, and the colour bar becomes a two-item key ("Free", "Busy");
  - past slots are still dimmed.
- **Easy to copy by eye:** a row-number or time label on every row (when2meet's own labels), and a thin rule every hour, to keep your place while switching tabs.
- If the event is longer than the Range cap (62 days), show the first 62 days and say so in the toast.

### 1.4 The when2meet toast
A new **info** severity for toasts (neutral colour token `--color-info`, with an icon), shown as a **sticky** toast while `w2m` is set:
- text: "Matched to when2meet: Mon 2 – Fri 6 Nov, 09:00–17:00, 15-minute slots."
- a pill button **Open when2meet** (new tab);
- a close button (×), which clears the match and returns to the normal calendar. Minimising works as for other sticky toasts.

### 1.5 Errors
Use the toast and error-panel rules from TIME-SPEC.md §5.9, with new codes:

| Code | Meaning | Status |
|---|---|---|
| `W2M_URL` | The link isn't a when2meet event link | 400 (shown inline next to the field, not as a panel) |
| `W2M_FETCH` | when2meet couldn't be reached or timed out | 503 |
| `W2M_STATUS_<n>` | when2meet answered with status `<n>` | 503 |
| `W2M_NOT_FOUND` | The event doesn't exist | 404 |
| `W2M_PARSE` | The page loaded but didn't match the GET spec | 502 |

`W2M_PARSE` is the one that means when2meet has changed. It must never show a partly parsed grid.

### 1.6 Tests
- URL validation: valid links, lookalike hosts, other paths, `http`, credentials in the URL, redirects, overlong input.
- Parsing both fixtures into the expected structure; a mutated fixture gives `W2M_PARSE`, not a wrong grid.
- `/w2m` redirects to match mode with the right days and zone; rows are exactly the event's slots (count, length and start), for both 15- and 30-minute events and across a DST change.
- Slot length is parsed, and uneven or contradictory slots give `W2M_PARSE`.
- Binary look: a slot with any overlap is busy; no parula or dither classes appear in match mode; the key shows Free and Busy.
- The toast appears while `w2m` is set, links keep `w2m`, and closing it removes it.
- No participant name from the fixtures appears in any response.
- The when2meet fetch is mocked in every test.

---

## 2. Phase 2: bookmarklet

### 2.1 What it does
Run on a when2meet event page, after signing in with a name:
1. Reads the event's grid in the page (per the GET spec).
2. Fetches `https://time.mutantcacti.com/free-busy.ics?from=…&to=…` for that range.
3. Works out which slots are free (no overlap with any busy block).
4. Shows a small overlay on the when2meet page: "Mark 23 slots as available?" with **Fill** and **Cancel**.
5. On **Fill**, selects those slots using the fill contract (the page's own functions if available, otherwise synthetic mouse or touch events).
6. Leaves the page for Maxence to adjust by hand. It never presses any save or submit button the page has, beyond whatever the page saves on its own when slots change (the GET spec says which).

### 2.2 Rules
- **CORS:** `/free-busy.ics` adds `Access-Control-Allow-Origin: https://www.when2meet.com` (that origin only) and `Vary: Origin`. No other route changes.
- It uses the **same free/busy rule** as match mode (`W2M_BUSY_THRESHOLD`), so what it fills is exactly what time. shows.
- If when2meet's CSP blocks the fetch, the bookmarklet says so in its overlay and links to time. in match mode for this event (phase 1) instead.
- It refuses to run if nobody is signed in on the page, with a message saying to sign in first.
- Desktop and mobile: test both with Playwright (mouse, and touch emulation).
- The bookmarklet source lives in `public/js/w2m-bookmarklet.js`, is minified into a `javascript:` URL at build time, and has PRINTED OUTPUT markers like everything else.

### 2.3 Setup on `/help`
A short section, "Fill when2meet", with:
- a draggable link for desktop browsers;
- a **Copy** button (same in-button confirmation as the email) for phones;
- one-time setup steps for iPhone (Safari: bookmark any page, edit it, replace the address with the copied code) and Android (Chrome: save it the same way, then type its name in the address bar on the when2meet page and tap it);
- a note that it only reads busy times from time. and only changes the grid on the page you're looking at.

---

## 3. Phase 3: heartbeat

**Goal:** Maxence hears about breakage before a visitor does. This follows the Mite Spotter rule: scheduled jobs end with an integrity check and a heartbeat, failures stop and need manual intervention, nothing self-heals.

### 3.1 Scheduled self-check
- A Cron Trigger every **6 hours** (a constant) runs:
  1. **Feed:** fetch and parse `ICAL_URL`, expand the next 2 weeks.
  2. **when2meet:** fetch and parse both canary events (Maxence's phase 0 test events, stored as secrets `W2M_CANARY_DATES` and `W2M_CANARY_WEEKDAYS`), and check the result matches what's expected (for example, the number of days and slots).
  3. **Self:** request `/` and `/free-busy.ics` on the production hostname and check the status and content type.
- **Success:** ping `HEARTBEAT_URL` (a secret; a healthchecks.io check URL).
- **Failure:** ping `HEARTBEAT_URL + "/fail"` with a short body: the error code and reference only (for example `W2M_PARSE · ref 7K2Q9M`). No feed address, no page content.
- healthchecks.io is set to alert Maxence on a failure ping **and** on a missed ping (grace period a little longer than 6 hours), so a dead cron is noticed too.

### 3.2 Errors from real visitors
- Any `W2M_PARSE` or fatal `FEED_*` error during a real request also sends one failure ping, at most **once per hour per code**, using the Cache API as a short-lived marker (it's a cache entry, not stored state).

### 3.3 Deployment additions (README)
1. Create a healthchecks.io check: period 6 hours, grace 1 hour, notifications to Maxence's email (and any other channel he wants).
2. `npx wrangler secret put HEARTBEAT_URL`
3. `npx wrangler secret put W2M_CANARY_DATES` and `npx wrangler secret put W2M_CANARY_WEEKDAYS`
4. Add the Cron Trigger to `wrangler.toml` and deploy.
5. **Verify:** run the scheduled handler once (`wrangler dev` with `/__scheduled`, or trigger it from the dashboard), confirm the check shows "up"; set a canary secret to a wrong event, run it again, confirm the alert arrives with a code and reference, then restore the secret.

### 3.4 Tests
- The self-check pings success when all three pass, and failure with only a code and reference when any fails.
- The once-per-hour limit holds for repeated visitor errors.
- No secret value appears in any ping body or log line.

---

## 4. Definition of done (per phase)

- **Phase 0:** GET spec approved; scrubbed fixtures merged; no product code.
- **Phase 1:** §1 implemented; §1.5 tests green; works without JS; PRINTED OUTPUT count reported.
- **Phase 2:** §2 implemented; desktop and mobile Playwright runs pass on a local copy of the fixture pages; `/help` section written as a template.
- **Phase 3:** §3 implemented; §3.4 tests green; README deployment steps added and verified by Maxence.

Each phase lands as its own pull request, and the README's decisions table and error-code table are updated each time.

---

## 5. Out of scope: Maxence's local fill tool

Maxence keeps his own desktop fill tool on his own machine. It is **not** in this repository, and nothing on time. mentions it, links to it or produces commands for it.

time. supports it only through what is already public:
- `/free-busy.ics?from=&to=` (busy blocks only), and
- the free/busy rule in `W2M_BUSY_THRESHOLD`, which must be documented in the README so a local tool can reproduce it exactly.

The bookmarklet's fill logic lives in its own file (`public/js/w2m-fill.js`) with no dependencies on the rest of the site, so it can be reused elsewhere without changes.

- No custom URL scheme and no browser-to-program launcher, ever: any website could trigger one.
- time.'s server never drives a browser or writes to when2meet.
