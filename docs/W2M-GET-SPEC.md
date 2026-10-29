# when2meet GET spec

The contract phases 1 and 2 of `W2M-SPEC.md` build on: how to recognise a when2meet event link, fetch it, read its grid, and fill it.

**Sources.** when2meet isn't reachable from the cloud session (the proxy refuses `www.when2meet.com` and `when2meet.com`). Everything here comes from pages Maxence captured on 2026-10-29, all from London:

| Fixture | What | How |
|---|---|---|
| `test/fixtures/w2m/weekdays.html` | Test event, days of the week, Mon–Fri, 09:00–17:00 | `curl -s` |
| `test/fixtures/w2m/dates.html` | Test event, dates, Mon 2 – Fri 6 Nov 2026, 09:00–17:00 Europe/London | `curl -s` |
| `test/fixtures/w2m/june.html` | Test event, dates, Tue 1 – Sat 5 Jun 2027, 09:00–17:00 Europe/London (summer time) | `curl -s` |
| `test/fixtures/w2m/ny.html` | Test event, dates, Mon 2 – Wed 4 Nov 2026, 18:00–23:00 America/New_York | `curl -s` |
| `test/fixtures/w2m/ny-grid.html` | The same event's grid as reloaded for a London browser | DevTools: the `AvailabilityGrids.php` response |
| `test/fixtures/w2m/missing.html` | `?99999999-ZZZZZ`, an event that doesn't exist | `curl -s` |
| `test/fixtures/w2m/home.html` | The "Plan a New Event" page, which when2meet returns for a query it can't read | `curl -s` |

Plus the response headers of an event page, from `curl -sI` (§6).

All the test events have 15-minute slots, nobody signed in, and no availability. Every fixture is the server's raw response, scrubbed (§8). Anything no capture shows is marked **(unverified)**.

---

## 1. Accepted URLs

Trim leading and trailing whitespace (spaces, tabs, newlines: pasted links often carry one), then match:

```
^https://(?:www\.)?when2meet\.com/\?([1-9][0-9]{0,11})-([A-Za-z0-9]{5})$
```

- Group 1 is the event **id** (8 digits on every event seen), group 2 the **code** (5 letters and digits on every event seen).
- Nothing else is normalised and nothing else is allowed: no other scheme, port, user info, path, extra query parameter or fragment. The `/?` form is the one when2meet itself prints in its share links.
- Codes of another length **(unverified)**: if when2meet ever issues one, it fails here as `W2M_URL`, which is visible and safe, and the `{5}` can be widened.
- The address fetched is always rebuilt from the groups as `https://www.when2meet.com/?<id>-<code>`, never the raw input.

## 2. Fetch

| | |
|---|---|
| Method | `GET` of the rebuilt URL. No body, no cookies. |
| Headers | `User-Agent: time.mutantcacti.com (+https://time.mutantcacti.com/help)`, `Accept: text/html` |
| Redirects | `redirect: "manual"`. Any 3xx is `W2M_STATUS_<n>`, so the server never follows when2meet to another address. |
| Timeout | 10 s, the same as the feeds (`FEED_FETCH`). Over it is `W2M_FETCH`. |
| Size limit | 8 MiB, read as a stream and abandoned past the limit: `W2M_TOO_LARGE`, not `W2M_PARSE`, so logs and the heartbeat can tell a huge event from a changed page. Each slot costs about 1 KB of HTML (two grid cells and two script lines), so a 62-day event at 15-minute slots for 24 hours a day (5,952 slots) is about 6 MB. The 160-slot test events are about 215 KB. |
| Non-2xx | `W2M_STATUS_<n>`. |

### 2.1 Missing event

Observed (`missing.html`): the body is when2meet's usual header, then `No such event! Please double-check your web address.`, and it stops there, with no closing `</body>` or `</html>`. The title is ` - When2meet` (an empty event name). The status is **200**, so the page's content, not its status, is what tells a missing event apart.

Rule, on a 2xx response:

