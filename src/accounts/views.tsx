// Account pages. Rendered with the main site's Document shell, stylesheets,
// header and controls (ACCOUNTS-SPEC.md §1): there is no accounts-only CSS.

import type { Child } from "hono/jsx";
import { Document, pageTitle } from "../views/layout";
import { LiveRegions } from "../views/notices";
import { WithSeps } from "../views/sep";
import { CloseControl, ThemeButton } from "../views/topbar";
import { formatOffset, offsetSeconds, allZones } from "../tz";
import type { User } from "./db";
import { pictureUrl } from "./pictures";
import { CopyButton } from "../views/panels";
import { CheckIcon, UserPlusIcon } from "../views/icons";
import { monthLabel } from "../format";
import { dateAt } from "../tz";
import { PALETTE_NAMES, type PaletteName } from "../parula";
import { LEVELS } from "../levels";
import { stepClasses } from "../dither";

/** Limits shown in forms and checked on the server. */
export const LIMITS = { name: 60, bio: 280, passwordMin: 10, passwordMax: 256, email: 254, label: 40 } as const;

// ---------------------------------------------------------------- shell

export interface ShellProps {
  title: string;
  children: Child;
}

/** A sub-page like /help: title, theme switcher, and Close back to the calendar. */
export function AccountShell({ title, children }: ShellProps) {
  return (
    <Document title={pageTitle(title)} bodyClass="page-sub">
      <header class="subheader">
        <h1>{title}</h1>
        <ThemeButton />
        <CloseControl href="/" />
      </header>
      <main class="sub-main" id="main">
        {children}
      </main>
      <LiveRegions />
    </Document>
  );
}

// ---------------------------------------------------------------- form parts

export interface FieldProps {
  label: string;
  name: string;
  type?: "text" | "email" | "password";
  value?: string;
  error?: string;
  hint?: string;
  autocomplete?: string;
  required?: boolean;
  maxlength?: number;
  minlength?: number;
}

export function Field(p: FieldProps) {
  const id = `f-${p.name}`;
  const describedBy = [p.hint ? `${id}-hint` : "", p.error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div class="field">
      <label for={id}>{p.label}</label>
      <input
        id={id}
        name={p.name}
        type={p.type ?? "text"}
        value={p.value}
        autocomplete={p.autocomplete}
        required={p.required}
        maxlength={p.maxlength}
        minlength={p.minlength}
        aria-invalid={p.error ? "true" : undefined}
        aria-describedby={describedBy}
      />
      {p.hint ? (
        <p class="field-hint" id={`${id}-hint`}>
          {p.hint}
        </p>
      ) : null}
      {p.error ? (
        <p class="field-error" id={`${id}-error`}>
          {p.error}
        </p>
      ) : null}
    </div>
  );
}

