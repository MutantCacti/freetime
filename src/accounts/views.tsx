// Account pages. Rendered with the main site's Document shell, stylesheets,
// header and controls (ACCOUNTS-SPEC.md §1): there is no accounts-only CSS.

import type { Child } from "hono/jsx";
import { Document, pageTitle } from "../views/layout";
import { SITE_HOST } from "../config";
import { LiveRegions } from "../views/notices";
import { WithSeps } from "../views/sep";
import { CloseControl, ThemeButton } from "../views/topbar";
import { formatOffset, offsetSeconds, allZones } from "../tz";
import type { User } from "./db";
import { accentSheetUrl, pictureUrl } from "./pictures";
import { isAccent } from "./accent";
import { CopyButton } from "../views/panels";
import { CheckIcon, UserPlusIcon } from "../views/icons";
import { LinkRow, ProfileLink, Row, Rows, ThemeRow } from "../views/settings";
import { monthLabel } from "../format";
import { dateAt } from "../tz";
import { PALETTE_NAMES, type PaletteName } from "../parula";
import { LEVELS } from "../levels";
import { stepClasses } from "../dither";
import { USERNAME_MAX, USERNAME_MIN, profilePath } from "./username";

/** Limits shown in forms and checked on the server. */
export const LIMITS = { name: 60, bio: 280, passwordMin: 10, passwordMax: 256, email: 254, label: 40 } as const;

// ---------------------------------------------------------------- shell

export interface ShellProps {
  title: string;
  children: Child;
  /** Signed in: their accent stylesheet. */
  user?: User;
  /** The header's theme button; off where the page has its own Theme row (/account). */
  theme?: boolean;
}