| Page has | Result |
|---|---|
| `TimeOfSlot[0]=` | Parse it (§3). Any failure is `W2M_PARSE`. |
| No `TimeOfSlot[0]=` and no `id="NewEventNameDiv"` (the missing-event page) | `W2M_NOT_FOUND` |
| No `TimeOfSlot[0]=` but `id="NewEventNameDiv"` (the "Plan a New Event" page, `home.html`, which has a `NewEventNameDiv` around its name field) | `W2M_PARSE` |

A 404 isn't what when2meet sends for a missing event, but if it ever does, it's also `W2M_NOT_FOUND`. The parser never requires the document to be complete.

### 2.2 The grid in your zone

The GET response contains the grid rendered in the **event's** zone (`ny.html`: rows 6:00 PM–11:00 PM, slots labelled `EST`). In the browser, the page then compares that zone with the visitor's (`Intl…resolvedOptions().timeZone`), and if they differ it reloads the grid with `POST AvailabilityGrids.php` (`id`, `code`, `participantTimeZone`), replacing `#AvailabilityGrids`. The visitor can also change the zone select, which does the same.

So when2meet shows each person the grid **in their own zone**, and match mode does the same: it uses the viewer's zone (`tz` if pinned, else `dtz`). Phase 1 never calls `AvailabilityGrids.php`: the grid can be rebuilt from the slot list.

**Grid rule** (observed on the GET grids and on `ny-grid.html`). Given the slots and a zone Z:

- **Columns:** the civil dates in Z that hold at least one slot, ascending. Only those: dates with no slot get no column.
- **Rows:** the distinct times of day of the slots in Z, sorted by clock time from 00:00.
- **Breaks:** where two neighbouring rows are more than one slot length apart, when2meet draws a 36 px gap (`height:36px; border-top`) and restarts the hour labels.
- **Cells:** each (column, row) that is a slot gets a `YouTime<t>` cell with that slot's `data-time`. Every other position gets a grey placeholder with `data-col` and `data-row` but no `id`, no `data-time` and no `onmousedown` (it keeps `onmouseover="SelectToHere(event)"`, so a drag can pass over it).
- The slot list (`TimeOfSlot`) isn't sent again: the reloaded cells carry the same instants.

Worked example: `ny.html` in Europe/London. The event is 18:00–23:00 New York on 2–4 Nov, which is 23:00–04:00 London (UTC−5 against UTC+0).

| | Mon 2 Nov | Tue 3 Nov | Wed 4 Nov | Thu 5 Nov |
|---|---|---|---|---|
| rows 0–15: 00:00–03:45 | placeholder | slots | slots | slots |
| (break) | | | | |
| rows 16–19: 23:00–23:45 | slots | slots | slots | placeholder |

So 3 New York columns become 4 London columns, and the 60 slots fill 60 of the 80 positions. The rule reproduces `ny-grid.html` exactly.

Inferred from the rule but not observed: a viewer zone with a DST change during the event gives the union of both offsets' times of day, with placeholders where a day lacks one **(unverified)**.

Days-of-the-week events have no zone, so they're never reloaded (§3.3).

## 3. Parse contract

Every field below is read from the GET response. Any rule that fails is `W2M_PARSE`, and nothing partial is ever returned.

### 3.1 Slot list (`slots`)

From the page's main inline script:

```
TimeOfSlot[0]=279795600;
AvailableAtSlot[0]=new Array();
TimeOfSlot[1]=279796500;
…
```

- Regex over the page text: `/TimeOfSlot\[(\d+)\]=(\d+);/g`. Ignore `AvailableAtSlot` lines (§7).
- Indices must run 0, 1, … n−1 with no gaps or repeats, and n ≥ 1.
- Values are Unix times in seconds, and must be strictly increasing.
- Each value is the **start** of a slot. For a dates event it's a real instant (§3.4). For a days-of-the-week event it's a wall-clock time encoded as UTC (§3.3).

### 3.2 Grid cells (cross-check)

Each slot has two cells, one per grid. As the server sends them (mixed quoting):