/** A message above a form: an error ("error") or a confirmation ("done"). */
export function FormMessage({ kind, children }: { kind: "error" | "done"; children: Child }) {
  return (
    <p class={`form-message form-${kind}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </p>
  );
}

function ZoneSelect({ value, name = "zone" }: { value: string; name?: string }) {
  const now = Math.floor(Date.now() / 1000);
  return (
    <div class="field">
      {/* PRINTED OUTPUT: account / time zone field label */}
      <label for={`f-${name}`}>Time zone</label>
      <select id={`f-${name}`} name={name}>
        {allZones().map((z) => (
          // PRINTED OUTPUT: account / time zone option
          <option value={z} selected={z === value}>
            {z} · {formatOffset(offsetSeconds(now, z))}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------- signed out

export type Errors = Partial<Record<string, string>>;

export function SignInPage({ email, next, error, done }: { email?: string; next?: string; error?: string; done?: string }) {
  return (
    // PRINTED OUTPUT: sign in / title
    <AccountShell title="Sign in">
      {done ? <FormMessage kind="done">{done}</FormMessage> : null}
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <form class="form" method="post" action="/account/sign-in">
        {next ? <input type="hidden" name="next" value={next} /> : null}
        {/* PRINTED OUTPUT: sign in / field labels and button */}
        <Field label="Email" name="email" type="email" value={email} autocomplete="email" required maxlength={LIMITS.email} />
        <Field label="Password" name="password" type="password" autocomplete="current-password" required maxlength={LIMITS.passwordMax} />
        <div class="actions">
          <button type="submit" class="pill pill-primary">
            Sign in
          </button>
        </div>
      </form>
      <p class="form-links">
        {/* PRINTED OUTPUT: sign in / links to reset and sign up */}
        <a href="/account/reset">Forgot your password?</a> <span class="sep">·</span> <a href={next ? `/account/sign-up?next=${encodeURIComponent(next)}` : "/account/sign-up"}>Create an account</a>
      </p>
    </AccountShell>
  );
}

export interface SignUpValues {
  name?: string;
  email?: string;
  zone: string;
  next?: string;
}

export function SignUpPage({ values, errors = {} }: { values: SignUpValues; errors?: Errors }) {
  return (
    // PRINTED OUTPUT: sign up / title
    <AccountShell title="Create an account">
      {errors.form ? <FormMessage kind="error">{errors.form}</FormMessage> : null}
      <form class="form" method="post" action="/account/sign-up">
        {values.next ? <input type="hidden" name="next" value={values.next} /> : null}
        {/* Filled from the device's zone by app.js; `dtz` or Europe/London without JS. Changeable later. */}
        <input type="hidden" name="zone" value={values.zone} data-device-zone="" />
        {/* PRINTED OUTPUT: sign up / field labels, hints and button */}
        <Field label="Name" name="name" value={values.name} error={errors.name} autocomplete="name" required maxlength={LIMITS.name} hint="Shown on your profile." />
        <Field label="Email" name="email" type="email" value={values.email} error={errors.email} autocomplete="email" required maxlength={LIMITS.email} hint="We'll send a link to confirm it. Never shown to anyone." />
        <Field
          label="Password"
          name="password"
          type="password"
          error={errors.password}
          autocomplete="new-password"
          required
          minlength={LIMITS.passwordMin}
          maxlength={LIMITS.passwordMax}
          hint={`At least ${LIMITS.passwordMin} characters.`}
        />
        <div class="actions">
          <button type="submit" class="pill pill-primary">
            Create account
          </button>
        </div>
      </form>
      <p class="form-links">
        {/* PRINTED OUTPUT: sign up / link to sign in */}
        Already have an account? <a href={values.next ? `/account/sign-in?next=${encodeURIComponent(values.next)}` : "/account/sign-in"}>Sign in</a>
      </p>
    </AccountShell>
  );
}

/** After sign-up, or signing in before confirming. */
export function CheckEmailPage({ email, sent }: { email: string; sent?: boolean }) {
  return (
    // PRINTED OUTPUT: check email / title
    <AccountShell title="Check your email">
      {/* PRINTED OUTPUT: check email / message */}
      {sent ? <FormMessage kind="done">Sent. It can take a minute to arrive.</FormMessage> : null}
      <p class="lede">We've sent a link to {email}. Open it to finish setting up your account.</p>
      <form class="form" method="post" action="/account/verify/send">
        <input type="hidden" name="email" value={email} />
        <div class="actions">
          {/* PRINTED OUTPUT: check email / send again button */}
          <button type="submit" class="pill">
            Send it again
          </button>
        </div>
      </form>
    </AccountShell>
  );
}

/** An emailed link lands here; the button does the work (mail scanners that open links change nothing). */
export function ConfirmLinkPage({ action, token, title, button, children }: { action: string; token: string; title: string; button: string; children?: Child }) {
  return (
    <AccountShell title={title}>
      <form class="form" method="post" action={action}>
        <input type="hidden" name="t" value={token} />
        {children}
        <div class="actions">
          <button type="submit" class="pill pill-primary">
            {button}
          </button>
        </div>
      </form>
    </AccountShell>
  );
}

export function ResetRequestPage({ email, sent, error }: { email?: string; sent?: boolean; error?: string }) {
  return (
    // PRINTED OUTPUT: reset / title
    <AccountShell title="Reset your password">
      {/* PRINTED OUTPUT: reset / sent message (the same whether or not the address has an account) */}
      {sent ? <FormMessage kind="done">If that address has an account, we've sent a link to reset its password.</FormMessage> : null}
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      <form class="form" method="post" action="/account/reset">
        {/* PRINTED OUTPUT: reset / field label and button */}
        <Field label="Email" name="email" type="email" value={email} autocomplete="email" required maxlength={LIMITS.email} />
        <div class="actions">
          <button type="submit" class="pill pill-primary">
            Send link
          </button>
        </div>
      </form>
    </AccountShell>
  );
}

/** For an expired, used or wrong link, and other dead ends. */
export function MessagePage({ title, message, href, linkText }: { title: string; message: string; href: string; linkText: string }) {
  return (
    <AccountShell title={title}>
      <p class="lede">{message}</p>
      <p>
        <a href={href}>{linkText}</a>
      </p>
    </AccountShell>
  );
}

export function SignedOutPage() {
  return (
    // PRINTED OUTPUT: account (signed out) / title, message and actions
    <AccountShell title="Account">
      <p class="lede">Sign in to show your free time on a profile, add friends and find a time together.</p>
      <div class="actions actions-start">
        <a class="pill pill-primary" href="/account/sign-in">
          Sign in
        </a>
        <a class="pill" href="/account/sign-up">
          Create an account
        </a>
      </div>
    </AccountShell>
  );
}

// ---------------------------------------------------------------- signed in

/** The picture circle: the user's picture, or their initials. Decorative: the name is always next to it. */
export function Avatar({ user }: { user: User }) {
  return user.picture_key ? (
    <img class="avatar" src={pictureUrl(user.public_id, user.picture_key)} alt="" width={64} height={64} />
  ) : (
    <span class="avatar" aria-hidden="true">
      {initials(user.name)}
    </span>
  );
}

/** Initials for the picture circle when there's no picture. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1]![0]! : "";
  return (first + last).toUpperCase();
}

/** A calendar as the account page shows it: never its address. */
export interface CalendarRow {
  calendar_id: number;
  label: string;
  kind: "ical" | "google";
  status: "ok" | "disconnected";
}

export interface AccountPageProps {
  user: User;
  calendars: CalendarRow[];
  /** The share link: the profile, and (phase 3) a friend invite. */
  shareLink: string;
  /** What was just saved, for the confirmation line. */
  done?: string;
  errors?: Errors;
  /** Values to put back after a failed save. */
  draft?: { name?: string; bio?: string; email?: string; label?: string; address?: string };
}

export function AccountPage({ user, calendars, shareLink, done, errors = {}, draft = {} }: AccountPageProps) {
  const visibility = user.visibility === "public" ? "Public" : "Private"; // PRINTED OUTPUT: account / visibility names
  return (
    // PRINTED OUTPUT: account / title
    <AccountShell title="Account">
      {done ? <FormMessage kind="done">{done}</FormMessage> : null}
      {errors.form ? <FormMessage kind="error">{errors.form}</FormMessage> : null}

      <section class="profile-card" aria-labelledby="profile-name">
        <Avatar user={user} />
        <div class="profile-text">
          <h2 id="profile-name">{user.name}</h2>
          {user.bio ? <p class="profile-bio">{user.bio}</p> : null}
          {/* PRINTED OUTPUT: account / profile card, time zone and visibility */}
          <p class="profile-meta">
            <WithSeps text={`${user.zone} · ${visibility}`} />
          </p>
          <div class="actions actions-start">
            {/* PRINTED OUTPUT: account / view profile link */}
            <a class="pill" href={`/u/${user.public_id}`}>
              View profile
            </a>
            {/* PRINTED OUTPUT: account / copy target name */}
            <CopyButton value={shareLink} what="share link" />
          </div>
          {/* Without JS, the link to copy by hand. */}
          <p class="field-hint share-link">
            {/* PRINTED OUTPUT: account / share link label */}
            Your share link: <code>{shareLink}</code>
          </p>
        </div>
      </section>

      <section class="account-section" aria-labelledby="your-calendar">
        {/* PRINTED OUTPUT: account / your calendar heading, intro and link */}
        <h2 id="your-calendar">Your calendar</h2>
        <p class="field-hint">Your busy times, merged from these calendars. Only when you're busy is shown, never what you're doing.</p>
        {calendars.length ? (
          <ul class="calendar-list">
            {calendars.map((cal) => (
              <li>
                <span class="calendar-label">{cal.label}</span>
                {/* PRINTED OUTPUT: account / calendar kind and status */}
                <span class="field-hint">{cal.kind === "google" ? "Google Calendar" : "iCal"}{cal.status === "disconnected" ? " · disconnected" : ""}</span>
                <form method="post" action="/account/calendars/remove">
                  <input type="hidden" name="id" value={String(cal.calendar_id)} />
                  {/* PRINTED OUTPUT: account / remove calendar button and accessible name */}
                  <button type="submit" class="pill" aria-label={`Remove ${cal.label}`}>
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          // PRINTED OUTPUT: account / no calendars yet
          <p>No calendars yet: until you add one, your profile shows you as free.</p>
        )}
        <p>
          {/* PRINTED OUTPUT: account / open your calendar */}
          <a href={`/u/${user.public_id}`}>Open your calendar</a>
        </p>
        {/* PRINTED OUTPUT: account / add calendar form */}
        <form class="form" method="post" action="/account/calendars">
          <h3>Add a calendar</h3>
          <Field label="Name" name="label" value={draft.label} error={errors.label} required maxlength={LIMITS.label} hint="For you only, like Work or Personal." />
          <Field
            label="Secret iCal address"
            name="address"
            value={draft.address}
            error={errors.address}
            required
            maxlength={2048}
            autocomplete="off"
            hint="From your calendar's settings: in Google Calendar, Settings, your calendar, Integrate calendar, Secret address in iCal format. Stored encrypted; never shown again."
          />
          <div class="actions actions-start">
            <button type="submit" class="pill pill-primary">
              Add calendar
            </button>
          </div>
        </form>
      </section>

      <section class="account-section" aria-labelledby="edit-profile">
        {/* PRINTED OUTPUT: account / edit profile heading, fields, choices and button */}
        <h2 id="edit-profile">Edit profile</h2>
        <form class="form" method="post" action="/account/profile">
          <Field label="Name" name="name" value={draft.name ?? user.name} error={errors.name} required maxlength={LIMITS.name} autocomplete="name" />
          <div class="field">
            <label for="f-bio">Bio</label>
            <textarea id="f-bio" name="bio" rows={3} maxlength={LIMITS.bio} aria-invalid={errors.bio ? "true" : undefined}>
              {draft.bio ?? user.bio}
            </textarea>
            <p class="field-hint">Up to {LIMITS.bio} characters.</p>
            {errors.bio ? <p class="field-error">{errors.bio}</p> : null}
          </div>
          <ZoneSelect value={user.zone} />
          <fieldset class="field choice">
            <legend>Who can see your profile</legend>
            <label>
              <input type="radio" name="visibility" value="private" checked={user.visibility === "private"} /> Private: your name, bio and busy times. Friends see everything public.
            </label>
            <label>
              <input type="radio" name="visibility" value="public" checked={user.visibility === "public"} /> Public: also your time zone and friends.
            </label>
          </fieldset>
          <PaletteChoice value={user.palette} error={errors.palette} />
          <div class="actions actions-start">
            <button type="submit" class="pill pill-primary">
              Save profile
            </button>
          </div>
        </form>
      </section>

      <section class="account-section" aria-labelledby="picture">
        {/* PRINTED OUTPUT: account / picture heading, field, hint and buttons */}
        <h2 id="picture">Picture</h2>
        <form class="form" method="post" action="/account/picture" enctype="multipart/form-data">
          <div class="field">
            <label for="f-picture">Choose a picture</label>
            <input id="f-picture" name="picture" type="file" accept="image/png,image/jpeg,image/webp" required aria-invalid={errors.picture ? "true" : undefined} />
            <p class="field-hint">PNG, JPEG or WebP, up to 2 MB. Shown as a circle, to everyone who sees your profile.</p>
            {errors.picture ? <p class="field-error">{errors.picture}</p> : null}
          </div>
          <div class="actions actions-start">
            <button type="submit" class="pill pill-primary">
              Upload picture
            </button>
          </div>
        </form>
        {user.picture_key ? (
          <form method="post" action="/account/picture/remove">
            <button type="submit" class="pill">
              Remove picture
            </button>
          </form>
        ) : null}
      </section>

      <section class="account-section" aria-labelledby="security">
        {/* PRINTED OUTPUT: account / sign-in and security heading */}
        <h2 id="security">Sign-in and security</h2>

        {/* PRINTED OUTPUT: account / email form */}
        <form class="form" method="post" action="/account/email">
          <Field label="Email" name="email" type="email" value={draft.email ?? user.email} error={errors.email} required maxlength={LIMITS.email} autocomplete="email" hint="Changing it sends a link to the new address; it changes when you open it." />
          <div class="actions actions-start">
            <button type="submit" class="pill">
              Change email
            </button>
          </div>
        </form>

        {/* PRINTED OUTPUT: account / password form */}
        <form class="form" method="post" action="/account/password">
          <Field label="Current password" name="current" type="password" error={errors.current} required autocomplete="current-password" maxlength={LIMITS.passwordMax} />
          <Field
            label="New password"
            name="password"
            type="password"
            error={errors.password}
            required
            autocomplete="new-password"
            minlength={LIMITS.passwordMin}
            maxlength={LIMITS.passwordMax}
            hint={`At least ${LIMITS.passwordMin} characters. Signs you out everywhere else.`}
          />
          <div class="actions actions-start">
            <button type="submit" class="pill">
              Change password
            </button>
          </div>
        </form>

        {/* PRINTED OUTPUT: account / sign out buttons */}
        <div class="actions actions-start">
          <form method="post" action="/account/sign-out">
            <button type="submit" class="pill">
              Sign out
            </button>
          </form>
          <form method="post" action="/account/sign-out-everywhere">
            <button type="submit" class="pill">
              Sign out everywhere
            </button>
          </form>
        </div>

        {/* PRINTED OUTPUT: account / delete account form */}
        <form class="form danger" method="post" action="/account/delete">
          <h3>Delete account</h3>
          <p class="field-hint">Deletes your profile and everything in it. This can't be undone.</p>
          <Field label="Password" name="password" type="password" error={errors.delete} required autocomplete="current-password" maxlength={LIMITS.passwordMax} />
          <div class="actions actions-start">
            <button type="submit" class="pill pill-danger">
              Delete my account
            </button>
          </div>
        </form>
      </section>
    </AccountShell>
  );
}

export { ZoneSelect };

// PRINTED OUTPUT: account / colour map names and notes
const PALETTE_LABELS: Record<PaletteName, { name: string; note?: string }> = {
  parula: { name: "Parula", note: "the default" },
  viridis: { name: "Viridis" },
  cividis: { name: "Cividis", note: "made for colour-blind eyes" },
  magma: { name: "Magma" },
  plasma: { name: "Plasma" },
};

/** A strip of the map's busy steps, free to busy, drawn by calendar.css. */
export function PaletteSwatch({ palette }: { palette: PaletteName }) {
  return (
    <span class="palette-swatch" data-palette={palette} aria-hidden="true">
      {Array.from({ length: LEVELS }, (_, step) => (
        <span class={stepClasses(step)}></span>
      ))}
    </span>
  );
}

/** The colour map choice in Edit profile: one radio per preset, each with its swatch. */
function PaletteChoice({ value, error }: { value: PaletteName; error?: string }) {
  return (
    <fieldset class="field choice palette-choice" aria-describedby="palette-hint" aria-invalid={error ? "true" : undefined}>
      {/* PRINTED OUTPUT: account / colour map legend and hint */}
      <legend>Colour map</legend>
      <p class="field-hint" id="palette-hint">
        Your calendar is drawn in this map, from free to busy, for everyone who sees your profile.
      </p>
      <div class="palette-options">
        {PALETTE_NAMES.map((name) => (
          <label class="palette-option">
            <input type="radio" name="palette" value={name} checked={value === name} />
            <span class="palette-name">
              {PALETTE_LABELS[name].name}
              {PALETTE_LABELS[name].note ? <span class="field-hint"> · {PALETTE_LABELS[name].note}</span> : null}
            </span>
            <PaletteSwatch palette={name} />
          </label>
        ))}
      </div>
      {error ? <p class="field-error">{error}</p> : null}
    </fieldset>
  );
}

// ---------------------------------------------------------------- profiles

export interface ProfileCardProps {
  user: User;
  /** Phase 3 wires this up; until then nothing passes it and no friend control is shown. */
  friend?: FriendButtonProps;
  /** Time zone, friends and member since: public profiles, friends (phase 3) and the owner. */
  showPublic: boolean;
  isOwner: boolean;
  shareLink?: string;
}

/** Above the calendar on /u/<id> (ACCOUNTS-SPEC.md §3). Never shows the email. */
export function ProfileCard({ user, showPublic, isOwner, shareLink, friend }: ProfileCardProps) {
  const since = monthLabel(dateAt(user.created_at, user.zone));
  return (
    <section class="profile-card profile-strip" aria-labelledby="profile-name">
      <Avatar user={user} />
      <div class="profile-text">
        <h2 id="profile-name">{user.name}</h2>
        {user.bio ? <p class="profile-bio">{user.bio}</p> : null}
        {showPublic ? (
          // PRINTED OUTPUT: profile / time zone and member since
          <p class="profile-meta">
            <WithSeps text={`${user.zone} · Member since ${since}`} />
          </p>
        ) : null}
        {isOwner && shareLink ? (
          <div class="actions actions-start">
            {/* PRINTED OUTPUT: profile / owner's actions */}
            <a class="pill" href="/account">
              Edit profile
            </a>
            <CopyButton value={shareLink} what="share link" />
          </div>
        ) : null}
        {friend && !isOwner ? <FriendButton {...friend} /> : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- friends (look only; phase 3 wires it)

/**
 * Where a visitor stands with a profile's owner (ACCOUNTS-SPEC.md §4):
 * - "add": signed in, not friends, no request either way;
 * - "invite": as "add", opened from the owner's share link, so one tap makes you friends;
 * - "accept": the owner already asked you;
 * - "sent": you asked, they haven't answered;
 * - "friends": you are friends;
 * - "signed-out": not signed in.
 */
export type FriendState = "add" | "invite" | "accept" | "sent" | "friends" | "signed-out";

export interface FriendButtonProps {
  state: FriendState;
  /** POST target that adds, accepts or requests (states add, invite, accept). */
  action?: string;
  /** POST target for Unfriend (state friends). */
  unfriendAction?: string;
  /** Sign-up link that comes back to this profile (state signed-out). */
  signUpHref?: string;
  /** Hidden fields for the form, such as the share link's `f` code. */
  fields?: Record<string, string>;
}

/**
 * The one-tap friend control on a profile card. The states that ask for a tap
 * (add, invite, accept, signed-out) are a primary pill; on narrow screens it
 * sits at the bottom of the screen, in thumb reach. "Request sent" and
 * "Friends" are quiet status lines in the card.
 */
export function FriendButton({ state, action = "", unfriendAction, signUpHref = "/account/sign-up", fields = {} }: FriendButtonProps) {
  // PRINTED OUTPUT: profile / friend control labels and notes
  const label = { add: "Add friend", invite: "Add friend", accept: "Accept friend request", "signed-out": "Sign up to add friend" } as const;
  const note = { invite: "You'll be friends at once.", accept: "They asked to be your friend." } as const;
  if (state === "sent" || state === "friends") {
    return (
      <div class="friend-action friend-status" data-state={state}>
        <span class="friend-badge">
          <CheckIcon /> {state === "sent" ? "Request sent" : "Friends"}
        </span>
        {state === "friends" && unfriendAction ? (
          <form method="post" action={unfriendAction}>
            <button type="submit" class="pill pill-quiet">
              Unfriend
            </button>
          </form>
        ) : null}
      </div>
    );
  }
  const n = state === "invite" || state === "accept" ? note[state] : null;
  return (
    <div class="friend-action friend-cta" data-state={state}>
      {state === "signed-out" ? (
        <a class="pill pill-primary friend-pill" href={signUpHref}>
          <UserPlusIcon /> {label[state]}
        </a>
      ) : (
        <form method="post" action={action}>
          {Object.entries(fields).map(([k, v]) => (
            <input type="hidden" name={k} value={v} />
          ))}
          <button type="submit" class="pill pill-primary friend-pill">
            <UserPlusIcon /> {label[state]}
          </button>
        </form>
      )}
      {n ? <p class="field-hint friend-note">{n}</p> : null}
    </div>
  );
}

/** On the account page: friend requests waiting, linking to the Friends section (phase 3). */
export function FriendRequestsBadge({ count, href = "#friends" }: { count: number; href?: string }) {
  if (count <= 0) return null;
  return (
    <a class="request-badge" href={href}>
      <span class="request-count">{count > 99 ? "99+" : String(count)}</span>
      {/* PRINTED OUTPUT: account / friend requests waiting */}
      {count === 1 ? "friend request" : "friend requests"}
    </a>
  );
}
