import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { type AccountsEnv, createAccountsApp } from "../../src/accounts/app";
import type { EmailMessage } from "../../src/accounts/email";

export const ORIGIN = "http://localhost";
/** Tue 3 Nov 2026, 14:20 UTC. */
export const NOW = Date.UTC(2026, 10, 3, 14, 20);

export const accountsEnv = env as unknown as AccountsEnv;

/** Every test starts from empty tables. */
export async function resetDb(): Promise<void> {
  await accountsEnv.DB.batch(["attempts", "email_tokens", "sessions", "users"].map((t) => accountsEnv.DB.prepare(`DELETE FROM ${t}`)));
}

export interface Browser {
  /** The session cookie this browser holds, if any. */
  cookie: string | null;
  get(path: string, headers?: Record<string, string>): Promise<Response>;
  post(path: string, fields: Record<string, string>, headers?: Record<string, string>): Promise<Response>;
}

export interface TestAccounts {
  browser(): Browser;
  emails: EmailMessage[];
  logs: Record<string, unknown>[];
  setNow(ms: number): void;
  /** Make the next sends fail, as if Resend were down. */
  failEmail(on: boolean): void;
}

/** The accounts app with a fixed clock, captured emails and logs, and browsers that keep their cookie. */
export function makeAccounts(): TestAccounts {
  let now = NOW;
  let fail = false;
  const emails: EmailMessage[] = [];
  const logs: Record<string, unknown>[] = [];
  const app = createAccountsApp({
    now: () => now,
    log: (e) => logs.push(e),
    sendEmail: async (m) => {
      if (fail) throw Object.assign(new Error("Resend down"), {});
      emails.push(m);
    },
  });

  async function request(path: string, init: RequestInit, jar: { cookie: string | null }): Promise<Response> {
    const headers = new Headers(init.headers);
    if (jar.cookie) headers.set("cookie", `__Host-session=${jar.cookie}`);
    const ctx = createExecutionContext();
    const res = await app.request(path, { ...init, headers }, accountsEnv, ctx);
    await waitOnExecutionContext(ctx);
    for (const line of res.headers.getSetCookie()) {
      const m = /^__Host-session=([^;]*)/.exec(line);
      if (m) jar.cookie = m[1] && !/Max-Age=0/i.test(line) ? m[1] : null;
    }
    return res;
  }

  return {
    browser() {
      const jar: { cookie: string | null } = { cookie: null };
      return {
        get cookie() {
          return jar.cookie;
        },
        set cookie(v) {
          jar.cookie = v;
        },
        get: (path, headers = {}) => request(path, { headers }, jar),
        post: (path, fields, headers = {}) =>
          request(path, { method: "POST", body: new URLSearchParams(fields), headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded", ...headers } }, jar),
      };
    },
    emails,
    logs,
    setNow(ms) {
      now = ms;
    },
    failEmail(on) {
      fail = on;
    },
  };
}

/** The link in an email's text. */
export function linkIn(m: EmailMessage): string {
  const link = /https?:\/\/\S+/.exec(m.text)?.[0];
  if (!link) throw new Error("no link in email");
  return link.replace(ORIGIN, "");
}

export const PASSWORD = "correct horse battery";

/** Sign up and confirm: returns a signed-in browser. */
export async function signedUp(a: TestAccounts, email = "ada@example.com", name = "Ada Lovelace"): Promise<Browser> {
  const b = a.browser();
  await b.post("/account/sign-up", { name, email, password: PASSWORD, zone: "Europe/London" });
  const link = linkIn(a.emails[a.emails.length - 1]!);
  const token = new URL(link, ORIGIN).searchParams.get("t")!;
  await b.post("/account/verify", { t: token });
  return b;
}

export function decode(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