```html
<div id='YouTime1793610000' data-col="0" data-row="0" data-time="1793610000" onmousedown='SelectFromHere(event);' …></div>
<div id='GroupTime1793610000' data-col="0" data-row="0" data-time="1793610000" onmouseover='ShowSlot(1793610000,"Mon 02 Nov 2026 09:00:00 AM GMT");' …></div>
```

- Read the cells with Workers' `HTMLRewriter`, not regexes: selector `div[id^="YouTime"]`, then `getAttribute` for `id`, `data-col`, `data-row` and `data-time`. It copes with the quoting and attribute order. Run it over the same size-limited text the slot regex reads.
- The id's number must equal `data-time`, and the set of `data-time` values must equal the slot list exactly.
- The positions must be the grid rule's (§2.2) for the event's zone (dates) or for UTC (days of the week). In the event's own zone every column has the same rows, so this is simply: R rows per column, and slot `i` at `col = ⌊i / R⌋`, `row = i mod R`.
- `GroupTime` cells aren't read: their colour shows how many people are free (§7).

### 3.3 Event kind (`kind`)

Two signals, which must agree:

| Signal | Days of the week | Specific dates |
|---|---|---|
| The `DOMContentLoaded` handler in the main script | Adds one option, `"UTC"`, to `#ParticipantTimeZone` | Calls `loadTimezoneOptions("ParticipantTimeZone")` and contains `if (select.value != "<zone>")` |
| First slot | Before 1980-01-01 (the test event: November 1978) | After |