/** A sub-page like /help: title, theme switcher, and Close back to the calendar. */
export function AccountShell({ title, children, user, theme = true }: ShellProps) {
  return (
    <Document title={pageTitle(title)} bodyClass="page-sub" accentSheet={user?.email_verified ? accentSheetUrl(user.public_id, isAccent(user.accent) ? user.accent : null, user.palette) : undefined}>
      <header class="subheader">
        <h1>{title}</h1>
        {theme ? <ThemeButton /> : null}
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
  /** The input's id, when `f-<name>` is used twice on a page. */
  id?: string;
  name: string;
  type?: "text" | "email" | "password";
  value?: string;
  error?: string;
  hint?: string;
  autocomplete?: string;
  required?: boolean;
  maxlength?: number;
  minlength?: number;
  /** A short noun or example, never a sentence: "Your name", "you@example.com". */
  placeholder?: string;
}

/** Label, then hint, then the field, then any error: everything that explains a field sits above it. */
export function Field(p: FieldProps) {
  const id = p.id ?? `f-${p.name}`;
  const describedBy = [p.hint ? `${id}-hint` : "", p.error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div class="field">
      <label for={id}>{p.label}</label>
      {p.hint ? (
        <p class="field-hint" id={`${id}-hint`}>
          {p.hint}
        </p>
      ) : null}
      <input
        id={id}
        name={p.name}
        type={p.type ?? "text"}
        value={p.value}
        autocomplete={p.autocomplete}
        required={p.required}
        maxlength={p.maxlength}
        minlength={p.minlength}
        placeholder={p.placeholder}
        aria-invalid={p.error ? "true" : undefined}
        aria-describedby={describedBy}
      />
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

/** The username field, at sign-up and in Profile: the address it makes is in the hint. */
export function UsernameField({ value, error }: { value?: string; error?: string }) {
  return (
    // PRINTED OUTPUT: account / username field label, hint and placeholder
    <Field
      label="Username"
      name="username"
      placeholder="username"
      value={value}
      error={error}
      required
      minlength={USERNAME_MIN}
      maxlength={USERNAME_MAX}
      autocomplete="username"
      hint={`Your profile's address: ${SITE_HOST}/@username. ${USERNAME_MIN} to ${USERNAME_MAX} letters, numbers or _.`}
    />
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
        {/* PRINTED OUTPUT: sign in / field labels, placeholders and button */}
        <Field label="Email" name="email" placeholder="you@example.com" type="email" value={email} autocomplete="email" required maxlength={LIMITS.email} />
        <Field label="Password" name="password" placeholder="Password" type="password" autocomplete="current-password" required maxlength={LIMITS.passwordMax} />
        <div class="actions">
          <button type="submit" class="pill pill-primary">
            Sign in
          </button>
        </div>
      </form>
      <p class="form-links">
        {/* PRINTED OUTPUT: sign in / links to reset and sign up */}
        <a href="/account/reset">Forgot your password?</a>
        <a href={next ? `/account/sign-up?next=${encodeURIComponent(next)}` : "/account/sign-up"}>Create an account</a>
      </p>
    </AccountShell>
  );
}

export interface SignUpValues {
  name?: string;
  username?: string;
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
        {/* PRINTED OUTPUT: sign up / field labels, hints, placeholders and button */}
        <Field label="Name" name="name" placeholder="Your name" value={values.name} error={errors.name} autocomplete="name" required maxlength={LIMITS.name} hint="Shown on your profile." />
        <UsernameField value={values.username} error={errors.username} />
        <Field label="Email" name="email" placeholder="you@example.com" type="email" value={values.email} error={errors.email} autocomplete="email" required maxlength={LIMITS.email} hint="We'll send a link to confirm it. Never shown to anyone." />
        <Field
          label="Password"
          name="password"
          placeholder="Password"
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
        <span>
          Already have an account? <a href={values.next ? `/account/sign-in?next=${encodeURIComponent(values.next)}` : "/account/sign-in"}>Sign in</a>
        </span>
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
        {/* PRINTED OUTPUT: reset / field label, placeholder and button */}
        <Field label="Email" name="email" placeholder="you@example.com" type="email" value={email} autocomplete="email" required maxlength={LIMITS.email} />
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

/** Where the settings' Help goes: the profile's Help dialog, or the main site's /help page. */
export interface HelpTarget {
  href: string;
  dialog?: string;
}

/** /account signed out: the sentence, Sign in and Create an account, then Theme and Help (as in the modal). */
export function SignedOutSettings({ help, next }: { help: HelpTarget; next?: string }) {
  const q = next ? `?next=${encodeURIComponent(next)}` : "";
  return (
    <>
      <div class="settings-intro">
        {/* PRINTED OUTPUT: account (signed out) / message and actions */}
        <p>Sign in to show your free time on a profile, add friends and find a time together.</p>
        <div class="actions actions-start">
          <a class="pill pill-primary" href={`/account/sign-in${q}`}>
            Sign in
          </a>
          <a class="pill" href={`/account/sign-up${q}`}>
            Create an account
          </a>
        </div>
      </div>
      <Rows>
        <ThemeRow />
        {/* PRINTED OUTPUT: settings / help row */}
        <LinkRow href={help.href} dialog={help.dialog} what="Help" />
      </Rows>
    </>
  );
}

export function SignedOutPage() {
  return (
    // PRINTED OUTPUT: account (signed out) / title
    <AccountShell title="Account" theme={false}>
      <div class="settings-page">
        <SignedOutSettings help={{ href: "/help" }} />
      </div>
    </AccountShell>
  );
}

// ---------------------------------------------------------------- signed in

/** The picture circle: the user's picture, or their initials. Decorative: the name is always next to it. */
export function Avatar({ user }: { user: User }) {
  return user.picture_key ? (
    <img class="avatar" src={pictureUrl(user.public_id, user.picture_key)} alt="" width={40} height={40} />
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

export interface AccountSettingsProps {
  user: User;
  calendars: CalendarRow[];
  /** The share link: the profile, and a friend invite. */
  shareLink: string;
  /** This site's host and origin, for the profile link's text and what Copy copies. */
  host: string;
  origin: string;
  errors?: Errors;
  /** Values to put back after a failed save. */
  draft?: { name?: string; username?: string; bio?: string; email?: string; label?: string; address?: string };
  /** Where the forms come back to (the profile the modal was opened on); /account when omitted. */
  next?: string;
  help: HelpTarget;
  /** The time zone field (only on /account: its list is long). */
  zone?: boolean;
}

/** Hidden `next`, so a form sent from the modal comes back to the page it was on. */
function Next({ next }: { next?: string }) {
  return next ? <input type="hidden" name="next" value={next} /> : null;
}

/** The signed-in settings: you (picture, name, profile link), then Profile, Theme, Security, Calendars, Help and Sign out. */
export function AccountSettings(p: AccountSettingsProps) {
  const { user, calendars, errors = {}, draft = {}, next } = p;
  const path = profilePath(user);
  return (
    <>
      <section class="me" data-accent-user={user.public_id} aria-label={user.name}>
        <Avatar user={user} />
        <div class="me-text">
          <strong>{user.name}</strong>
          <ProfileLink host={p.host} path={path} copy={`${p.origin}${path}`} />
        </div>
      </section>
      <Rows>
        {/* PRINTED OUTPUT: settings / profile row name and summary */}
        <Row id="profile" what="Profile" value="Name, bio, picture">
          {/* PRINTED OUTPUT: account / profile form fields, placeholders, choices and button */}
          <form class="form" method="post" action="/account/profile">
            <Next next={next} />
            <Field label="Name" name="name" placeholder="Your name" value={draft.name ?? user.name} error={errors.name} required maxlength={LIMITS.name} autocomplete="name" />
            <UsernameField value={draft.username ?? user.username ?? ""} error={errors.username} />
            <div class="field">
              <label for="f-bio">Bio</label>
              <p class="field-hint">Up to {LIMITS.bio} characters.</p>
              <textarea id="f-bio" name="bio" rows={3} maxlength={LIMITS.bio} placeholder="A line about you" aria-invalid={errors.bio ? "true" : undefined}>
                {draft.bio ?? user.bio}
              </textarea>
              {errors.bio ? <p class="field-error">{errors.bio}</p> : null}
            </div>
            {p.zone ? <ZoneSelect value={user.zone} /> : null}
            <fieldset class="field choice">
              <legend>Who can see your profile</legend>
              <label>
                <input type="radio" name="visibility" value="private" checked={user.visibility === "private"} /> Private: your name, bio and busy times. Friends see everything public.
              </label>
              <label>
                <input type="radio" name="visibility" value="public" checked={user.visibility === "public"} /> Public: also your time zone and friends.
              </label>
            </fieldset>
            <div class="actions actions-start">
              <button type="submit" class="pill pill-primary">
                Save profile
              </button>
            </div>
          </form>
          {/* PRINTED OUTPUT: account / picture field, hint and buttons */}
          <form class="form" method="post" action="/account/picture" enctype="multipart/form-data">
            <Next next={next} />
            <div class="field">
              <label for="f-picture">Picture</label>
              <p class="field-hint">PNG or JPEG, up to 2 MB. Kept as a small square (the middle of your picture), shown as a circle to everyone who sees your profile.</p>
              <input id="f-picture" name="picture" type="file" accept="image/png,image/jpeg" required aria-invalid={errors.picture ? "true" : undefined} />
              {errors.picture ? <p class="field-error">{errors.picture}</p> : null}
            </div>
            <div class="actions actions-start">
              <button type="submit" class="pill">
                Upload picture
              </button>
            </div>
          </form>
          {user.picture_key ? (
            <form method="post" action="/account/picture/remove">
              <Next next={next} />
              <button type="submit" class="pill">
                Remove picture
              </button>
            </form>
          ) : null}
          <div class="field">
            {/* PRINTED OUTPUT: account / share link label, hint and copy target */}
            <p class="field-label">Share link</p>
            <p class="field-hint">Your profile, and a friend invite: whoever opens it can add you in one tap.</p>
            <p class="share-link">
              <code>{p.shareLink}</code>
            </p>
            <div class="actions actions-start">
              <CopyButton value={p.shareLink} what="share link" />
            </div>
          </div>
        </Row>
        <ThemeRow palette={user.palette} mapName={PALETTE_LABELS[user.palette].name}>
          <PaletteChoice value={user.palette} next={next} error={errors.palette} />
        </ThemeRow>
        {/* PRINTED OUTPUT: settings / security row name and summary */}
        <Row id="security" what="Security" value="Email, password">
          {/* PRINTED OUTPUT: account / email form */}
          <form class="form" method="post" action="/account/email">
            <Next next={next} />
            <Field label="Email" name="email" placeholder="you@example.com" type="email" value={draft.email ?? user.email} error={errors.email} required maxlength={LIMITS.email} autocomplete="email" hint="Changing it sends a link to the new address; it changes when you open it." />
            <div class="actions actions-start">
              <button type="submit" class="pill">
                Change email
              </button>
            </div>
          </form>
          {/* PRINTED OUTPUT: account / password form */}
          <form class="form" method="post" action="/account/password">
            <Next next={next} />
            <Field label="Current password" name="current" placeholder="Current password" type="password" error={errors.current} required autocomplete="current-password" maxlength={LIMITS.passwordMax} />
            <Field
              label="New password"
              name="password"
              placeholder="New password"
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
          {/* PRINTED OUTPUT: account / sign out everywhere else */}
          <form class="form" method="post" action="/account/sign-out-everywhere">
            <Next next={next} />
            <p class="field-label">Sessions</p>
            <div class="actions actions-start">
              <button type="submit" class="pill">
                Sign out everywhere else
              </button>
            </div>
          </form>
          {/* PRINTED OUTPUT: account / delete account form */}
          <form class="form danger" method="post" action="/account/delete">
            <p class="field-label">Delete account</p>
            <p class="field-hint">Deletes your profile and everything in it. This can't be undone. Enter your password to confirm.</p>
            <Field label="Password" name="password" id="f-delete-password" placeholder="Password" type="password" error={errors.delete} required autocomplete="current-password" maxlength={LIMITS.passwordMax} />
            <div class="actions actions-start">
              <button type="submit" class="pill pill-danger">
                Delete my account
              </button>
            </div>
          </form>
        </Row>
        {/* PRINTED OUTPUT: settings / calendars row name and count */}
        <Row id="calendars" what="Calendars" value={calendars.length ? `${calendars.length} added` : "None yet"}>
          {/* PRINTED OUTPUT: account / your calendar intro */}
          <p class="field-hint">Your busy times, merged from these calendars. Only when you're busy is shown, never what you're doing.</p>
          {calendars.length ? (
            <ul class="calendar-list">
              {calendars.map((cal) => (
                <li>
                  <span class="calendar-label">{cal.label}</span>
                  {/* PRINTED OUTPUT: account / calendar kind and status */}
                  <span class="field-hint">{cal.kind === "google" ? "Google Calendar" : "iCal"}{cal.status === "disconnected" ? " · disconnected" : ""}</span>
                  <form method="post" action="/account/calendars/remove">
                    <Next next={next} />
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
          {/* PRINTED OUTPUT: account / add calendar form */}
          <form class="form" method="post" action="/account/calendars">
            <Next next={next} />
            <p class="field-label">Add a calendar</p>
            <Field label="Name" name="label" placeholder="Work" value={draft.label} error={errors.label} required maxlength={LIMITS.label} hint="For you only, like Work or Personal." />
            <Field
              label="Secret iCal address"
              name="address"
              placeholder="https://calendar.example/…/basic.ics"
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
        </Row>
        {/* PRINTED OUTPUT: settings / help row */}
        <LinkRow href={p.help.href} dialog={p.help.dialog} what="Help" />
        <li class="row">
          <form method="post" action="/account/sign-out">
            {/* PRINTED OUTPUT: settings / sign out row */}
            <button type="submit" class="row-head row-danger">
              <span class="row-what">Sign out</span>
            </button>
          </form>
        </li>
      </Rows>
    </>
  );
}

export interface AccountPageProps extends Omit<AccountSettingsProps, "help" | "zone"> {
  /** What was just saved, for the confirmation line. */
  done?: string;
}

/** /account: the same rows as the modal, as a page (the cog's place without JS). */
export function AccountPage({ done, ...settings }: AccountPageProps) {
  const { user, errors = {} } = settings;
  return (
    // PRINTED OUTPUT: account / title
    <AccountShell title="Account" user={user} theme={false}>
      {done ? <FormMessage kind="done">{done}</FormMessage> : null}
      {errors.form ? <FormMessage kind="error">{errors.form}</FormMessage> : null}
      {user.email_verified ? null : (
        <div class="form-message confirm-notice" role="status">
          {/* PRINTED OUTPUT: account / confirm your email notice and button */}
          <p>Confirm your email: we sent a link to {user.email}. Until then, your profile stays hidden.</p>
          <form method="post" action="/account/verify/send">
            <button type="submit" class="pill">
              Send it again
            </button>
          </form>
        </div>
      )}
      <p class="account-links">
        {/* PRINTED OUTPUT: account / view profile link */}
        <a href={profilePath(user)}>View your profile</a>
      </p>
      <div class="settings-page">
        <AccountSettings {...settings} help={{ href: "/help" }} zone />
      </div>
    </AccountShell>
  );
}

export { ZoneSelect };

// PRINTED OUTPUT: account / colour map names
const PALETTE_LABELS: Record<PaletteName, { name: string }> = {
  parula: { name: "parula" },
  viridis: { name: "viridis" },
  cividis: { name: "cividis" },
  magma: { name: "magma" },
  plasma: { name: "plasma" },
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

/** The colour maps, in Theme: one button each, which saves it at once; the name sits just left of its colours. */
function PaletteChoice({ value, next, error }: { value: PaletteName; next?: string; error?: string }) {
  return (
    <form class="palette-choice" method="post" action="/account/palette">
      <Next next={next} />
      {/* PRINTED OUTPUT: account / colour map list name, button names and hint */}
      <div class="pal-list" role="group" aria-label="Colour map">
        {PALETTE_NAMES.map((name) => (
          <button type="submit" class="pal-btn" name="palette" value={name} aria-pressed={value === name ? "true" : "false"} aria-label={`Colour map: ${PALETTE_LABELS[name].name}`}>
            <span class="pal-name">{PALETTE_LABELS[name].name}</span>
            <PaletteSwatch palette={name} />
          </button>
        ))}
      </div>
      <p class="field-hint">Your profile is drawn in this map for everyone who visits it. Parula is the default; cividis is made for colour-blind eyes.</p>
      {error ? <p class="field-error">{error}</p> : null}
    </form>
  );
}

// ---------------------------------------------------------------- profiles

export interface ProfileCardProps {
  user: User;
  /** The visitor's Add friend control; none for the owner. */
  friend?: FriendButtonProps;
  /** Time zone, friends and member since: public profiles, friends (phase 3) and the owner. */
  showPublic: boolean;
  isOwner: boolean;
  host: string;
  origin: string;
}

/**
 * The owner's card, with their calendar (ACCOUNTS-SPEC.md §3): under it on
 * phones, above it on wide screens. Edged in their accent. Never shows the email.
 */
export function ProfileCard({ user, showPublic, isOwner, friend, host, origin }: ProfileCardProps) {
  const since = monthLabel(dateAt(user.created_at, user.zone));
  const path = profilePath(user);
  return (
    <section class="profile-card profile-strip" data-accent-user={user.public_id} aria-labelledby="profile-name">
      {user.picture_key ? <img class="card-picture" src={pictureUrl(user.public_id, user.picture_key)} alt="" width={40} height={40} /> : null}
      <div class="profile-text">
        <h2 id="profile-name">{user.name}</h2>
        {user.bio ? <p class="profile-bio">{user.bio}</p> : null}
        {showPublic ? (
          // PRINTED OUTPUT: profile / time zone and member since
          <p class="profile-meta">
            <WithSeps text={`${user.zone} · Member since ${since}`} />
          </p>
        ) : null}
        <ProfileLink host={host} path={path} copy={`${origin}${path}`} />
      </div>
      {friend && !isOwner ? <FriendButton {...friend} name={user.name} /> : null}
    </section>
  );
}

// ---------------------------------------------------------------- friends

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
  /** POST target that takes a request back (state sent). */
  cancelAction?: string;
  /** POST target for Unfriend (state friends). */
  unfriendAction?: string;
  /** Sign-in link that comes back to this profile (state signed-out). */
  signInHref?: string;
  /** Hidden fields for the forms, such as the share link's `f` code. */
  fields?: Record<string, string>;
}

/**
 * Add friend: a round accent button with a person and a plus, in the card.
 * Sent (or friends), it becomes an outlined check; tapping it again takes
 * the request back. Signed out, the first tap says why (app.js) and the
 * second goes to sign in; without JS it's a link to sign in.
 */
export function FriendButton({ state, action = "", cancelAction, unfriendAction, signInHref = "/account/sign-in", fields = {}, name }: FriendButtonProps & { name: string }) {
  // PRINTED OUTPUT: profile / add friend accessible names and the signed-out note
  const label = {
    add: `Add ${name} as a friend`,
    invite: `Add ${name} as a friend`,
    accept: `Accept ${name}'s friend request`,
    sent: `Friend request sent to ${name}. Take it back`,
    friends: `You and ${name} are friends. Unfriend`,
    "signed-out": `Sign in to add ${name} as a friend`,
  } as const;
  const hidden = Object.entries(fields).map(([k, v]) => <input type="hidden" name={k} value={v} />);
  if (state === "signed-out") {
    return (
      <a class="add-friend" data-state={state} data-signin-tip="" href={signInHref} aria-label={label[state]}>
        <UserPlusIcon />
        <span class="add-friend-tip" hidden>
          Sign in to add friends
        </span>
      </a>
    );
  }
  const done = state === "sent" || state === "friends";
  const target = state === "sent" ? cancelAction : state === "friends" ? unfriendAction : action;
  const button = (
    <button type={target ? "submit" : "button"} class={done ? "add-friend is-done" : "add-friend"} data-state={state} aria-label={label[state]} disabled={target ? undefined : true}>
      {done ? <CheckIcon /> : <UserPlusIcon />}
    </button>
  );
  return target ? (
    <form class="add-friend-form" method="post" action={target}>
      {hidden}
      {button}
    </form>
  ) : (
    button
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
