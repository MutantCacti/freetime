# freetime.mutantcacti.com — accounts spec

Accounts let anyone sign in, connect their own calendar, and find a time with other people in a shared **space**: when2meet, built on everyone's real calendars instead of hand-painted grids.

**Accounts are always a different Worker.** The site in `SPEC.md` (Maxence's calendar) stays exactly as it is: one Worker, read-only, no storage, no cookies, no login. Everything here runs in a second Worker, the **accounts Worker**, with its own code entry point, its own bindings and its own rules. The two share rendering code from `src/`, never state. Nothing in this file changes what `SPEC.md` allows the main Worker to do.

The model follows Maxence's [graph](https://github.com/MutantCacti/graph) demo, with freetime names:

| graph | freetime | What it is |
|---|---|---|
| Instance | **User** | Someone who has signed up |
| Space | **Space** | People finding a time together |
| State | **Calendar** | A source of one user's busy times, shared into spaces |

As in graph, users, spaces and calendars are joined only by membership tables. A user belongs to spaces and owns calendars; a space has members and the calendars they share into it.

Everything in `SPEC.md` §2 still applies to the accounts Worker (stack, tokens, fonts, PRINTED OUTPUT, plain language, works without JS), unless this file says otherwise.

It has six phases. Each is its own pull request. **Phase 0 is this spec, approved, plus the open items in §11 settled.**

| Phase | What |
|---|---|
| 0 | This spec approved; open items settled |
| 1 | The accounts Worker, its database, email and password sign-up and sign-in, sessions; the account icon on the main site |
| 2 | Calendars from an iCal address; your own calendar view |
| 3 | Sign in with Google; link Google to an email account; Google Calendar as a calendar source |
| 4 | Spaces: create, invite, join, and the shared grid |
| 5 | when2meet, revisited (§10) |

---

## 1. The two Workers

| | Main Worker | Accounts Worker |
|---|---|---|
| Spec | `SPEC.md` | this file |
| Entry point | `src/index.ts` | `src/accounts/index.ts` |
| Config | `wrangler.toml` | `wrangler.accounts.toml` |
| Storage | none | D1 database `freetime-accounts`; the Cache API for calendar copies |
| Cookies | never read, never set (its middleware strips `Set-Cookie`) | one session cookie (§4) |
| Methods | GET, HEAD | GET, HEAD, POST |
| Secrets | `ICAL_URL` | `ACCOUNTS_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |

- **Shared code** lives in `src/` as now (calendar model, views, tokens, tz, ical). The accounts Worker imports it; the main Worker never imports anything from `src/accounts/`. A test checks that import direction.
- **Addresses:** both Workers answer on `freetime.mutantcacti.com`, split by path, so the site keeps one name (`SITE_HOST`). The accounts Worker owns `/account`, `/account/*`, `/auth/*`, `/spaces`, `/spaces/*` and `/s/*`; the main Worker owns everything else. See §11, item 1.
- **Tests** for each Worker run against its own app; a shared test checks that no route is claimed by both.

## 2. Data

D1 (SQLite). Migrations in `migrations/accounts/`, applied with `wrangler d1 migrations apply`. Times are Unix seconds (UTC).

```sql
CREATE TABLE users (
  user_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,              -- shown to people in your spaces
  email          TEXT UNIQUE COLLATE NOCASE, -- sign-in name for email accounts
  password_hash  TEXT,                       -- null for Google-only accounts
  google_sub     TEXT UNIQUE,                -- Google's stable user id, once linked
  created_at     INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,              -- SHA-256 of the cookie value, never the value
  user_id     INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

CREATE TABLE calendars (
  calendar_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL CHECK (kind IN ('ical', 'google')),
  label        TEXT NOT NULL,                -- "Work", "Personal": yours to name
  secret       BLOB NOT NULL,                -- encrypted iCal address or Google refresh token (§5)
  status       TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'disconnected')),
  created_at   INTEGER NOT NULL
);

CREATE TABLE spaces (
  space_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  invite_code  TEXT NOT NULL UNIQUE,         -- 16 random characters; the join link
  from_date    TEXT NOT NULL,                -- YYYY-MM-DD, the days the space covers
  to_date      TEXT NOT NULL,
  zone         TEXT NOT NULL,                -- the space's time zone, an IANA name
  created_at   INTEGER NOT NULL
);

-- Membership, as in graph.
CREATE TABLE user_calendars  (user_id INTEGER REFERENCES users ON DELETE CASCADE, calendar_id INTEGER REFERENCES calendars ON DELETE CASCADE, PRIMARY KEY (user_id, calendar_id));
CREATE TABLE space_users     (space_id INTEGER REFERENCES spaces ON DELETE CASCADE, user_id INTEGER REFERENCES users ON DELETE CASCADE, PRIMARY KEY (space_id, user_id));
CREATE TABLE space_calendars (space_id INTEGER REFERENCES spaces ON DELETE CASCADE, calendar_id INTEGER REFERENCES calendars ON DELETE CASCADE, PRIMARY KEY (space_id, calendar_id));
```

- A **calendar** stores where busy times come from, never the events. Events are fetched when needed, reduced to busy blocks straight away (as `src/ical.ts` already does), and cached with the Cache API for 5 minutes, keyed by calendar id.
- **Who can see what:** a user sees their own calendars. In a space, members see each other's **names** and **merged busy blocks** from the calendars shared into that space: never event titles, never which calendar a block came from, never anyone's calendar address or email.
- A calendar can only be shared into a space by its owner, and only into a space they belong to. Leaving a space removes your calendars from it.
- Deleting your account deletes your user row; the cascades remove your sessions, calendars and memberships. Spaces with no members left are deleted.

## 3. Signing in

Two ways, and an account can have both.

### 3.1 Email and password

- **Sign up:** name, email, password (at least 10 characters, at most 256; nothing else is required of it). The email is your sign-in name. Whether it's verified is §11, item 2.
- **Passwords** are hashed with PBKDF2-SHA-256 through WebCrypto, 100,000 iterations (the most Workers allows **(unverified)**), a 16-byte random salt, stored as `pbkdf2-sha256$100000$<salt>$<hash>` (base64url). The iteration count is in the stored value, so it can be raised later and old hashes still check.
- **Sign in** checks the hash in constant time. A wrong email and a wrong password give the same message and take the same time.
- **Limits:** 10 failed sign-ins per email per 15 minutes, and 30 per IP address, using Workers Rate Limiting **(unverified binding name)**. Over the limit: "Too many attempts. Try again in a few minutes." Sign-ups are limited per IP the same way.
- **Changing your password** needs the current one, and signs out every other session.
- **Forgotten passwords:** see §11, item 2.

### 3.2 Sign in with Google

- Standard OAuth 2.0 / OpenID Connect, authorization-code flow with PKCE and a `state` value, both kept in a short-lived signed cookie (10 minutes) for the round trip.
- **Scopes:** `openid email profile` to sign in. Phase 3 adds `https://www.googleapis.com/auth/calendar.freebusy` to read busy times: Google's narrowest calendar scope, which returns busy blocks and nothing else. It's asked for only when you choose to use Google Calendar, not at sign-in.
- **Accounts:** the first Google sign-in creates a user with `google_sub` and your Google name. Later sign-ins find you by `google_sub`, never by email.
- **Linking:** signed in with email and password, **Account → Link Google** runs the same flow and sets `google_sub` on your account. After that either way signs you in. **Unlink** is allowed only if you have a password, so nobody locks themselves out.
- **Never merged by email:** a Google sign-in whose email matches an existing email account does **not** sign into it. It says "An account already uses this email. Sign in with your password, then link Google from your account." Matching by email would let anyone who registered that address first take over the Google user's account, or the other way round.
- **Google's side:** you control freetime.'s access from your own Google account (Security → Third-party connections), and Google emails you when access is granted. If you remove access there, the next refresh fails, the calendar is marked `disconnected`, and your account page says "Google access was removed. Connect again to use this calendar."

## 4. Sessions and requests

- **Cookie:** `__Host-session=<32 random bytes, base64url>`; `Secure; HttpOnly; SameSite=Lax; Path=/`; 30 days. Only its SHA-256 is stored. Each use more than a day after the last extends it by 30 days.
- **Sign out** deletes the session row and the cookie. **Sign out everywhere** deletes all of the user's sessions.
- **Every POST** must carry an `Origin` header equal to `https://freetime.mutantcacti.com` (`SITE_HOST`), or it's refused with 403. With `SameSite=Lax` this stops cross-site form posts without a token in every form.
- **Forms** are plain HTML forms that POST and redirect (303) to a page you can reload. Every page works without JS.
- **Headers:** as `SPEC.md` §9, plus `Cache-Control: no-store` on every page that shows account data. The CSP keeps `form-action 'self'`; Google's sign-in page is reached by a redirect, not a form, so it needs no CSP change.
- The main Worker's routes receive the session cookie too (same host, `Path=/`). It never reads it, and its middleware already removes any `Set-Cookie`. A test checks the main Worker's output is identical with and without the cookie.

## 5. Calendars

- **Add an iCal address:** a box on **Account → Calendars** for a secret iCal address (Google, Outlook, Apple, Fastmail...). It's checked once on save (fetched and parsed, as `src/feed.ts` does), then stored encrypted.
- **Use Google Calendar:** for accounts with Google linked or signed in with Google. Asks Google for the free/busy scope, stores the refresh token encrypted, and reads your primary calendar's busy times through the Calendar API's `freeBusy` query. Busy blocks only; no events are ever fetched.
- **Encryption:** iCal addresses and refresh tokens are encrypted with AES-256-GCM before they reach D1, using a key derived from the secret `ACCOUNTS_KEY` (HKDF, one key per purpose), with a fresh 12-byte IV per value. They're decrypted only in memory to fetch, and never logged, shown back or sent to the browser. The account page shows a calendar's label, kind and status only.
- **Errors** reuse the main site's codes (`FEED_FETCH`, `FEED_STATUS_<n>`, `FEED_PARSE`) on the account page, per calendar, plus `GOOGLE_REVOKED` for a removed Google grant.

## 6. Pages

All on the accounts Worker. Same top bar, theme and tokens as the main site.

| Path | Method | What |
|---|---|---|
| `/account` | GET | Signed out: **Sign in** and **Create account**. Signed in: your name, email, sign-in methods, calendars, spaces, and the account actions |
| `/account/sign-in` | GET, POST | Email and password form, and **Sign in with Google** |
| `/account/sign-up` | GET, POST | Name, email, password |
| `/account/sign-out` | POST | Signs out (a form button, never a link) |
| `/account/calendars` | GET, POST | Add, rename and remove calendars |
| `/account/me` | GET | **Your calendar:** the main site's Day, Week, Month and Range views, drawn from your own calendars |
| `/account/settings` | GET, POST | Name, email, password, link or unlink Google, sign out everywhere, delete account |
| `/auth/google/start`, `/auth/google/callback` | GET | The OAuth round trip |
| `/spaces` | GET | Your spaces, and **New space** |
| `/spaces/new` | GET, POST | Name, dates, time zone |
| `/spaces/<id>` | GET, POST | The shared grid (§7); share or unshare your calendars; leave |
| `/s/<invite code>` | GET, POST | Join a space from its link (sign in first if needed) |

**The main site gets one addition:** an **account** icon (a person, round pill) in the top bar, directly before the menu button: on phones it sits to the left of the menu and theme icons; on wide screens it comes before **Download .ics**. It's a plain link to `/account`, named "Account" for screen readers. The main Worker can't know whether you're signed in, so the icon always looks the same. `SPEC.md` §5.0.1 records it.

## 7. The shared grid

A space's page is the main site's calendar for the space's dates, in the space's zone (the selector still works), with one change of meaning:

- **Each slot shows how many members are free**, not how busy one person is. The colour map, dither and colour bar are the same; the bar's ends read "Everyone free" and "Nobody free", and each slot's label says "Tue 3 Nov, 14:00–14:30, 3 of 4 free".
- A member counts as free in a slot if none of the calendars they shared into the space has busy time overlapping it (the `W2M_BUSY_THRESHOLD` rule: any overlap is busy). A member who has shared no calendar counts as unknown, and the label says so ("2 of 4 free, 1 not shared").
- Below the grid: the members, each with how many calendars they've shared. Hovering or focusing a slot lists who's free, by name.
- The grid is computed per request from cached busy blocks; nothing derived is stored.

## 8. Errors

The main site's toasts and error panel (`SPEC.md` §5.9), and these codes:

| Code | Meaning | Status |
|---|---|---|
| `AUTH_REQUIRED` | The page needs you signed in (redirects to sign-in, then back) | 303 |
| `AUTH_ORIGIN` | A POST without the site's `Origin` | 403 |
| `AUTH_LIMIT` | Too many attempts | 429 |
| `GOOGLE_AUTH` | Google sign-in failed or was cancelled | 400 |
| `GOOGLE_REVOKED` | Google access was removed from your Google account | shown per calendar |
| `SPACE_NOT_FOUND` | No such space, or you're not a member | 404 |
| `DB` | The database couldn't be reached | 503 |

Form mistakes (wrong password, email in use, password too short) are shown next to the field, not as codes.

## 9. Tests

- Each phase's routes, signed in and out, with and without JS-free form posts.
- Passwords: hash and check, wrong password, constant-time path, changing the iteration count still checks old hashes.
- Sessions: expiry, extension, sign out, sign out everywhere, a stolen cookie value stops working once signed out.
- `Origin` check on every POST; `SameSite` and `__Host-` cookie attributes.
- Google: the flow with Google mocked; never merged by email; linking and unlinking rules; revoked grant marks the calendar disconnected.
- Encryption: what reaches D1 never contains the iCal address or token; a wrong key fails to decrypt.
- Privacy: no event title, calendar address, email or other member's calendar label appears in any space page.
- The main Worker: unchanged output with a session cookie present; no imports from `src/accounts/`.
- D1 runs in the Workers test pool with migrations applied; Google and calendar fetches are mocked in every test.

## 10. when2meet, revisited (phase 5)

With spaces, freetime does what when2meet does from real calendars, so people with accounts don't need when2meet. Phase 5 decides what's left: matching a space's grid to a when2meet event someone else made (the parked match-mode code and `docs/W2M-GET-SPEC.md`), or nothing. The bookmarklet is dropped for good.

## 11. Open items (settle in phase 0)

1. **Path routing on one host.** Splitting `freetime.mutantcacti.com` by path between two Workers needs zone routes (`freetime.mutantcacti.com/account*` and so on to the accounts Worker, `freetime.mutantcacti.com/*` to the main one) instead of the main Worker's custom domain, plus a proxied DNS record for the name **(unverified)**. The alternative is a second subdomain for accounts, which is simpler to route but gives the site two names. Recommendation: path routing, one name.
2. **Email.** Verifying addresses and resetting forgotten passwords both need freetime. to send email, which needs a sending service (and its key). Options: (a) no email in phase 1: addresses aren't verified, and a forgotten password is reset by Maxence with a one-off admin command; (b) a sending service from the start. Recommendation: (a) for phase 1, revisited before sign-up is opened widely.
3. **Who can sign up.** Anyone, or only people with an invite link to a space? Recommendation: anyone, with the limits in §3.1.
4. **Google's verification.** The free/busy scope is "sensitive": until Google verifies the app, only up to 100 listed test users can use it, and Google shows a warning screen **(unverified details)**. Sign-in alone (`openid email profile`) isn't affected. Phase 3 can start in Google's testing mode.

## 12. Definition of done (per phase)

- **Phase 0:** spec approved; §11 settled; no product code.
- **Phase 1:** the accounts Worker deploys separately; sign up, sign in, sign out and settings work without JS; the account icon is on the main site; tests green; README deployment steps for the second Worker and D1 added; PRINTED OUTPUT count reported for both Workers.
- **Phases 2–4:** their sections implemented and tested; README and decisions table updated.
- **Phase 5:** decided with Maxence first.

Each phase lands as its own pull request, and the README's decisions and error-code tables are updated each time.
