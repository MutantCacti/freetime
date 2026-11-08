// The accounts Worker (ACCOUNTS-SPEC.md). Always a different Worker from the
// read-only site: this one stores accounts in D1 and keeps one session cookie.

import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { DEFAULT_TZ } from "../config";
import { AppError, type LogFn, consoleLog, logError, newRef, toAppError } from "../errors";
import { SECURITY_HEADERS } from "../headers";
import { canonicalZone } from "../tz";
import { StatusPage } from "../views/pages";
import { checkPassword, dummyPasswordHash, hashPassword, sha256Hex } from "./crypto";
import { Db, SESSION_SECONDS, type User } from "./db";
import { type SendEmail, confirmEmail, resendSender, resetEmail } from "./email";
import {
  AccountPage,
  CheckEmailPage,
  ConfirmLinkPage,
  type Errors,
  Field,
  LIMITS,
  MessagePage,
  ResetRequestPage,
  SignInPage,
  SignUpPage,
  SignedOutPage,
} from "./views";

export interface AccountsEnv {
  DB: D1Database;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  ASSETS?: Fetcher;
}

export interface AccountsDeps {
  /** Send one email. Defaults to Resend with RESEND_API_KEY and RESEND_FROM. */
  sendEmail?: SendEmail;
  now?: () => number;
  log?: LogFn;
}

type Ctx = Context<{ Bindings: AccountsEnv; Variables: { user: User | null; token: string | null } }>;

export const SESSION_COOKIE = "__Host-session";

/** The limits in ACCOUNTS-SPEC.md §5.1: [attempts, window in seconds]. */
export const RATE = {
  signInEmail: [10, 15 * 60],
  signInIp: [30, 15 * 60],
  signUpIp: [5, 3600],
  emailIp: [5, 3600],
} as const;

// PRINTED OUTPUT: account / form messages
const MSG = {
  badSignIn: "That email and password don't match an account.",
  limit: "Too many attempts. Try again in a few minutes.",
  emailSend: "We couldn't send the email. Try again in a minute.",
  nameRequired: "Enter your name.",
  nameLong: `Use ${LIMITS.name} characters or fewer.`,
  bioLong: `Use ${LIMITS.bio} characters or fewer.`,
  emailInvalid: "Enter an email address, like name@example.com.",
  emailTaken: "An account already uses this email. Sign in, or reset its password.",
  passwordShort: `Use at least ${LIMITS.passwordMin} characters.`,
  passwordLong: `Use ${LIMITS.passwordMax} characters or fewer.`,
  passwordWrong: "That's not your current password.",
  profileSaved: "Profile saved.",
  passwordSaved: "Password changed. You've been signed out everywhere else.",
  emailSent: "We've sent a link to the new address. Your email changes when you open it.",
  emailChanged: "Email changed.",
  signedOutAll: "Signed out everywhere else.",
  verified: "Email confirmed. Welcome to freetime.",
  resetDone: "Password changed. You've been signed out everywhere else.",
} as const;

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Only local paths are followed after signing in, never another site. */
function safeNext(value: unknown): string | undefined {
  const v = clean(value);
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") && v.length <= 512 ? v : undefined;
}

