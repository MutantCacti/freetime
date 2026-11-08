// Account pages. Rendered with the main site's Document shell, stylesheets,
// header and controls (ACCOUNTS-SPEC.md §1): there is no accounts-only CSS.

import type { Child } from "hono/jsx";
import { Document, pageTitle } from "../views/layout";
import { LiveRegions } from "../views/notices";
import { WithSeps } from "../views/sep";
import { CloseControl, ThemeButton } from "../views/topbar";
import { formatOffset, offsetSeconds, allZones } from "../tz";
import type { User } from "./db";

/** Limits shown in forms and checked on the server. */
export const LIMITS = { name: 60, bio: 280, passwordMin: 10, passwordMax: 256, email: 254 } as const;

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

/** Initials for the picture circle until pictures arrive (phase 2). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1]![0]! : "";
  return (first + last).toUpperCase();
}

export interface AccountPageProps {
  user: User;
  /** What was just saved, for the confirmation line. */
  done?: string;
  errors?: Errors;
  /** Values to put back after a failed save. */
  draft?: { name?: string; bio?: string; email?: string };
}

export function AccountPage({ user, done, errors = {}, draft = {} }: AccountPageProps) {
  const visibility = user.visibility === "public" ? "Public" : "Private"; // PRINTED OUTPUT: account / visibility names
  return (
    // PRINTED OUTPUT: account / title
    <AccountShell title="Account">
      {done ? <FormMessage kind="done">{done}</FormMessage> : null}
      {errors.form ? <FormMessage kind="error">{errors.form}</FormMessage> : null}

      <section class="profile-card" aria-labelledby="profile-name">
        <span class="avatar" aria-hidden="true">
          {initials(user.name)}
        </span>
        <div class="profile-text">
          <h2 id="profile-name">{user.name}</h2>
          {user.bio ? <p class="profile-bio">{user.bio}</p> : null}
          {/* PRINTED OUTPUT: account / profile card, time zone and visibility */}
          <p class="profile-meta">
            <WithSeps text={`${user.zone} · ${visibility}`} />
          </p>
        </div>
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
          <div class="actions actions-start">
            <button type="submit" class="pill pill-primary">
              Save profile
            </button>
          </div>
        </form>
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
