import { beforeEach, describe, expect, it } from "vitest";
import { NOW, ORIGIN, PASSWORD, accountsEnv, decode, linkIn, makeAccounts, resetDb, signedUp } from "./helpers";

beforeEach(resetDb);

const DAY = 24 * 3600 * 1000;

async function userRow(email: string) {
  return accountsEnv.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<Record<string, unknown>>();
}

describe("signed out", () => {
  it("/account offers sign in and create account, never cached, with the site's headers", async () => {
    const a = makeAccounts();
    const res = await a.browser().get("/account");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    const html = await res.text();
    expect(html).toContain('href="/account/sign-in"');
    expect(html).toContain('href="/account/sign-up"');
  });

  it("signed-in pages send you to sign in, and back", async () => {
    const a = makeAccounts();
    const res = await a.browser().post("/account/profile", { name: "X" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/account/sign-in?next=%2Faccount%2Fprofile");
  });
});

describe("sign up and confirm", () => {
  it("creates an unconfirmed account and emails a link; the password is only stored hashed", async () => {
    const a = makeAccounts();
    const b = a.browser();
    const res = await b.post("/account/sign-up", { username: "ada", name: "Ada Lovelace", email: "Ada@Example.com", password: PASSWORD, zone: "Asia/Tokyo" });
    // Signed in straight away, with a notice to confirm.
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/account?done=signedup");
    expect(b.cookie).not.toBeNull();
    const html = decode(await (await b.get("/account?done=signedup")).text());
    expect(html).toContain("Welcome to freetime.");
    expect(html).toContain("Confirm your email: we sent a link to ada@example.com. Until then, your profile stays hidden.");
    const row = (await userRow("ada@example.com"))!;
    expect(row.email_verified).toBe(0);
    expect(row.zone).toBe("Asia/Tokyo");
    expect(row.visibility).toBe("private");
    expect(String(row.password_hash)).toMatch(/^pbkdf2-sha256\$100000\$/);
    expect(JSON.stringify(row)).not.toContain(PASSWORD);
    expect(a.emails).toHaveLength(1);
    expect(a.emails[0]!.to).toBe("ada@example.com");
    expect(a.emails[0]!.subject).toBe("Confirm your email for freetime");
    expect(linkIn(a.emails[0]!)).toMatch(/^\/account\/verify\?t=/);
  });

  it("shows mistakes next to their fields", async () => {
    const a = makeAccounts();
    const res = await a.browser().post("/account/sign-up", { username: "nope", name: "", email: "nope", password: "short", zone: "Europe/London" });
    expect(res.status).toBe(400);
    const html = decode(await res.text());
    expect(html).toContain("Enter your name.");
    expect(html).toContain("Enter an email address, like name@example.com.");
    expect(html).toContain("Use at least 10 characters.");
    expect(a.emails).toHaveLength(0);
  });

  it("an unknown zone falls back to Europe/London; dtz fills the form without JS", async () => {
    const a = makeAccounts();
    await a.browser().post("/account/sign-up", { username: "b__", name: "B", email: "b@example.com", password: PASSWORD, zone: "Mars/Olympus" });
    expect((await userRow("b@example.com"))!.zone).toBe("Europe/London");
    const html = await (await a.browser().get("/account/sign-up?dtz=America/New_York")).text();
    expect(html).toMatch(/name="zone" value="America\/New_York" data-device-zone=""/);
  });

  it("can sign in before confirming, with the notice and Send it again", async () => {
    const a = makeAccounts();
    await a.browser().post("/account/sign-up", { username: "ada", name: "Ada", email: "ada@example.com", password: PASSWORD, zone: "Europe/London" });
    const b = a.browser();
    const res = await b.post("/account/sign-in", { email: "ada@example.com", password: PASSWORD });
    expect(res.headers.get("location")).toBe("/account");
    expect(decode(await (await b.get("/account")).text())).toContain("Confirm your email");
    const again = await b.post("/account/verify/send", {});
    expect(again.headers.get("location")).toBe("/account?done=resent");
    expect(a.emails).toHaveLength(2);
    expect(a.emails[1]!.to).toBe("ada@example.com");
  });

  it("the link shows a button first; pressing it confirms and signs you in", async () => {
    const a = makeAccounts();
    const b = a.browser();
    await b.post("/account/sign-up", { username: "ada", name: "Ada Lovelace", email: "ada@example.com", password: PASSWORD, zone: "Europe/London" });
    const link = linkIn(a.emails[0]!);
    const view = await b.get(link);
    expect(view.status).toBe(200);
    expect((await userRow("ada@example.com"))!.email_verified).toBe(0); // opening the link changes nothing
    const token = new URL(link, ORIGIN).searchParams.get("t")!;
    const res = await b.post("/account/verify", { t: token });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/account?done=welcome");
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("__Host-session="))!;
    expect(cookie).toMatch(/; Path=\//);
    expect(cookie).toMatch(/; Secure/);
    expect(cookie).toMatch(/; HttpOnly/);
    expect(cookie).toMatch(/; SameSite=Lax/);
    expect(cookie).not.toMatch(/Domain=/i);
    expect((await userRow("ada@example.com"))!.email_verified).toBe(1);
    const html = decode(await (await b.get("/account?done=welcome")).text());
    expect(html).toContain("Email confirmed. Welcome to freetime.");
    expect(html).toContain("Ada Lovelace");
    // The cookie value isn't stored, only its hash.
    const sessions = await accountsEnv.DB.prepare("SELECT token_hash FROM sessions").all<{ token_hash: string }>();
    expect(sessions.results.map((r) => r.token_hash)).not.toContain(b.cookie);
  });

  it("a link works once, and not after it expires", async () => {
    const a = makeAccounts();
    const b = a.browser();
    await b.post("/account/sign-up", { username: "ada", name: "Ada", email: "ada@example.com", password: PASSWORD, zone: "Europe/London" });
    const token = new URL(linkIn(a.emails[0]!), ORIGIN).searchParams.get("t")!;
    a.setNow(NOW + DAY + 1000);
    expect((await b.post("/account/verify", { t: token })).status).toBe(400);
    a.setNow(NOW);
    await b.post("/account/verify/send", { email: "ada@example.com" });
    const fresh = new URL(linkIn(a.emails[1]!), ORIGIN).searchParams.get("t")!;
    expect((await b.post("/account/verify", { t: fresh })).status).toBe(303);
    expect((await a.browser().post("/account/verify", { t: fresh })).status).toBe(400);
  });

  it("an address taken but never confirmed is free again after a day", async () => {
    const a = makeAccounts();
    await a.browser().post("/account/sign-up", { username: "ada", name: "Squatter", email: "ada@example.com", password: PASSWORD, zone: "Europe/London" });
    const again = await a.browser().post("/account/sign-up", { username: "ada", name: "Ada", email: "ada@example.com", password: PASSWORD, zone: "Europe/London" });
    expect(decode(await again.text())).toContain("An account already uses this email.");
    a.setNow(NOW + DAY + 1000);
    await a.browser().post("/account/sign-up", { username: "ada", name: "Ada", email: "ada@example.com", password: PASSWORD, zone: "Europe/London" });
    expect((await userRow("ada@example.com"))!.name).toBe("Ada");
  });

  it("asks for a username: stored lower-case, checked, unique ignoring case", async () => {
    const a = makeAccounts();
    const form = await (await a.browser().get("/account/sign-up")).text();
    expect(form).toMatch(/<input id="f-username" name="username" type="text"[^>]*required=""[^>]*maxlength="20" minlength="3"/);
    await a.browser().post("/account/sign-up", { username: "@Ada_L", name: "Ada", email: "ada@example.com", password: PASSWORD, zone: "Europe/London" });
    expect((await userRow("ada@example.com"))!.username).toBe("ada_l");
    const cases: [string, string][] = [
      ["", "Choose a username."],
      ["ab", "Use at least 3 characters."],
      ["a".repeat(21), "Use 20 characters or fewer."],
      ["ada-l", "Use only letters, numbers and _."],
      ["account", "That username is taken by the site. Try another."],
      ["ADA_L", "Someone already has that username. Try another."],
    ];
    for (const [username, message] of cases) {
      const res = await a.browser().post("/account/sign-up", { username, name: "B", email: "b@example.com", password: PASSWORD, zone: "Europe/London" });
      expect(res.status, username).toBe(400);
      expect(decode(await res.text()), username).toContain(message);
    }
    expect(await userRow("b@example.com")).toBeNull();
  });

  it("if Resend fails, the account still exists and the failure is logged without the address", async () => {
    const a = makeAccounts();
    a.failEmail(true);
    const res = await a.browser().post("/account/sign-up", { username: "ada", name: "Ada", email: "ada@example.com", password: PASSWORD, zone: "Europe/London" });
    expect(res.status).toBe(303);
    expect(await userRow("ada@example.com")).not.toBeNull();
    expect(a.logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(a.logs)).not.toContain("ada@example.com");
  });
});

describe("sign in and out", () => {
  it("signs in, and sign out ends the session", async () => {
    const a = makeAccounts();
    await signedUp(a);
    const b = a.browser();
    const res = await b.post("/account/sign-in", { email: "ADA@example.com", password: PASSWORD, next: "/account?x=1" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/account?x=1");
    const cookie = b.cookie!;
    expect(decode(await (await b.get("/account")).text())).toContain("Ada Lovelace");
    await b.post("/account/sign-out", {});
    expect(b.cookie).toBeNull();
    b.cookie = cookie; // a copied cookie stops working once signed out
    expect(await (await b.get("/account")).text()).toContain('href="/account/sign-in"');
  });

  it("a wrong password and an unknown email get the same message", async () => {
    const a = makeAccounts();
    await signedUp(a);
    const wrong = decode(await (await a.browser().post("/account/sign-in", { email: "ada@example.com", password: "nope nope nope" })).text());
    const unknown = decode(await (await a.browser().post("/account/sign-in", { email: "who@example.com", password: "nope nope nope" })).text());
    for (const html of [wrong, unknown]) expect(html).toContain("That email and password don't match an account.");
  });

  it("never follows next to another site", async () => {
    const a = makeAccounts();
    await signedUp(a);
    for (const next of ["//evil.example/", "https://evil.example/", "/\\evil.example"]) {
      const res = await a.browser().post("/account/sign-in", { email: "ada@example.com", password: PASSWORD, next });
      expect(res.headers.get("location")).toBe("/account");
    }
  });

  it("limits failed sign-ins per email", async () => {
    const a = makeAccounts();
    await signedUp(a);
    for (let i = 0; i < 10; i++) await a.browser().post("/account/sign-in", { email: "ada@example.com", password: "wrong password" });
    const res = await a.browser().post("/account/sign-in", { email: "ada@example.com", password: PASSWORD });
    expect(res.status).toBe(429);
    a.setNow(NOW + 16 * 60 * 1000);
    expect((await a.browser().post("/account/sign-in", { email: "ada@example.com", password: PASSWORD })).status).toBe(303);
  });

  it("sessions last 30 days, extended when used", async () => {
    const a = makeAccounts();
    const b = await signedUp(a);
    a.setNow(NOW + 20 * DAY);
    expect(decode(await (await b.get("/account")).text())).toContain("Ada Lovelace");
    a.setNow(NOW + 45 * DAY); // 25 days after the last use
    expect(decode(await (await b.get("/account")).text())).toContain("Ada Lovelace");
    a.setNow(NOW + 80 * DAY);
    expect(await (await b.get("/account")).text()).toContain('href="/account/sign-in"');
  });
});

describe("every POST must come from the site", () => {
  it.each([[{}], [{ origin: "https://evil.example" }], [{ origin: "null" }]])("refuses %j with 403", async (headers) => {
    const a = makeAccounts();
    const b = await signedUp(a);
    const res = await b.post("/account/profile", { name: "Hacked", bio: "", zone: "Europe/London", visibility: "public" }, { origin: "", ...headers });
    expect(res.status).toBe(403);
    expect((await userRow("ada@example.com"))!.name).toBe("Ada Lovelace");
  });
});

describe("the account page", () => {
  it("edits name, bio, time zone and visibility", async () => {
    const a = makeAccounts();
    const b = await signedUp(a);
    const res = await b.post("/account/profile", { name: "Ada K.", bio: "Analyst.\nEngine fan.", zone: "Asia/Tokyo", visibility: "public" });
    expect(res.headers.get("location")).toBe("/account?done=profile");
    const row = (await userRow("ada@example.com"))!;
    expect([row.name, row.bio, row.zone, row.visibility]).toEqual(["Ada K.", "Analyst.\nEngine fan.", "Asia/Tokyo", "public"]);
    const html = decode(await (await b.get("/account?done=profile")).text());
    expect(html).toContain("Profile saved.");
    expect(html).toContain("Asia/Tokyo");
    expect(html).toMatch(/value="public" checked=""/);
  });

  it("edits the username in Profile; a form without it keeps it", async () => {
    const a = makeAccounts();
    const b = await signedUp(a);
    await signedUp(a, "grace@example.com", "Grace Hopper");
    const base = { name: "Ada", bio: "", zone: "Europe/London", visibility: "private" };
    expect((await b.post("/account/profile", { ...base, username: "Countess" })).status).toBe(303);
    expect((await userRow("ada@example.com"))!.username).toBe("countess");
    await b.post("/account/profile", base);
    expect((await userRow("ada@example.com"))!.username).toBe("countess");
    const taken = await b.post("/account/profile", { ...base, username: "GRACE" });
    expect(taken.status).toBe(400);
    const html = decode(await taken.text());
    expect(html).toContain("Someone already has that username. Try another.");
    expect(html).toContain('value="grace"');
    expect((await b.post("/account/profile", { ...base, username: "help" })).status).toBe(400);
    expect((await userRow("ada@example.com"))!.username).toBe("countess");
  });

  it("refuses an empty name and a long bio, keeping what you typed", async () => {
    const a = makeAccounts();
    const b = await signedUp(a);
    const res = await b.post("/account/profile", { name: "", bio: "x".repeat(281), zone: "Europe/London", visibility: "private" });
    expect(res.status).toBe(400);
    const html = decode(await res.text());
    expect(html).toContain("Enter your name.");
    expect(html).toContain("Use 280 characters or fewer.");
    expect((await userRow("ada@example.com"))!.name).toBe("Ada Lovelace");
  });

  it("changing the password needs the current one and signs out other sessions", async () => {
    const a = makeAccounts();
    const b = await signedUp(a);
    const other = a.browser();
    await other.post("/account/sign-in", { email: "ada@example.com", password: PASSWORD });
    expect((await b.post("/account/password", { current: "wrong wrong wrong", password: "a new password" })).status).toBe(400);
    expect((await b.post("/account/password", { current: PASSWORD, password: "a new password" })).headers.get("location")).toBe("/account?done=password");
    expect(decode(await (await b.get("/account")).text())).toContain("Ada Lovelace");
    expect(await (await other.get("/account")).text()).toContain('href="/account/sign-in"');
    expect((await a.browser().post("/account/sign-in", { email: "ada@example.com", password: "a new password" })).status).toBe(303);
  });

  it("changing the email confirms the new address first", async () => {
    const a = makeAccounts();
    const b = await signedUp(a);
    expect((await b.post("/account/email", { email: "ada@new.example" })).headers.get("location")).toBe("/account?done=email");
    const mail = a.emails[a.emails.length - 1]!;
    expect(mail.to).toBe("ada@new.example");
    expect((await userRow("ada@example.com"))).not.toBeNull();
    const token = new URL(linkIn(mail), ORIGIN).searchParams.get("t")!;
    expect((await b.post("/account/verify?change=1", { t: token })).headers.get("location")).toBe("/account?done=changed");
    expect(await userRow("ada@new.example")).not.toBeNull();
    expect(await userRow("ada@example.com")).toBeNull();
  });

  it("sign out everywhere keeps this session only", async () => {
    const a = makeAccounts();
    const b = await signedUp(a);
    const other = a.browser();
    await other.post("/account/sign-in", { email: "ada@example.com", password: PASSWORD });
    await b.post("/account/sign-out-everywhere", {});
    expect(decode(await (await b.get("/account")).text())).toContain("Ada Lovelace");
    expect(await (await other.get("/account")).text()).toContain('href="/account/sign-in"');
  });

  it("delete account needs the password and removes everything", async () => {
    const a = makeAccounts();
    const b = await signedUp(a);
    expect((await b.post("/account/delete", { password: "wrong wrong wrong" })).status).toBe(400);
    const res = await b.post("/account/delete", { password: PASSWORD });
    expect(decode(await res.text())).toContain("Your account and everything in it are gone.");
    expect(await userRow("ada@example.com")).toBeNull();
    const left = await accountsEnv.DB.prepare("SELECT (SELECT COUNT(*) FROM sessions) + (SELECT COUNT(*) FROM email_tokens) AS n").first<{ n: number }>();
    expect(left!.n).toBe(0);
    expect(b.cookie).toBeNull();
  });

  it("never shows the email to anyone but you, and never the password", async () => {
    const a = makeAccounts();
    const b = await signedUp(a);
    const mine = await (await b.get("/account")).text();
    expect(mine).toContain("ada@example.com");
    expect(mine).not.toContain(PASSWORD);
    const theirs = await (await a.browser().get("/account")).text();
    expect(theirs).not.toContain("ada@example.com");
  });
});

describe("forgotten password", () => {
  it("answers the same for unknown addresses, and sends nothing", async () => {
    const a = makeAccounts();
    const html = decode(await (await a.browser().post("/account/reset", { email: "who@example.com" })).text());
    expect(html).toContain("If that address has an account, we've sent a link to reset its password.");
    expect(a.emails).toHaveLength(0);
  });

  it("the link sets a new password once, and signs out everywhere else", async () => {
    const a = makeAccounts();
    const old = await signedUp(a);
    const b = a.browser();
    await b.post("/account/reset", { email: "ada@example.com" });
    const mail = a.emails[a.emails.length - 1]!;
    expect(mail.subject).toBe("Reset your freetime password");
    const link = linkIn(mail);
    expect((await b.get(link)).status).toBe(200);
    const token = new URL(link, ORIGIN).searchParams.get("t")!;
    expect((await b.post("/account/reset/new", { t: token, password: "short" })).status).toBe(400);
    const res = await b.post("/account/reset/new", { t: token, password: "brand new password" });
    expect(res.headers.get("location")).toBe("/account?done=reset");
    expect(decode(await (await b.get("/account")).text())).toContain("Ada Lovelace");
    expect(await (await old.get("/account")).text()).toContain('href="/account/sign-in"');
    expect((await a.browser().post("/account/reset/new", { t: token, password: "another password" })).status).toBe(400);
    expect((await a.browser().post("/account/sign-in", { email: "ada@example.com", password: PASSWORD })).status).toBe(400);
  });

  it("expires after an hour", async () => {
    const a = makeAccounts();
    await signedUp(a);
    await a.browser().post("/account/reset", { email: "ada@example.com" });
    const token = new URL(linkIn(a.emails[a.emails.length - 1]!), ORIGIN).searchParams.get("t")!;
    a.setNow(NOW + 61 * 60 * 1000);
    expect((await a.browser().post("/account/reset/new", { t: token, password: "brand new password" })).status).toBe(400);
  });
});
