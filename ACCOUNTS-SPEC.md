# freetime.mutantcacti.com — accounts spec

Accounts let anyone sign up, show their free time on a profile, add friends, and find a time together in a shared **space**: when2meet, built on everyone's real calendars instead of hand-painted grids. Think Steam profiles and friends, but simpler: a profile is **public** or **private**, and friends always see it as public.

**Accounts are always a different Worker.** The site in `SPEC.md` (Maxence's calendar) stays exactly as it is: one Worker, read-only, no storage, no cookies, no login. Everything here runs in a second Worker, the **accounts Worker**, with its own code entry point, its own bindings and its own rules. Nothing in this file changes what `SPEC.md` allows the main Worker to do.

The model follows Maxence's [graph](https://github.com/MutantCacti/graph) demo, with freetime names:

| graph | freetime | What it is |
|---|---|---|
| Instance | **User** | Someone who has signed up |
| Space | **Space** | People finding a time together |
| State | **Calendar** | A source of one user's busy times |

As in graph, users, spaces and calendars are joined only by membership tables.

Everything in `SPEC.md` §2 still applies to the accounts Worker (stack, tokens, fonts, PRINTED OUTPUT, plain language, works without JS), unless this file says otherwise.

| Phase | What |
|---|---|
| 0 | This spec |
| 1 | The accounts Worker, its database and email (Resend); sign up with email and password, verify, sign in, sign out, reset a password; the account page with name, bio, time zone and visibility; the account icon on the main site |
| 2 | Profile pictures; calendars from an iCal address; your own calendar; public profile pages and the share link |
| 3 | Friends |
| 4 | Spaces: new space from your account or a friend's profile, invite, join, the shared grid |
| 5 | Sign in with Google; link Google; Google Calendar as a calendar source |
| 6 | when2meet, revisited (§11) |

Each phase is its own pull request.

---

## 1. The two Workers

| | Main Worker | Accounts Worker |
|---|---|---|
| Spec | `SPEC.md` | this file |
| Entry point | `src/index.ts` | `src/accounts/index.ts` |
| Config | `wrangler.toml` | `wrangler.accounts.toml` |
| Storage | none | D1 database `freetime-accounts`; R2 bucket `freetime-pictures` (phase 2); the Cache API for calendar copies |
| Cookies | never read, never set (its middleware strips `Set-Cookie`) | one session cookie (§5) |
| Methods | GET, HEAD | GET, HEAD, POST |
| Secrets | `ICAL_URL` | `RESEND_API_KEY`, `ACCOUNTS_KEY` (phase 2), `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (phase 5) |

- **One look, one stylesheet set.** Every page of both Workers is rendered by the same `Document` shell (`src/views/layout.tsx`) and loads the same stylesheets from `public/css/` (`fonts.css`, `tokens.css`, `app.css`, `calendar.css`), the same fonts and the same scripts. Account pages add their styles to `app.css`; there is no accounts-only stylesheet and no second set of tokens. Account pages use the same top bar, sub-page header, buttons, pills, forms, toasts and error panel.
- **Addresses: one host, split by path.** Both Workers answer on `freetime.mutantcacti.com` (`SITE_HOST`). The accounts Worker owns `/account`, `/account/*`, `/u/*`, `/@*` (profiles by username), `/spaces`, `/spaces/*`, `/s/*` and `/auth/*`; the main Worker owns everything else, including `/css/*`, `/fonts/*` and `/js/*`, so account pages load the very same files. This needs zone routes for both Workers instead of the main Worker's custom domain (§13).
- **The main site's one addition:** an **Account** row in the settings modal (the top bar's cog, the only menu on both Workers). It's a plain link to `/account`, the same whether you're signed in or not, since the main Worker never reads the cookie. On the accounts Worker the same cog opens your own settings (profile, theme and colour map, security, calendars, help, sign out); without JS it goes to `/account`, which shows the same rows as a page.
- **Shared code** lives in `src/` (calendar model, views, tokens, time zones, iCal). The accounts Worker imports it; the main Worker never imports anything from `src/accounts/`. A test checks that import direction, and another that no path is claimed by both Workers.

## 2. Data

D1 (SQLite). Migrations in `migrations/`, applied with `wrangler d1 migrations apply`. Times are Unix seconds (UTC). Phase 1 creates `users`, `sessions`, `email_tokens` and `attempts`; later phases add their tables with new migrations.

```sql
CREATE TABLE users (
  user_id         INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id       TEXT NOT NULL UNIQUE,      -- 10 random characters: the profile address, /u/<public_id>
  name            TEXT NOT NULL,             -- 1–60 characters
  bio             TEXT NOT NULL DEFAULT '',  -- up to 280 characters, plain text
  zone            TEXT NOT NULL,             -- IANA time zone, your default for every view
  visibility      TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email_verified  INTEGER NOT NULL DEFAULT 0,
  password_hash   TEXT,                      -- null for Google-only accounts
  google_sub      TEXT UNIQUE,               -- phase 5
  picture_key     TEXT,                      -- phase 2: R2 object key
  invite_code     TEXT NOT NULL UNIQUE,      -- 16 random characters: your share link's friend invite (§4)
  created_at      INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,              -- SHA-256 of the cookie value, never the value
  user_id     INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

CREATE TABLE email_tokens (
  token_hash  TEXT PRIMARY KEY,              -- SHA-256 of the emailed token
  user_id     INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('verify', 'reset', 'change')),
  new_email   TEXT,                          -- 'change' only: the address being confirmed
  expires_at  INTEGER NOT NULL               -- verify and change: 24 hours; reset: 1 hour
);

CREATE TABLE attempts (key TEXT NOT NULL, at INTEGER NOT NULL);  -- counts for the limits in §5.1; rows older than a day are deleted

-- Phase 2
CREATE TABLE calendars (
  calendar_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL CHECK (kind IN ('ical', 'google')),
  label        TEXT NOT NULL,                -- "Work", "Personal": yours to name
  secret       BLOB NOT NULL,                -- encrypted iCal address or Google refresh token (§7)
  status       TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'disconnected')),
  created_at   INTEGER NOT NULL
);
CREATE TABLE user_calendars (user_id INTEGER REFERENCES users ON DELETE CASCADE, calendar_id INTEGER REFERENCES calendars ON DELETE CASCADE, PRIMARY KEY (user_id, calendar_id));

-- Phase 3. A friendship is stored once, lower user_id first.
CREATE TABLE friends (user_a INTEGER REFERENCES users ON DELETE CASCADE, user_b INTEGER REFERENCES users ON DELETE CASCADE, created_at INTEGER NOT NULL, PRIMARY KEY (user_a, user_b), CHECK (user_a < user_b));
CREATE TABLE friend_requests (from_user INTEGER REFERENCES users ON DELETE CASCADE, to_user INTEGER REFERENCES users ON DELETE CASCADE, created_at INTEGER NOT NULL, PRIMARY KEY (from_user, to_user));

-- Phase 4
CREATE TABLE spaces (
  space_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id    TEXT NOT NULL UNIQUE,         -- /spaces/<public_id>
  name         TEXT NOT NULL,
  invite_code  TEXT NOT NULL UNIQUE,         -- the join link, /s/<invite_code>
  from_date    TEXT NOT NULL,                -- YYYY-MM-DD
  to_date      TEXT NOT NULL,
  zone         TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE TABLE space_users     (space_id INTEGER REFERENCES spaces ON DELETE CASCADE, user_id INTEGER REFERENCES users ON DELETE CASCADE, PRIMARY KEY (space_id, user_id));
CREATE TABLE space_calendars (space_id INTEGER REFERENCES spaces ON DELETE CASCADE, calendar_id INTEGER REFERENCES calendars ON DELETE CASCADE, PRIMARY KEY (space_id, calendar_id));
```

- A **calendar** stores where busy times come from, never the events. Events are fetched when needed and reduced to busy blocks straight away (as `src/ical.ts` already does). Each calendar's feed is cached exactly like the main site's (`src/feed.ts`): fresh for 5 minutes, with a saved copy kept for 7 days in case a fetch fails, keyed by calendar id and a hash of its address. A calendar that can't be loaded at all shows the error panel, as on the main site.
- **Your busy time** is the merge of all your calendars. Nobody, including you, is ever shown an event's title, which calendar a block came from, or a calendar's address.
- Deleting your account deletes your user row; the cascades remove sessions, tokens, calendars, friendships, requests and memberships, and your picture is deleted from R2. Spaces left with no members are deleted.

## 3. Profiles and visibility

Every user has a profile at `/@<username>` (3–20 of a–z, 0–9 and _, unique ignoring case, chosen at sign-up and changeable in Profile; the site's own words are refused). `/u/<public_id>` still works and moves (301) to `/@<username>` once there is one, keeping its query, the friend invite included.

| Shown on the profile | Private | Public | To friends |
|---|---|---|---|
| Name and picture: the picture in the top bar, the name in a card edged in the owner's accent (§8) | ✓ | ✓ | ✓ |
| Bio | ✓ | ✓ | ✓ |
| Busy time: the main site's Day, Week, Month and Range views, from your calendars | ✓ | ✓ | ✓ |
| Time zone | | ✓ | ✓ |
| Friends (names and pictures, linking to their profiles) | | ✓ | ✓ |
| Number of friends and spaces | | ✓ | ✓ |
| Member since | | ✓ | ✓ |

- **Friends always see the public profile**, whatever your setting. Signed-out visitors and everyone else see your setting's column.
- **New accounts are private.** You choose public on the account page.
- Your email is never shown on any profile, to anyone.
- A profile's busy views are drawn in the **viewer's** zone (their device, or the selector), like the main site. Your own zone is what's shown as "Time zone" and is the default for your own views and the spaces you create.
- A profile's calendar and colour bar are drawn in its **owner's colour map**, for everyone who sees it: parula (the default, and always the main site's), viridis, cividis, magma or plasma, all toned the same way so lightness rises steadily from free to busy. Light mode inverts it, as on the main site.

## 4. Friends (phase 3) and the share link

Making a friend should take one tap.

- **Your share link** is `https://freetime.mutantcacti.com/@<username>?f=<invite_code>`. The account page has a **Copy link** button for it (the same in-button confirmation as the contact panel). It opens your profile, and it's also a friend invite.
- **Add friend** is on every profile you visit while signed in (not your own, not existing friends):
  - opened from your share link (with your `f` code): pressing it makes you friends at once, because you sent the link;
  - otherwise: it sends a friend request. The other person sees it on their account page, with **Accept** and **Decline**. If both people request each other, they become friends at once.
- **Signed out**, Add friend's first tap says "Sign in to add friends" and the second goes to sign in (without JS it's a link to sign in), which comes back to the profile.
- **Unfriend** is on a friend's profile. **Reset share link** on the account page makes a new `invite_code`, so old links stop being invites (they still open your profile).
- Friend requests and new friends are shown on the account page. No emails are sent for them.

## 5. Signing in and sessions

### 5.1 Email and password (phase 1)

- **Sign up:** name, email, password (at least 10 characters, at most 256; nothing else is required of it) and time zone (filled from your device when JS is on; Europe/London otherwise; changeable later).
- **Verify:** sign-up signs you in straight away and sends an email (§6) with a link to `/account/verify?t=<token>`. Until you confirm, the account page shows "Confirm your email" with **Send it again**, and your profile is hidden (404). An address nobody confirms within 24 hours is free for someone else to sign up with, so it can't be held by someone who doesn't own it.
- **Passwords** are hashed with PBKDF2-SHA-256 through WebCrypto, 100,000 iterations (the most Workers allows **(unverified)**), a 16-byte random salt, stored as `pbkdf2-sha256$100000$<salt>$<hash>` (base64url). The iteration count is in the stored value, so it can be raised later.
- **Sign in** checks the hash in constant time. A wrong email and a wrong password give the same message.
- **Forgotten password:** `/account/reset` asks for your email and always answers "If that address has an account, we've sent a link", so it can't be used to test addresses. The link (1 hour, single use) sets a new password and signs out every session.
- **Changing your password** needs the current one and signs out every other session. Changing your email sends a verification to the new address; the change applies when it's verified.
- **Limits:** 10 failed sign-ins per email and 30 per IP address per 15 minutes; 5 sign-ups and 5 emails per IP per hour. Over a limit: "Too many attempts. Try again in a few minutes." Kept in D1 or with Workers Rate Limiting **(unverified)**.

### 5.2 Sign in with Google (phase 5)

- OAuth 2.0 / OpenID Connect, authorization code with PKCE and `state`, kept in a 10-minute signed cookie for the round trip. Scopes `openid email profile`; Google Calendar adds `https://www.googleapis.com/auth/calendar.freebusy` when you choose to use it, not at sign-in.
- The first Google sign-in creates a user (Google has verified the email). Later sign-ins find you by `google_sub`, never by email.
- **Link Google** from the account page sets `google_sub` on an email account. **Unlink** only if you have a password.
- **Never merged by email:** a Google sign-in whose email belongs to an existing email account says "An account already uses this email. Sign in with your password, then link Google from your account."
- You control freetime.'s access from your Google account; Google emails you when it's granted. If you remove it, the calendar is marked disconnected and the account page says so.

### 5.3 Sessions and requests

- **Cookie:** `__Host-session=<32 random bytes, base64url>`; `Secure; HttpOnly; SameSite=Lax; Path=/`; 30 days, extended on use (at most once a day). Only its SHA-256 is stored.
- **Sign out** (a form button, never a link) deletes the session. **Sign out everywhere** deletes them all.
- **Every POST** must carry an `Origin` equal to `https://<SITE_HOST>`, or it's refused with 403.
- **Forms** are plain HTML forms that POST and redirect (303). Every page works without JS.
- **Headers:** as `SPEC.md` §9, plus `Cache-Control: no-store` on every page that depends on who's signed in.
- The main Worker's routes receive the cookie too. It never reads it and strips any `Set-Cookie`; a test checks its output is identical with and without the cookie.

## 6. Email (Resend)

- Sent through Resend's HTTP API (`POST https://api.resend.com/emails`) with the secret `RESEND_API_KEY`, from `RESEND_FROM` (a variable, for example `freetime <noreply@freetime.mutantcacti.com>`; the domain is verified in Resend with the DNS records it gives).
- **Emails:** verify your address (sign-up and email change), reset your password. Plain text plus simple HTML, every word with a PRINTED OUTPUT marker, no tracking pixels or link rewriting.
- A send failure is logged (status only, never the address) and shown as "We couldn't send the email. Try again in a minute." (`EMAIL_SEND`).
- Tests mock the API and check what would be sent.

## 7. Calendars (phase 2)

- **Add an iCal address** on the account page (a secret iCal address from Google, Outlook, Apple, Fastmail...). Checked once on save (fetched and parsed, as `src/feed.ts` does), then stored encrypted.
- **Google Calendar** (phase 5): your primary calendar's busy times through the Calendar API's `freeBusy` query. Busy blocks only.
- **Encryption:** iCal addresses and refresh tokens are encrypted with AES-256-GCM before they reach D1, with a key derived from `ACCOUNTS_KEY` (HKDF) and a fresh 12-byte IV per value; decrypted only in memory, never logged or sent to the browser.
- **Errors** per calendar reuse `FEED_FETCH`, `FEED_STATUS_<n>` and `FEED_PARSE`, plus `GOOGLE_REVOKED`.

## 8. The account page

`/account`, signed in. Everything you can do is reachable from it, in this order:

1. **Your profile card:** picture, name, bio, time zone, visibility (Public or Private), and **Copy link** (your share link, §4) with **View profile**.
2. **New space** (phase 4): one button (§9).
3. **Your calendar:** your busy time in the main site's views, plus **Add calendar** (phase 2).
4. **Friends** (phase 3): requests waiting (Accept / Decline), then your friends, each linking to their profile.
5. **Spaces** (phase 4): yours, newest first.
6. **Edit profile:** change picture (phase 2), name, bio, time zone, visibility, colour map (each choice shown as a swatch).
7. **Sign-in and security:** email, password, Google (phase 5), sign out everywhere, reset share link, delete account.

Signed out, `/account` shows **Sign in** and **Create account**.

**Pictures** (phase 2): PNG or JPEG, at most 2 MB uploaded, checked by their first bytes, then decoded in the Worker: the centre square is kept, area-averaged to 128 × 128 (smaller pictures keep their own size) and stored as PNG in R2 under a random key; the upload itself is never stored. Served at `/u/<public_id>/picture`. A picture that can't be decoded is refused. WebP isn't accepted: the WebAssembly decoder tried had a libwebp older than the fix for CVE-2023-4863. Removing it deletes the object and the accent. **Where it shows:** in the owner's profile card (with the calendar: under it on phones, above it on wide screens), and in the header of your own settings. Never in the top bar. The card is edged in the owner's accent, with Add friend as a round accent button on its right (none for the owner). The profile link shows the full address without https://; if it doesn't fit it loses characters from the start, so the username always shows.

**Accent** (phase 2): picked from the picture on upload (Kawase passes down to one pixel, saturation raised), then clamped so it keeps 3:1 on both themes' page colours and 4.5:1 with black or white text on it; that colour is stored. What's drawn is snapped to the owner's colour map, per theme: of the theme's busy step colours that have a hue (never step 0, the free colour, so the accent never matches free cells), the one nearest the stored colour's hue, its lightness then moved just far enough to stand 3:1 off that theme's page and surface. A grey picture, or none, gives the hued step nearest the middle one (cividis's middle steps are grey, so it gives a colour). It colours the owner's profile card (its edge and primary buttons, Add friend included), on their profile and their account page, through `/u/<public_id>/accent.css`, which every verified profile has; its URL carries the rule's version, the map and the stored colour, so it's cached for good. The sheet sets `--user-accent` and `--user-on-accent` for the current theme, and `--user-accent-dark` and `--user-accent-light` for both.

## 9. Spaces (phase 4)

Making a space should take one tap.

- **New space** on the account page creates a space at once: named "Your name's space", covering the next 7 days from today in your zone, with you as its only member. It opens the space, where the name, dates and zone can be changed and its invite link copied.
- **Find a time** on a friend's profile creates a space at once with **both of you** as members: named "Alice & Bob", the next 7 days, your zone. Your friend sees it in their spaces.
- **Invite link:** `/s/<invite_code>`, with **Copy link** on the space. Signed in, it joins; signed out, it asks you to sign up or sign in first, then joins.
- Joining a space shares your calendars into it, so there's nothing to set up; **My calendars in this space** lets you turn each one off.
- **The shared grid:** the main site's calendar for the space's dates, where **each slot shows how many members are free** instead of how busy one person is. Same colour map and dither; the bar reads "Everyone free" to "Nobody free"; each slot's label says "Tue 3 Nov, 14:00–14:30, 3 of 4 free". A member is free in a slot if no busy time from their calendars in the space overlaps it at all. A member with no calendars counts as unknown ("2 of 4 free, 1 unknown"). Focusing or hovering a slot lists who's free, by name.
- Members see each other's names and pictures, never more than their busy blocks. **Leave space** removes you and your calendars from it.

## 10. Errors

The main site's toasts and error panel (`SPEC.md` §5.9), plus:

| Code | Meaning | Status |
|---|---|---|
| `AUTH_REQUIRED` | The page needs you signed in (redirects to sign-in, then back) | 303 |
| `AUTH_ORIGIN` | A POST without the site's `Origin` | 403 |
| `AUTH_LIMIT` | Too many attempts | 429 |
| `TOKEN_INVALID` | An email link that's expired, used or wrong | 400 |
| `EMAIL_SEND` | Resend couldn't send an email | 503 |
| `PROFILE_NOT_FOUND` | No such profile | 404 |
| `SPACE_NOT_FOUND` | No such space, or you're not a member | 404 |
| `GOOGLE_AUTH` | Google sign-in failed or was cancelled | 400 |
| `GOOGLE_REVOKED` | Google access was removed from your Google account | per calendar |
| `DB` | The database couldn't be reached | 503 |

Form mistakes (wrong password, email in use, password too short) are shown next to the field.

## 11. when2meet, revisited (phase 6)

With spaces, people with accounts don't need when2meet. Phase 6 decides what's left: matching a space's grid to a when2meet event someone else made (the parked match-mode code and `docs/W2M-GET-SPEC.md`), or nothing. The bookmarklet is dropped for good.

## 12. Tests

- Every route, signed in and out; every form works as a plain POST.
- Passwords, sessions, email tokens (expiry, single use), the `Origin` check, cookie attributes, rate limits.
- Visibility: each profile field shown or hidden for signed-out visitors, strangers, friends and yourself, public and private.
- Friends: share-link add is instant; a plain add is a request; mutual requests become friends; unfriend; reset link.
- Privacy: no email, event title, calendar address or calendar label of anyone else in any response.
- Both Workers render with the same `Document` and stylesheets; the main Worker's output is unchanged with a session cookie; no imports from `src/accounts/` outside it; no path claimed by both.
- D1 runs in the Workers test pool with the migrations applied; Resend, calendar and Google fetches are mocked in every test.

## 13. Deployment notes

- **Routes:** the main Worker moves from a custom domain to the zone route `freetime.mutantcacti.com/*`, with a proxied DNS record for `freetime` **(unverified exact record)**; the accounts Worker takes zone routes for its paths (more specific routes win). The README gets the exact steps in phase 1.
- **Resend:** add `freetime.mutantcacti.com` (or the chosen sending domain) in Resend, add its DNS records in Cloudflare, then `npx wrangler secret put RESEND_API_KEY --config wrangler.accounts.toml`.
- **Google** (phase 5): until Google verifies the app, the free/busy scope works for up to 100 listed test users **(unverified details)**. Sign-in alone isn't affected.

## 14. Definition of done (per phase)

- **Phase 1:** the accounts Worker deploys on its own; sign up, verify, sign in, sign out, reset and the account page's profile settings work without JS; the account icon is on the main site; tests green; README deployment steps for the second Worker, D1, Resend and the routes; PRINTED OUTPUT count reported for both Workers.
- **Phases 2–5:** their sections implemented and tested; README and decisions table updated.
- **Phase 6:** decided with Maxence first.