export function createAccountsApp(deps: AccountsDeps = {}) {
  const now = () => Math.floor((deps.now ?? Date.now)() / 1000);
  const log = deps.log ?? consoleLog;
  const app = new Hono<{ Bindings: AccountsEnv; Variables: { user: User | null; token: string | null } }>();

  const db = (c: Ctx) => new Db(c.env.DB);
  const send = (c: Ctx): SendEmail => deps.sendEmail ?? resendSender(c.env.RESEND_API_KEY, c.env.RESEND_FROM);
  const ip = (c: Ctx) => c.req.header("cf-connecting-ip") ?? "unknown";
  const origin = (c: Ctx) => new URL(c.req.url).origin;

  function startSession(c: Ctx, token: string) {
    setCookie(c, SESSION_COOKIE, token, { path: "/", secure: true, httpOnly: true, sameSite: "Lax", maxAge: SESSION_SECONDS });
  }

  async function limited(c: Ctx, key: string, [max, window]: readonly [number, number]): Promise<boolean> {
    return (await db(c).attempts(key, window, now())) >= max;
  }

  /** Render with a status, never cached: every account page depends on who's asking. */
  function page(c: Ctx, body: Parameters<Ctx["html"]>[0], status = 200) {
    c.header("cache-control", "no-store");
    return c.html(body, status as 200);
  }

  async function form(c: Ctx): Promise<Record<string, string>> {
    const body = await c.req.parseBody();
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) if (typeof v === "string") out[k] = v;
    return out;
  }

  // ------------------------------------------------------------ middleware

  app.use("*", async (c, next) => {
    const method = c.req.method;
    if (method !== "GET" && method !== "HEAD" && method !== "POST") {
      c.res = new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD, POST" } });
    } else if (method === "POST" && c.req.header("origin") !== origin(c)) {
      // Every POST comes from this site's own forms (ACCOUNTS-SPEC.md §5.3).
      const err = new AppError("AUTH_ORIGIN", "POST without this site's Origin");
      c.res = new Response("Forbidden", { status: err.status });
    } else {
      // The signed-in user, if any.
      const token = getCookie(c, SESSION_COOKIE) ?? null;
      let user: User | null = null;
      if (token) {
        const found = await db(c).userForSession(token, now());
        if (found) {
          user = found.user;
          if (found.extended) startSession(c, token);
        } else {
          deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
        }
      }
      c.set("user", user);
      c.set("token", user ? token : null);
      await next();
    }
    const res = new Response(c.res.body, c.res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
    c.res = res;
  });

  /** Signed-in pages: off to sign in (and back) otherwise. */
  function requireUser(c: Ctx): User | Response {
    const user = c.get("user");
    if (user) return user;
    return c.redirect(`/account/sign-in?next=${encodeURIComponent(new URL(c.req.url).pathname)}`, 303);
  }

  // ------------------------------------------------------------ account

  app.get("/account", (c) => {
    const user = c.get("user");
    if (!user) return page(c, <SignedOutPage />);
    const done = { profile: MSG.profileSaved, password: MSG.passwordSaved, email: MSG.emailSent, changed: MSG.emailChanged, everywhere: MSG.signedOutAll, welcome: MSG.verified, reset: MSG.resetDone }[
      c.req.query("done") ?? ""
    ];
    return page(c, <AccountPage user={user} done={done} />);
  });

  // ------------------------------------------------------------ sign up

  function signUpZone(c: Ctx): string {
    return canonicalZone(c.req.query("dtz")) ?? DEFAULT_TZ;
  }

  app.get("/account/sign-up", (c) => {
    if (c.get("user")) return c.redirect("/account", 303);
    return page(c, <SignUpPage values={{ zone: signUpZone(c), next: safeNext(c.req.query("next")) }} />);
  });

  app.post("/account/sign-up", async (c) => {
    const f = await form(c);
    const name = clean(f.name);
    const email = clean(f.email).toLowerCase();
    const password = typeof f.password === "string" ? f.password : "";
    const zone = canonicalZone(clean(f.zone)) ?? DEFAULT_TZ;
    const next = safeNext(f.next);
    const values = { name, email, zone, next };
    const errors: Errors = {};
    if (!name) errors.name = MSG.nameRequired;
    else if (name.length > LIMITS.name) errors.name = MSG.nameLong;
    if (!EMAIL_RE.test(email) || email.length > LIMITS.email) errors.email = MSG.emailInvalid;
    if (password.length < LIMITS.passwordMin) errors.password = MSG.passwordShort;
    else if (password.length > LIMITS.passwordMax) errors.password = MSG.passwordLong;
    if (Object.keys(errors).length) return page(c, <SignUpPage values={values} errors={errors} />, 400);

    const t = now();
    if (await limited(c, `signup:${ip(c)}`, RATE.signUpIp)) return page(c, <SignUpPage values={values} errors={{ form: MSG.limit }} />, 429);
    await db(c).recordAttempt(`signup:${ip(c)}`, t);

    const existing = await db(c).userByEmail(email);
    if (existing) {
      // An address nobody confirmed within a day is free again, so it can't be held by someone who doesn't own it.
      if (!existing.email_verified && existing.created_at < t - 24 * 3600) await db(c).deleteUser(existing.user_id);
      else return page(c, <SignUpPage values={values} errors={{ email: MSG.emailTaken }} />, 400);
    }
    const user = await db(c).createUser({ name, email, zone, passwordHash: await hashPassword(password) }, t);
    try {
      await sendConfirm(c, user, "verify", email, next);
    } catch (e) {
      // The account exists; "Send it again" on the next page retries.
      reportFatal(c, toAppError(e));
    }
    return page(c, <CheckEmailPage email={email} />);
  });

  async function sendConfirm(c: Ctx, user: User, purpose: "verify" | "change", to: string, next?: string) {
    const token = await db(c).createToken(user.user_id, purpose, now(), purpose === "change" ? to : null);
    const link = `${origin(c)}/account/verify?t=${encodeURIComponent(token)}${purpose === "change" ? "&change=1" : ""}${next ? `&next=${encodeURIComponent(next)}` : ""}`;
    await send(c)(confirmEmail(to, user.name, link));
  }

  app.post("/account/verify/send", async (c) => {
    const f = await form(c);
    const email = clean(f.email).toLowerCase();
    const t = now();
    if (await limited(c, `email:${ip(c)}`, RATE.emailIp)) return page(c, <CheckEmailPage email={email} />, 429);
    await db(c).recordAttempt(`email:${ip(c)}`, t);
    // Sends only to an account that exists and isn't confirmed yet; the page is the same either way.
    const user = await db(c).userByEmail(email);
    if (user && !user.email_verified) {
      try {
        await sendConfirm(c, user, "verify", user.email);
      } catch (e) {
        reportFatal(c, toAppError(e));
      }
    }
    return page(c, <CheckEmailPage email={email} sent />);
  });

  // ------------------------------------------------------------ confirm (emailed link)

  app.get("/account/verify", async (c) => {
    const token = c.req.query("t") ?? "";
    const change = c.req.query("change") === "1";
    if (!(await db(c).peekToken(token, change ? "change" : "verify", now()))) return invalidLink(c);
    return page(
      c,
      // PRINTED OUTPUT: confirm email / title and button
      <ConfirmLinkPage action={`/account/verify${change ? "?change=1" : ""}`} token={token} title="Confirm your email" button="Confirm email">
        {safeNext(c.req.query("next")) ? <input type="hidden" name="next" value={safeNext(c.req.query("next"))} /> : null}
      </ConfirmLinkPage>,
    );
  });

  app.post("/account/verify", async (c) => {
    const f = await form(c);
    const change = c.req.query("change") === "1";
    const t = now();
    const taken = await db(c).takeToken(clean(f.t), change ? "change" : "verify", t);
    if (!taken) return invalidLink(c);
    if (change && taken.new_email) {
      if (await db(c).userByEmail(taken.new_email)) return invalidLink(c);
      await db(c).setEmail(taken.user_id, taken.new_email);
      return c.redirect("/account?done=changed", 303);
    }
    await db(c).markVerified(taken.user_id);
    startSession(c, await db(c).createSession(taken.user_id, t));
    return c.redirect(safeNext(f.next) ?? "/account?done=welcome", 303);
  });

  function invalidLink(c: Ctx) {
    // PRINTED OUTPUT: email link / expired, used or wrong
    return page(c, <MessagePage title="This link doesn't work" message="It may have expired or been used already. Ask for a new one." href="/account" linkText="Go to your account" />, new AppError("TOKEN_INVALID", "").status);
  }

  // ------------------------------------------------------------ sign in and out

  app.get("/account/sign-in", (c) => {
    if (c.get("user")) return c.redirect(safeNext(c.req.query("next")) ?? "/account", 303);
    return page(c, <SignInPage next={safeNext(c.req.query("next"))} />);
  });

  app.post("/account/sign-in", async (c) => {
    const f = await form(c);
    const email = clean(f.email).toLowerCase();
    const password = typeof f.password === "string" ? f.password : "";
    const next = safeNext(f.next);
    const t = now();
    const emailKey = `signin:${await sha256Hex(email)}`;
    if ((await limited(c, emailKey, RATE.signInEmail)) || (await limited(c, `signin:${ip(c)}`, RATE.signInIp))) {
      return page(c, <SignInPage email={email} next={next} error={MSG.limit} />, 429);
    }
    const user = await db(c).userByEmail(email);
    // Check against a dummy hash when there's no account, so both answers take the same time.
    const ok = await checkPassword(password, user?.password_hash ?? (await dummyPasswordHash()));
    if (!user || !user.password_hash || !ok) {
      await db(c).recordAttempt(emailKey, t);
      await db(c).recordAttempt(`signin:${ip(c)}`, t);
      return page(c, <SignInPage email={email} next={next} error={MSG.badSignIn} />, 400);
    }
    if (!user.email_verified) return page(c, <CheckEmailPage email={user.email} />);
    startSession(c, await db(c).createSession(user.user_id, t));
    return c.redirect(next ?? "/account", 303);
  });

  app.post("/account/sign-out", async (c) => {
    const token = c.get("token");
    if (token) await db(c).deleteSession(token);
    deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
    return c.redirect("/account", 303);
  });

  app.post("/account/sign-out-everywhere", async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    await db(c).deleteSessions(user.user_id, c.get("token") ?? undefined);
    return c.redirect("/account?done=everywhere", 303);
  });

  // ------------------------------------------------------------ reset a forgotten password

  app.get("/account/reset", (c) => page(c, <ResetRequestPage />));

  app.post("/account/reset", async (c) => {
    const f = await form(c);
    const email = clean(f.email).toLowerCase();
    const t = now();
    if (await limited(c, `email:${ip(c)}`, RATE.emailIp)) return page(c, <ResetRequestPage email={email} error={MSG.limit} />, 429);
    await db(c).recordAttempt(`email:${ip(c)}`, t);
    const user = await db(c).userByEmail(email);
    if (user) {
      const token = await db(c).createToken(user.user_id, "reset", t);
      try {
        await send(c)(resetEmail(user.email, user.name, `${origin(c)}/account/reset/new?t=${encodeURIComponent(token)}`));
      } catch (e) {
        reportFatal(c, toAppError(e));
      }
    }
    // The same answer whether or not the address has an account.
    return page(c, <ResetRequestPage sent />);
  });

  function newPasswordPage(c: Ctx, token: string, error?: string, status = 200) {
    return page(
      c,
      // PRINTED OUTPUT: new password / title, field and button
      <ConfirmLinkPage action="/account/reset/new" token={token} title="Choose a new password" button="Change password">
        <Field
          label="New password"
          name="password"
          type="password"
          error={error}
          required
          autocomplete="new-password"
          minlength={LIMITS.passwordMin}
          maxlength={LIMITS.passwordMax}
          hint={`At least ${LIMITS.passwordMin} characters.`}
        />
      </ConfirmLinkPage>,
      status,
    );
  }

  app.get("/account/reset/new", async (c) => {
    const token = c.req.query("t") ?? "";
    if (!(await db(c).peekToken(token, "reset", now()))) return invalidLink(c);
    return newPasswordPage(c, token);
  });

  app.post("/account/reset/new", async (c) => {
    const f = await form(c);
    const token = clean(f.t);
    const password = typeof f.password === "string" ? f.password : "";
    const t = now();
    if (!(await db(c).peekToken(token, "reset", t))) return invalidLink(c);
    if (password.length < LIMITS.passwordMin) return newPasswordPage(c, token, MSG.passwordShort, 400);
    if (password.length > LIMITS.passwordMax) return newPasswordPage(c, token, MSG.passwordLong, 400);
    const taken = await db(c).takeToken(token, "reset", t);
    if (!taken) return invalidLink(c);
    await db(c).setPassword(taken.user_id, await hashPassword(password));
    // Opening the link proves the address, too.
    await db(c).markVerified(taken.user_id);
    await db(c).deleteSessions(taken.user_id);
    startSession(c, await db(c).createSession(taken.user_id, t));
    return c.redirect("/account?done=reset", 303);
  });

  // ------------------------------------------------------------ settings

  app.post("/account/profile", async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    const f = await form(c);
    const name = clean(f.name);
    const bio = clean(f.bio).replace(/\r\n/g, "\n");
    const zone = canonicalZone(clean(f.zone)) ?? user.zone;
    const visibility = f.visibility === "public" ? "public" : "private";
    const errors: Errors = {};
    if (!name) errors.name = MSG.nameRequired;
    else if (name.length > LIMITS.name) errors.name = MSG.nameLong;
    if (bio.length > LIMITS.bio) errors.bio = MSG.bioLong;
    if (Object.keys(errors).length) return page(c, <AccountPage user={user} errors={errors} draft={{ name, bio }} />, 400);
    await db(c).updateProfile(user.user_id, { name, bio, zone, visibility });
    return c.redirect("/account?done=profile", 303);
  });

  app.post("/account/password", async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    const f = await form(c);
    const current = typeof f.current === "string" ? f.current : "";
    const password = typeof f.password === "string" ? f.password : "";
    const errors: Errors = {};
    if (!user.password_hash || !(await checkPassword(current, user.password_hash))) errors.current = MSG.passwordWrong;
    if (password.length < LIMITS.passwordMin) errors.password = MSG.passwordShort;
    else if (password.length > LIMITS.passwordMax) errors.password = MSG.passwordLong;
    if (Object.keys(errors).length) return page(c, <AccountPage user={user} errors={errors} />, 400);
    await db(c).setPassword(user.user_id, await hashPassword(password));
    await db(c).deleteSessions(user.user_id, c.get("token") ?? undefined);
    return c.redirect("/account?done=password", 303);
  });

  app.post("/account/email", async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    const f = await form(c);
    const email = clean(f.email).toLowerCase();
    if (email === user.email.toLowerCase()) return c.redirect("/account", 303);
    if (!EMAIL_RE.test(email) || email.length > LIMITS.email) return page(c, <AccountPage user={user} errors={{ email: MSG.emailInvalid }} draft={{ email }} />, 400);
    if (await db(c).userByEmail(email)) return page(c, <AccountPage user={user} errors={{ email: MSG.emailTaken }} draft={{ email }} />, 400);
    const t = now();
    if (await limited(c, `email:${ip(c)}`, RATE.emailIp)) return page(c, <AccountPage user={user} errors={{ form: MSG.limit }} />, 429);
    await db(c).recordAttempt(`email:${ip(c)}`, t);
    try {
      await sendConfirm(c, user, "change", email);
    } catch (e) {
      reportFatal(c, toAppError(e));
      return page(c, <AccountPage user={user} errors={{ form: MSG.emailSend }} draft={{ email }} />, 503);
    }
    return c.redirect("/account?done=email", 303);
  });

  app.post("/account/delete", async (c) => {
    const user = requireUser(c);
    if (user instanceof Response) return user;
    const f = await form(c);
    const password = typeof f.password === "string" ? f.password : "";
    if (!user.password_hash || !(await checkPassword(password, user.password_hash))) {
      return page(c, <AccountPage user={user} errors={{ delete: MSG.passwordWrong }} />, 400);
    }
    await db(c).deleteUser(user.user_id);
    deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
    // PRINTED OUTPUT: account deleted / title, message and link
    return page(c, <MessagePage title="Account deleted" message="Your account and everything in it are gone." href="/" linkText="Go to the calendar" />);
  });

  // ------------------------------------------------------------ errors

  function reportFatal(c: Ctx, err: AppError): string {
    const ref = newRef();
    logError(log, err, ref, [c.env.RESEND_API_KEY]);
    return ref;
  }

  app.get("*", async (c) => {
    // Local dev only: the stylesheets and scripts (in production these paths are the main Worker's).
    if (c.env.ASSETS) {
      const res = await c.env.ASSETS.fetch(c.req.raw);
      if (res.status !== 404) return res;
    }
    return c.notFound();
  });

  app.notFound((c) => {
    // PRINTED OUTPUT: 404 page / title and message
    return c.html(StatusPage({ title: "Page not found", message: "Incorrect address.", homeHref: "/account" }), 404, { "cache-control": "no-store" });
  });

  app.onError((e, c) => {
    const err = toAppError(e);
    const ref = reportFatal(c as Ctx, err);
    // PRINTED OUTPUT: 500 page / title and message
    const pageBody = StatusPage({ title: "Something went wrong", message: `An unknown error occurred. Try again. (${err.code} · ref ${ref})`, homeHref: "/account" });
    return c.html(pageBody, err.status, { "cache-control": "no-store" });
  });

  return app;
}
