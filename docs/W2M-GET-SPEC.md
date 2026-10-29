# when2meet GET spec

The contract phases 1 and 2 of `W2M-SPEC.md` build on: how to recognise a when2meet event link, fetch it, read its grid, and fill it.

**Sources.** when2meet isn't reachable from the cloud session (the proxy refuses `www.when2meet.com` and `when2meet.com`). Everything here comes from two pages Maxence saved from their browser on 2026-10-29, with "Save page as… complete":

| Fixture | Event kind | Days | Hours (as shown) |
|---|---|---|---|
| `test/fixtures/w2m/weekdays.html` | Days of the week | Mon–Fri | 09:00–17:00 |
| `test/fixtures/w2m/dates.html` | Specific dates | Mon 2 – Fri 6 Nov 2026 | 09:00–17:00 |

Both have 15-minute slots, nobody signed in, and no availability. The `_files` folders that came with them hold only Google analytics, ads and Google+ scripts, two stylesheets and some images, and none of it is needed. The pages' own logic is all inline.

Anything that needs the live site (response headers, a missing event, the grid endpoint's response) is marked **(unverified)**. A saved page is the browser's DOM after its scripts ran, not the server's raw response. Where the scripts changed the page, the fixtures undo it (§8). Phase 1 should re-check the **(unverified)** items against the live site the first time it can reach it.

---

## 1. Accepted URLs

```
^https://(?:www\.)?when2meet\.com/\?([1-9][0-9]{0,11})-([A-Za-z0-9]{5})$
```

- Group 1 is the event **id** (8 digits on both test events), group 2 the **code** (5 letters and digits on both).
- Nothing else is allowed: no other scheme, port, user info, path, extra query parameter or fragment. A trailing slash before `?` (`/?`) is required, because that's the form when2meet itself prints in the page's share links.
- Codes of another length **(unverified)**: if when2meet ever issues one, it fails here as `W2M_URL`, which is visible and safe, and the `{5}` can be widened.
- The address fetched is always rebuilt from the groups as `https://www.when2meet.com/?<id>-<code>`, never the raw input.

## 2. Fetch

| | |
|---|---|
| Method | `GET` of the rebuilt URL. No body, no cookies. |
| Headers | `User-Agent: time.mutantcacti.com (+https://time.mutantcacti.com/help)`, `Accept: text/html` |
| Redirects | `redirect: "manual"`. Any 3xx is `W2M_STATUS_<n>`, so the server never follows when2meet to another address. |
| Timeout | 10 s, the same as the feeds (`FEED_FETCH`). Over it is `W2M_FETCH`. |
| Size limit | 8 MiB, read as a stream and abandoned past the limit (`W2M_PARSE`). Each slot costs about 1 KB of HTML (two grid cells and two script lines), so a 62-day event at 15-minute slots for 24 hours a day (5,952 slots) is about 6 MB. The test pages are about 215 KB each. |
| Non-2xx | `W2M_STATUS_<n>`. |
| Missing event | **(unverified)**. The page's own code has no "not found" branch, so the server probably answers 200 with a page that lacks the event. Rule: a 200 page with no `TimeOfSlot[0]=` **and** no `id="NewEventNameDiv"` is `W2M_NOT_FOUND`. A page with either one but not a valid grid is `W2M_PARSE`. |

The GET response already contains the full grid. `#AvailabilityGrids` is server-rendered; the page only reloads it (§2.1) when the visitor's zone differs from the event's. Phase 1 needs only this one GET.

### 2.1 The grid endpoint (not used)

The page reloads the grid with `POST AvailabilityGrids.php` (`id`, `code`, `participantTimeZone`) and replaces `#AvailabilityGrids` with the response. That happens on load for a dates event when the browser's zone isn't the event's zone, and whenever the visitor changes the zone select. Phase 1 doesn't call it: it would be a POST, and it isn't needed.

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

- Regex: `/TimeOfSlot\[(\d+)\]=(\d+);/g`. Ignore `AvailableAtSlot` lines (§7).
- Indices must run 0, 1, … n−1 with no gaps or repeats, and n ≥ 1.
- Values are Unix times in seconds, and must be strictly increasing.
- Each value is the **start** of a slot. For a dates event it's a real instant (§3.4). For a days-of-the-week event it's a wall-clock time encoded as UTC (§3.3).

### 3.2 Grid cells (cross-check)

Each slot has two cells, one per grid:

```html
<div id="YouTime279795600" data-col="0" data-row="0" data-time="279795600" onmousedown="SelectFromHere(event);" …></div>
<div id="GroupTime279795600" data-col="0" data-row="0" data-time="279795600" onmouseover='ShowSlot(279795600,"Monday 09:00:00 AM");' …></div>
```

- Read every element whose `id` matches `YouTime(\d+)`, and its `data-col`, `data-row` and `data-time` attributes in any order. The id's number must equal `data-time`.
- The set of `data-time` values must equal the slot list exactly.
- `data-col` is the day (0-based, left to right). `data-row` is the slot within the day (0-based, top to bottom).
- Every column must have the same number of rows, R. The slot list is column by column, so slot `i` must be at `col = ⌊i / R⌋`, `row = i mod R`. (The HTML itself lists the cells row by row, but the parser shouldn't depend on that order.)
- `GroupTime` cells aren't read: their colour shows how many people are free (§7).

### 3.3 Event kind (`kind`)

Two signals, which must agree:

| Signal | Days of the week | Specific dates |
|---|---|---|
| The `DOMContentLoaded` handler in the main script | Adds one option, `"UTC"`, to `#ParticipantTimeZone` | Calls `loadTimezoneOptions("ParticipantTimeZone")` and contains `if (select.value != "<zone>")` |
| First slot | Before 1980-01-01 (both test events: November 1978) | After |

For a days-of-the-week event, when2meet stores times on fixed dates in **1978** (the test event's Monday is 1978-11-13) and treats them as UTC wall-clock times with no real zone. The weekday of each column is the UTC weekday of its first slot. Don't rely on the calendar date: which week of 1978 is used for a Sunday-first event is **(unverified)**.

### 3.4 Time zone (`zone`)

- **Specific dates:** the zone in `if (select.value != "<zone>")`, regex `/select\.value != "([^"]+)"/`. It must be a zone Intl accepts. On the test event, `Europe/London`. That this is the event's own zone (the creator's) rather than a site-wide default is **(unverified)**, but it's the zone the server rendered the grid's labels in.
  - `TimeOfSlot` values are real instants, not wall-clock times **(inferred, unverified)**. The test event is in November, when London is UTC+0, so it can't show the difference by itself. But the slot list lives in the main page script and isn't reloaded when the grid is reloaded in another zone, while `SelectFromHere` looks each cell's `data-time` up in it. So the times must mean the same instant in every zone. A saved summer (BST) dates event would settle it.
- **Days of the week:** no zone. Phase 1 reads the slots as wall-clock times (UTC fields of each value) and places them in the viewer's zone. The `"UTC"` option is when2meet's marker for this, not a real zone.

### 3.5 Days (`days`)

One per column, in column order. For column `c`, take its first slot `s = slots[c·R]`:

- dates: the civil date of `s` in `zone`;
- weekdays: the UTC weekday of `s` (Monday … Sunday).

Dates must be strictly increasing. Days needn't be consecutive (a dates event can skip days).

### 3.6 Slot length (`slotSeconds`)

Parsed, never assumed:

1. **Step:** within each column, the difference between consecutive slots. Every one, in every column, must be the same value L, and L must be a whole number of minutes between 1 and 60.
2. **Span:** for each column, `(last slot − first slot) ÷ (R − 1)` must equal L.

If R = 1 there's no step to measure, so that's `W2M_PARSE` (whether when2meet allows one-slot days is **(unverified)**). Steps between columns (from one day's last slot to the next day's first) aren't checked against L: they're just later.

For a dates event the step is measured in real seconds, so it stays L across a DST change.

### 3.7 First and last slot

- `first = slots[0]`
- `last = slots[n−1]`, which ends at `slots[n−1] + L`.

Per day, `slots[c·R]` to `slots[c·R + R − 1] + L`.

### 3.8 Labels (optional cross-check)

The grid's left edge has hour labels, one every `3600 ÷ L` rows, for example `9:00  AM&nbsp;` (two spaces, then `&nbsp;`). For a dates event, the first label should be the wall-clock time of `slots[0]` in `zone`. Phase 1 may check this, but must not depend on it: it's display text.

### 3.9 Worked examples

**Days of the week** (`weekdays.html`):

| Field | Value |
|---|---|
| kind | weekdays (one `"UTC"` option; first slot 279795600 is 1978-11-13) |
| zone | none |
| slots | 160: `TimeOfSlot[0]=279795600` … `TimeOfSlot[159]=280169100` |
| R | 32 rows; 5 columns |
| days | Mon, Tue, Wed, Thu, Fri (UTC weekdays of 279795600, 279882000, 279968400, 280054800, 280141200) |
| step | 900 everywhere within a column → L = 900 |
| span | column 0: (279823500 − 279795600) ÷ 31 = 900 ✓ |
| hours | 09:00 (1978-11-13T09:00Z) to 17:00 (280169100 + 900 = 1978-11-17T17:00Z) |
| between days | 58,500 s (86,400 − 31 × 900), not checked |

**Specific dates** (`dates.html`):

| Field | Value |
|---|---|
| kind | dates (`loadTimezoneOptions` call; first slot 1793610000 is 2026) |
| zone | `Europe/London` |
| slots | 160: `TimeOfSlot[0]=1793610000` … `TimeOfSlot[159]=1793983500` |
| R | 32 rows; 5 columns |
| days | 2026-11-02 … 2026-11-06 (Mon–Fri) |
| step | 900 → L = 900 |
| span | column 0: (1793637900 − 1793610000) ÷ 31 = 900 ✓ |
| hours | 09:00–17:00 London time (2026-11-02T09:00Z; UTC+0 in November) |
| labels | first `9:00  AM`, matching 09:00 in Europe/London ✓ |

## 4. Fill contract (phase 2)

All of this is the page's own inline script; the handlers are the same for mouse and touch.

### 4.1 State

Globals: `UserID` (0 until signed in), `TimeOfSlot`, `AvailableAtSlot` (per slot, an array of the person ids available), `IsMouseDown`, `FromCol`, `FromRow`, `ToCol`, `ToRow`, `ChangeToAvailable`.

### 4.2 Selecting

| Step | Mouse | Touch |
|---|---|---|
| Start | `onmousedown` on a `YouTime…` cell → `SelectFromHere(event)` | `ontouchstart` → `SelectFromHereByTouch(event)` → `SelectFromHere(event)` (one finger only) |
| Extend | `onmouseover` on another cell → `SelectToHere(event)` | `ontouchmove` → `SelectToHereByTouch(event)`: finds the cell under the finger with `document.elementFromPoint`, so it must be on screen |
| Stop | `document.onmouseup = SelectStop` | `ontouchend` → `SelectStopByTouch(event)` → `SelectStop()` |

- `SelectFromHere` reads the cell's `data-time`, `data-col` and `data-row`. It sets `ChangeToAvailable` to the **opposite of the start cell's current state** for this person.
- A drag selects the **rectangle** from the start cell to the current cell (columns × rows).
- `SelectStop` sets every slot in the rectangle to `ChangeToAvailable`. Slots already in that state stay as they are.

**Fill order.** Call the page's functions directly, with `{ target: cell }` standing in for the event: `SelectFromHere({ target: a })`, `SelectToHere({ target: b })`, `SelectStop()`. This works the same on desktop and mobile, and doesn't need the cells on screen. Synthetic `mousedown` on `a`, `mouseover` on `b` and `mouseup` on `document` are the fallback.

For each column, find the runs of consecutive slots that should be **available** and currently **aren't** (`AvailableAtSlot[i].indexOf(UserID) == -1`). Drag each run from its first cell to its last. Each run starts on an unavailable cell, so `ChangeToAvailable` is always true and nothing is ever removed. Slots already available are left alone; time. never marks anything unavailable.

### 4.3 Saving

There's no save button. `SelectStop` saves at once, with one `POST SaveTimes.php` per drag:

| Field | Value |
|---|---|
| `person` | `UserID` |
| `event` | event id |
| `slots` | the slot times in the rectangle, comma-separated |
| `availability` | one `0`/`1` per slot in `TimeOfSlot` order: this person's whole availability after the change |
| `password` | the sign-in form's password field |
| `ChangeToAvailable` | `true` or `false` |

The response is only logged to the console, and a failure isn't shown on the page. Each POST carries the person's whole availability, so if the server applies `availability` as given, POSTs arriving out of order could undo each other **(unverified)**. Phase 2 should wait for each save's response before starting the next drag, for example by wrapping `window.fetch` for the duration of the fill.

## 5. Sign-in

- Painting needs `UserID ≠ 0`. Until then `#SignIn` shows and `#YouGrid` is hidden.
- `ProcessLogin()` posts `ProcessLogin.php` with `id`, `name` and `password`. A numeric response is the person id: it's put in `UserID`, `#SignIn` is hidden and `#YouGrid` shown. Anything else is shown with `alert()`.
- State is held only in page globals. Nothing in the page's script sets a cookie or uses storage; whether the server sets a cookie is **(unverified)**.
- Phase 2 refuses to run while `UserID` is 0 (or `#YouGrid` is hidden).

## 6. Headers

All **(unverified)**: they can't be seen in a saved page.

| Header | Why it matters | Check |
|---|---|---|
| `Content-Security-Policy` (`connect-src`, `script-src`) | Whether a bookmarklet may `fetch` `https://time.mutantcacti.com` | `curl -sI https://www.when2meet.com/?<id>-<code>` |
| `X-Frame-Options`, CSP `frame-ancestors` | Whether the page can be framed | as above |
| `Access-Control-Allow-Origin` | Not needed: the server-side fetch doesn't use CORS | as above |

The page loads Google scripts from several origins and runs large inline scripts, so a strict CSP seems unlikely, but phase 2 must still handle a blocked fetch as `W2M-SPEC.md` §2.2 says.

## 7. Privacy

Event pages contain other people's names and availability. The parser reads only §3's fields and **ignores**:

- `PeopleNames` and `PeopleIDs` (names and ids of everyone who has signed in), and the `UserID` value;
- the contents of every `AvailableAtSlot[i]` and `AvailableIDs` (who is free when);
- `#Available`, `#Unavailable` and `#UserName` (filled with names on hover or sign-in);
- the `style` and colours of `YouTime…` and `GroupTime…` cells (a group cell's colour shows how many people are free);
- the event's title, share links and every other part of the page.

The parser should extract the §3 fields with targeted regexes and drop the page. It never keeps the HTML (phase 1 caches only the parsed structure), and logs only the event id.

## 8. Fixtures

`test/fixtures/w2m/{weekdays,dates}.html` are the two saved pages, scrubbed:

- every Google script (analytics, ads, Google+), the ad `<ins>`, `<iframe>`, stylesheet links and `_files/` image sources removed;
- the real event ids and codes replaced with `10000001-Test1` and `10000002-Test2` (anyone with an event's link can edit it, so the real ones stay out of the repo, as in `W2M-SPEC.md` phase 3);
- the page's own on-load changes undone, back to what the server sent **(unverified)**: the time-zone select emptied and hidden, `#YourTimeZone` reset;
- hover state undone: `#SlotAvailability` hidden, `#LeftPanel` shown, `#AvailableDate` emptied;
- every `AvailableAtSlot[i]` empty, no `PeopleNames`/`PeopleIDs` entries, `#Available`, `#Unavailable` and `#UserName` empty. (Nobody had signed in on either event, so there was nothing to remove.)

`test/w2m-fixtures.test.ts` checks all of the above, plus a deny-list of names for when Maxence signs in on the test events (empty for now). The raw saved pages aren't committed.

## 9. Failure modes

| What when2meet changes | What breaks | Detected as |
|---|---|---|
| Link format (id length, code length or characters) | §1 | `W2M_URL` for valid links (visible; widen the regex) |
| Event page moved, or a missing event answered with a redirect or error | §2 | `W2M_STATUS_<n>` |
| `TimeOfSlot[i]=…;` renamed, reformatted or moved out of the page | §3.1 | No slots → `W2M_NOT_FOUND` if `NewEventNameDiv` is also gone, else `W2M_PARSE` |
| Slot ids or `data-*` attributes renamed | §3.2 | Cell set ≠ slot set → `W2M_PARSE` |
| Slots no longer column by column, or columns of unequal length | §3.2 | Position check fails → `W2M_PARSE` |
| Zone handling rewritten (`loadTimezoneOptions`, the `"UTC"` option, the `select.value != "…"` test) | §3.3–3.4 | Kind signals disagree, or a dates event with no valid zone → `W2M_PARSE` |
| Days-of-the-week events stored off 1978 | §3.3 | First-slot signal disagrees with the handler signal → `W2M_PARSE` |
| Uneven slots | §3.6 | Step or span check → `W2M_PARSE` |
| Page grows past 8 MiB | §2 | `W2M_PARSE` |
| `SelectFromHere`, `SelectToHere` or `SelectStop` renamed or changed | §4 | Phase 2 checks `typeof … === "function"` and the cells' `data-*` before filling; otherwise it says it can't fill this page |
| Saving changed to a button | §4.3 | **(unverified)** detection; phase 2's heartbeat (phase 3) should catch it |
| Sign-in reworked (`UserID`, `#YouGrid`) | §5 | Phase 2 can't tell anyone is signed in → refuses with "sign in first" |

## 10. Stability signals

- No version number anywhere in the page.
- The page's script has a comment `/******* STUFF WRITTEN FOR NEW VERSION *******/` above the grid code, and that code uses `fetch` and `URLSearchParams`, while older parts use `new Array()` and IE `*display` hacks. Grid loading, sign-in and saving have been rewritten fairly recently.
- The participant time-zone select (`participantTimeZone`, `Intl.supportedValuesOf`) also looks recent, and is the part most likely to change again.

## 11. Open questions (need the live site)

1. Response headers (§6).
2. What a missing or deleted event returns (§2).
3. Whether `TimeOfSlot` is a real instant for a dates event in summer time (§3.4). A saved BST event (for example 1–5 June) would settle this without the live site.
4. Whether the fixtures match the server's raw HTML (§8).
5. Whether `SaveTimes.php` cares about the order its POSTs arrive in (§4.3).