For a days-of-the-week event, when2meet stores times on fixed dates in **1978** (the test event's Monday is 1978-11-13) and treats them as UTC wall-clock times with no real zone. The "Plan a New Event" page confirms there's no zone: for these events it hides the zone select and says "For 'Days of the Week' events, it is expected that all participants are in a single time zone" (`home.html`). Its weekday picker stores days as `0`–`6` from Sunday, so Sunday is probably 1978-11-12 **(unverified)**. Read the weekday of each column as the UTC weekday of its first slot, never from the date.

### 3.4 Time zone (`zone`)

- **Specific dates:** the zone in `if (select.value != "<zone>")`, regex `/select\.value != "([^"]+)"/`. It must be a zone Intl accepts.
  - It's the zone chosen when the event was made: `Europe/London` on the London events, `America/New_York` on the New York one. The "Plan a New Event" page asks for it, defaulting to the creator's browser zone (`home.html`).
  - `TimeOfSlot` values are **real instants**. The June event (09:00 London in summer time) starts at `1811836800`, which is 08:00 UTC, and its slots are labelled `BST`; the November one starts at 09:00 UTC, labelled `GMT`.
  - Match mode draws the grid in the viewer's zone, not this one (§2.2). The event zone is still parsed: the cross-check in §3.2 needs it, and the toast says when the two zones differ.
- **Days of the week:** no zone. Phase 1 reads the slots as wall-clock times (the UTC fields of each value) and places them, in the viewer's zone, on the week the viewer picks (`W2M-SPEC.md` §1.3).

### 3.5 Days (`days`)

One per column of the GET grid, in column order. For column `c`, take its first slot `s = slots[c·R]`:

- dates: the civil date of `s` in `zone`;
- weekdays: the UTC weekday of `s` (Monday … Sunday).

Dates must be strictly increasing. They needn't be consecutive: a dates event can skip days, so match mode draws **only the grid rule's columns**, never a continuous Range from the first day to the last.

### 3.6 Slot length (`slotSeconds`)

Parsed, never assumed. (The "Plan a New Event" page has no slot-length setting, only "No earlier than" and "No later than" in whole hours, so slots are probably always 15 minutes. The parser still measures them.)

1. **Step:** within each column of the GET grid, the difference between consecutive slots. Every one, in every column, must be the same value L, and L must be a whole number of minutes between 1 and 60.
2. **Span:** for each column, `(last slot − first slot) ÷ (R − 1)` must equal L.

If R = 1 there's no step to measure, so that's `W2M_PARSE` (whether when2meet allows one-slot days is **(unverified)**; with whole-hour bounds a day has at least 4 slots). Steps between columns aren't checked against L.

A column can cross midnight in UTC (`ny.html`: 23:00Z to 03:45Z the next day) and still be one column, because columns are the event zone's dates. For a dates event the step is measured in real seconds, so it stays L across a DST change.

### 3.7 First and last slot

- `first = slots[0]`
- `last = slots[n−1]`, which ends at `slots[n−1] + L`.

Per day, `slots[c·R]` to `slots[c·R + R − 1] + L`.

### 3.8 Labels (optional cross-check)

The grid's left edge has hour labels, one every `3600 ÷ L` rows, for example `9:00  AM&nbsp;` (two spaces, then `&nbsp;`). For a dates event, the first label should be the wall-clock time of `slots[0]` in `zone`. Phase 1 may check this, but must not depend on it: it's display text.

### 3.9 Fill-contract check (`fill`)

The same parse also checks that the page still has what phase 2 relies on (§4). The page text must contain all of:

- `function SelectFromHere(`, `function SelectToHere(`, `function SelectStop(`
- `"SaveTimes.php"`
- `var UserID`

If any is missing, the result carries `fill: "drift"` instead of `fill: "ok"`. Match mode ignores it (it doesn't need them); the heartbeat reports it as `W2M_FILL_DRIFT` (§9).

### 3.10 Worked examples

| Field | `weekdays.html` | `dates.html` | `june.html` | `ny.html` |
|---|---|---|---|---|
| kind | weekdays | dates | dates | dates |
| zone | none | `Europe/London` | `Europe/London` | `America/New_York` |
| slots | 160: `279795600` … `280169100` | 160: `1793610000` … `1793983500` | 160: `1811836800` … `1812210300` | 60: `1793660400` … `1793850300` |
| R × columns | 32 × 5 | 32 × 5 | 32 × 5 | 20 × 3 |
| days | Mon–Fri | 2–6 Nov 2026 | 1–5 Jun 2027 | 2–4 Nov 2026 |
| step, span | 900, 900 ✓ | 900, 900 ✓ | 900, 900 ✓ | 900, 900 ✓ |
| hours | 09:00–17:00 (no zone) | 09:00–17:00 (09:00Z) | 09:00–17:00 (08:00Z) | 18:00–23:00 (23:00Z) |
| first label | `9:00  AM` | `9:00  AM` ✓ | `9:00  AM` ✓ | `6:00  PM` ✓ |
| fill | ok | ok | ok | ok |

Spans, column 0: weekdays (279823500 − 279795600) ÷ 31; dates (1793637900 − 1793610000) ÷ 31; ny (1793677500 − 1793660400) ÷ 19. All 900.

**Missing event** (`missing.html`): no `TimeOfSlot[0]=`, no `NewEventNameDiv` → `W2M_NOT_FOUND`.

**Not an event** (`home.html`): no `TimeOfSlot[0]=`, but a `NewEventNameDiv` → `W2M_PARSE`.

## 4. Fill contract (phase 2)

All of this is the page's own inline script; the handlers are the same for mouse and touch. Phase 2 reads the grid from the page's own cells (`data-col`, `data-row`, `data-time`), so it works whichever zone the page has reloaded the grid in.

### 4.1 State

Globals: `UserID` (0 until signed in), `TimeOfSlot`, `AvailableAtSlot` (per slot, an array of the person ids available), `IsMouseDown`, `FromCol`, `FromRow`, `ToCol`, `ToRow`, `ChangeToAvailable`.

### 4.2 Selecting

| Step | Mouse | Touch |
|---|---|---|
| Start | `onmousedown` on a `YouTime…` cell → `SelectFromHere(event)` | `ontouchstart` → `SelectFromHereByTouch(event)` → `SelectFromHere(event)` (one finger only) |
| Extend | `onmouseover` on another cell → `SelectToHere(event)` | `ontouchmove` → `SelectToHereByTouch(event)`: finds the cell under the finger with `document.elementFromPoint`, so it must be on screen |
| Stop | `document.onmouseup = SelectStop` | `ontouchend` → `SelectStopByTouch(event)` → `SelectStop()` |

What each function reads from its event (quoted from the page):

| Function | Reads | Code |
|---|---|---|
| `SelectFromHere(e)` | `e.target` only | `e.target.getAttribute("data-time")`, `"data-col"`, `"data-row"` |
| `SelectToHere(e)` | `e.target` only, and only while `IsMouseDown` | `e.target.getAttribute("data-col")`, `"data-row"` |
| `SelectStop()` | nothing (no argument) | |
| `SelectFromHereByTouch(event)` | `event.touches.length`, then passes `event` on | `if (event.touches.length==1) { SelectFromHere(event); }` |
| `SelectToHereByTouch(event)` | `event.touches`, `event.preventDefault()`, `touches[0].clientX` and `clientY` | `document.elementFromPoint(touch.clientX, touch.clientY)` |
| `SelectStopByTouch(event)` | nothing | `SelectStop();` |

None reads `button`, `which`, modifier keys or coordinates on the mouse path. So `{ target: cell }` is a faithful stand-in for the mouse functions, and phase 2 should check this table still holds (by `fill: "ok"`, §3.9, plus `typeof SelectFromHere === "function"` and so on) before filling.

Behaviour:

- `SelectFromHere` sets `ChangeToAvailable` to the **opposite of the start cell's current state** for this person (`-1 == AvailableAtSlot[slotID].indexOf(UserID)`).
- A drag selects the **rectangle** from the start cell to the current cell (columns × rows).
- `SelectStop` walks `TimeOfSlot` and sets every slot whose cell is in the rectangle to `ChangeToAvailable`. Placeholders (§2.2) have no slot, so they're skipped. Slots already in that state stay as they are.

### 4.3 Fill order

Call the page's functions directly: `SelectFromHere({ target: a })`, `SelectToHere({ target: b })`, `SelectStop()`. This works the same on desktop and mobile and doesn't need the cells on screen. Synthetic `mousedown` on `a`, `mouseover` on `b` and `mouseup` on `document` are the fallback.

Fill makes the grid match time. exactly: free slots marked available, busy slots cleared (Maxence's answer, 2026-10-29). For each column, split the slot cells, in row order, into runs of neighbouring rows that share **both** their current state and their target state, and drag only the runs where the two differ:

- currently unavailable, should be free → drag; the start cell is unavailable, so `ChangeToAvailable` is true;
- currently available, should be busy → drag; the start cell is available, so `ChangeToAvailable` is false.

Every cell in a run has the same current state, so the start cell always sets the right direction. A placeholder or a break ends a run. Slots already right are never touched. The overlay states both counts ("Mark 23 slots as available and clear 4?").

### 4.4 Saving

There's no save button. `SelectStop` saves at once, with one `POST SaveTimes.php` per drag:

| Field | Value |
|---|---|
| `person` | `UserID` |
| `event` | event id |
| `slots` | the slot times in the rectangle, comma-separated |
| `availability` | one `0`/`1` per slot in `TimeOfSlot` order: this person's whole availability after the change |
| `password` | the sign-in form's password field |
| `ChangeToAvailable` | `true` or `false` |

The response is only logged to the console; a failure isn't shown on the page. Each POST carries the person's whole availability, so if the server applies `availability` as given, POSTs arriving out of order could undo each other **(unverified)**: §11, Q5.

Phase 2 waits for each save to finish before the next drag, without touching the page's own code (no wrapping `window.fetch`):

- `SelectStop` updates `AvailableAtSlot` synchronously, before its POST is even sent, so polling `AvailableAtSlot` can't tell when a save has landed.
- Instead, watch the browser's resource timing with a `PerformanceObserver` (`type: "resource"`), which only reads. Each finished `SaveTimes.php` request adds one entry. After each `SelectStop()`, wait for one new entry before the next drag. If none arrives within 10 s, stop and say how many drags were saved. That a same-origin `fetch` shows up there is standard, but **(unverified)** on this page.
- If Q5 shows the server applies `availability` whole, the waits are what make the last POST the one that counts.

## 5. Sign-in

- Painting needs `UserID ≠ 0`. Until then `#SignIn` shows and `#YouGrid` is hidden.
- `ProcessLogin()` posts `ProcessLogin.php` with `id`, `name` and `password`. A numeric response is the person id: it's put in `UserID`, `#SignIn` is hidden and `#YouGrid` shown. Anything else is shown with `alert()`.
- State is held only in page globals. Nothing in the page's script sets a cookie or uses storage, and the event page's headers set none; whether `ProcessLogin.php` does is **(unverified)**.
- Phase 2 refuses to run while `UserID` is 0 (or `#YouGrid` is hidden).

## 6. Headers

Observed on an event page with `curl -sI`:

```
HTTP/2 200
content-type: text/html; charset=utf-8
last-modified: <now>
server: Apache/2.4.69 (Amazon Linux) OpenSSL/3.5.8
expires: Mon, 26 Jul 1997 05:00:00 GMT
cache-control: no-store, no-cache, must-revalidate, post-check=0, pre-check=0
x-cache: Miss from cloudfront
via: 1.1 ….cloudfront.net (CloudFront)
```

| Header | Seen | So |
|---|---|---|
| `Content-Security-Policy` | none | Nothing stops a bookmarklet from fetching `https://time.mutantcacti.com`. |
| `X-Frame-Options`, `frame-ancestors` | none | The page can be framed (not needed by any phase). |
| `Access-Control-Allow-Origin` | none | Irrelevant: the server-side fetch doesn't use CORS, and the bookmarklet's fetch needs CORS from time., not from when2meet. |
| `Cache-Control` | `no-store, no-cache, must-revalidate`, plus an `Expires` in 1997 | Every request reaches when2meet's server (CloudFront `Miss`). time.'s own few-minute cache of the parsed structure (`W2M-SPEC.md` §1.2) is what saves refetches; it caches the result, never the page, so `no-store` is respected. |
| `set-cookie` | none | The GET needs no session. |

Phase 2 still handles a blocked fetch as `W2M-SPEC.md` §2.2 says, in case a CSP is added later.

## 7. Privacy

Event pages contain other people's names and availability. The parser reads only §3's fields and **ignores**:

- `PeopleNames` and `PeopleIDs` (names and ids of everyone who has signed in), and the `UserID` value;
- the contents of every `AvailableAtSlot[i]` and `AvailableIDs` (who is free when);
- `#Available`, `#Unavailable` and `#UserName` (filled with names on hover or sign-in);
- the `style` and colours of `YouTime…` and `GroupTime…` cells (a group cell's colour shows how many people are free);
- the event's title, share links and every other part of the page.

The parser extracts the §3 fields with the slot regex and `HTMLRewriter`, and drops the page. It never keeps the HTML (phase 1 caches only the parsed structure), and logs only the event id.

## 8. Fixtures

`test/fixtures/w2m/*.html` are the raw captures with:

- every Google script (analytics, ads, Google+, conversion tracking) removed, plus the ad `<ins>`;
- the real event ids and codes replaced with `10000001-Test1` (weekdays), `10000002-Test2` (dates), `10000003-Test3` (june) and `10000004-Test4` (ny). Anyone with an event's link can edit it, so the real ones stay out of the repo, as in `W2M-SPEC.md` phase 3;
- trailing spaces at line ends removed;
- any text after `#Available`, `#Unavailable` and `#UserName` cleared, and every `AvailableAtSlot[i]` emptied. Nobody had signed in on any test event, so there was nothing to remove; the scrub enforces it anyway.

Nothing else is changed: the grid is tested as the server sends it.

`test/w2m-fixtures.test.ts` checks all of the above, plus a deny-list of names for when Maxence signs in on the test events (empty for now). Raw captures are never committed.

## 9. Failure modes

| What when2meet changes | What breaks | Detected as |
|---|---|---|
| Link format (id length, code length or characters) | §1 | `W2M_URL` for valid links (visible; widen the regex) |
| Event page moved, or a missing event answered with a redirect or error | §2 | `W2M_STATUS_<n>` |
| The missing-event page reworded or restructured | §2.1 | Still `W2M_NOT_FOUND` while it has neither marker; `W2M_PARSE` if it gains a `NewEventNameDiv` |
| `TimeOfSlot[i]=…;` renamed, reformatted or moved out of the page | §3.1 | No slots → `W2M_NOT_FOUND` if `NewEventNameDiv` is also gone, else `W2M_PARSE` |
| Slot ids or `data-*` attributes renamed | §3.2 | Cell set ≠ slot set → `W2M_PARSE` |
| The grid laid out differently (columns no longer the zone's dates, rows no longer times of day) | §2.2, §3.2 | The position cross-check fails → `W2M_PARSE`, so match mode never draws a grid that disagrees with when2meet's |
| Zone handling rewritten (`loadTimezoneOptions`, the `"UTC"` option, the `select.value != "…"` test) | §3.3–3.4 | Kind signals disagree, or a dates event with no valid zone → `W2M_PARSE` |
| Days-of-the-week events stored off 1978 | §3.3 | First-slot signal disagrees with the handler signal → `W2M_PARSE` |
| Uneven slots | §3.6 | Step or span check → `W2M_PARSE` |
| Page grows past 8 MiB | §2 | `W2M_TOO_LARGE` |
| `SelectFromHere`, `SelectToHere` or `SelectStop` renamed or removed | §4.2 | `fill: "drift"` → the heartbeat raises `W2M_FILL_DRIFT`; phase 2 also checks `typeof` before filling and says it can't fill this page |
| What those functions read from the event changes (for example `SelectFromHere` starts checking `e.button`) | §4.2 | Not detectable by text alone; phase 2's Playwright runs on the fixtures catch it when the fixtures are refreshed |
| Saving moved to a button, or to another endpoint | §4.4 | `SaveTimes.php` gone from the page → `fill: "drift"` → `W2M_FILL_DRIFT` |
| Sign-in reworked (`UserID`, `#YouGrid`) | §5 | `var UserID` gone → `W2M_FILL_DRIFT`; phase 2 can't tell anyone is signed in → refuses with "sign in first" |

## 10. Stability signals

- No version number anywhere in the page, and `no-store` on every response.
- The page's script has a comment `/******* STUFF WRITTEN FOR NEW VERSION *******/` above the grid code, and that code uses `fetch` and `URLSearchParams`, while older parts use `new Array()` and IE `*display` hacks. Grid loading, sign-in and saving have been rewritten fairly recently.
- The participant time-zone select (`participantTimeZone`, `Intl.supportedValuesOf`) and the "Plan a New Event" page's translations (`data-i18n`, `/locales/<lang>.json`) also look recent, and are the parts most likely to change again.

## 11. Open questions

| | Question | Status | Settled by |
|---|---|---|---|
| Q1 | Response headers | **Answered** (§6) | |
| Q2 | What a missing event returns | **Answered**: status 200, with the page in `missing.html` (§2.1) | |
| Q3 | Whether `TimeOfSlot` is a real instant | **Answered: yes** (§3.4, `june.html`) | |
| Q4 | Whether the fixtures match the server's raw HTML | **Answered**: they are the raw HTML now (§8). The earlier browser saves matched it apart from quoting and the page's own on-load changes. | |
| Q5 | Whether `SaveTimes.php` cares what order its POSTs arrive in | Open. Maxence has allowed deliberate out-of-order drags on the test events, but the session can't reach when2meet. | Phase 2's Playwright run against the live test event, from a machine that can reach it. |
| Q6 | How the reloaded grid looks in another zone | **Answered** (§2.2, `ny-grid.html`) | |
