import { beforeEach, describe, expect, it } from "vitest";
import { accountsEnv, decode, makeAccounts, resetDb, signedUp } from "./helpers";
import { PALETTE_NAMES } from "../../src/parula";

beforeEach(resetDb);

const ADDRESS = "https://calendar.example/private-abc123/basic.ics";

/** Busy Wed 4 Nov 2026, 10:00–11:00 UTC. */
const FEED = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//test//EN",
  "BEGIN:VEVENT",
  "UID:secret-uid",
  "DTSTAMP:20261001T000000Z",
  "DTSTART:20261104T100000Z",
  "DTEND:20261104T110000Z",
  "SUMMARY:Secret meeting title",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

const WEEK = "?view=week&date=2026-11-02&dtz=Europe/London";

/** The profile's address: /@<username>. */
async function profilePath(email = "ada@example.com"): Promise<string> {
  const row = await accountsEnv.DB.prepare("SELECT username FROM users WHERE email = ?").bind(email).first<{ username: string }>();
  return `/@${row!.username}`;
}

async function publicId(email = "ada@example.com"): Promise<string> {
  const row = await accountsEnv.DB.prepare("SELECT public_id FROM users WHERE email = ?").bind(email).first<{ public_id: string }>();
  return row!.public_id;
}

describe("calendars", () => {
  it("adds a calendar: checked once, stored encrypted, never shown again", async () => {
    const a = makeAccounts({ calendars: { [ADDRESS]: FEED } });
    const b = await signedUp(a);
    const res = await b.post("/account/calendars", { label: "Work", address: ` ${ADDRESS} ` });
    expect(res.headers.get("location")).toBe("/account?done=calendar");
    expect(a.calendarFetches).toEqual([ADDRESS]);
    const row = await accountsEnv.DB.prepare("SELECT label, kind, secret FROM calendars").first<{ label: string; kind: string; secret: ArrayBuffer }>();
    expect([row!.label, row!.kind]).toEqual(["Work", "ical"]);
    expect(new TextDecoder().decode(new Uint8Array(row!.secret))).not.toContain("calendar.example");
    const html = decode(await (await b.get("/account?done=calendar")).text());
    expect(html).toContain("Calendar added.");
    expect(html).toContain("Work");
    expect(html).not.toContain(ADDRESS);
    expect(html).not.toContain("private-abc123");
  });

  it.each([
    ["not an address", "hello", "Paste the calendar's secret address"],
    ["http", "http://calendar.example/x.ics", "Paste the calendar's secret address"],
    ["credentials", "https://u:p@calendar.example/x.ics", "Paste the calendar's secret address"],
    ["unreachable", "https://nowhere.example/x.ics", "That address couldn't be reached. Check it and try again. (FEED_FETCH)"],
  ])("refuses %s, next to the field", async (_name, address, message) => {
    const a = makeAccounts();
    const b = await signedUp(a);
    const res = await b.post("/account/calendars", { label: "Work", address });
    expect(res.status).toBe(400);
    expect(decode(await res.text())).toContain(message);
    expect(await accountsEnv.DB.prepare("SELECT COUNT(*) AS n FROM calendars").first<{ n: number }>()).toEqual({ n: 0 });
  });

  it("refuses an address that answers with an error or isn't a calendar", async () => {
    const a = makeAccounts({ calendars: { [ADDRESS]: () => new Response("no", { status: 404 }), "https://calendar.example/page": "<html>not a calendar</html>" } });
    const b = await signedUp(a);
    expect(decode(await (await b.post("/account/calendars", { label: "W", address: ADDRESS })).text())).toContain("(FEED_STATUS_404)");
    expect(decode(await (await b.post("/account/calendars", { label: "W", address: "https://calendar.example/page" })).text())).toContain("isn't a calendar in iCal format. (FEED_PARSE)");
  });

  it("removes only your own calendars", async () => {
    const a = makeAccounts({ calendars: { [ADDRESS]: FEED } });
    const ada = await signedUp(a);
    await ada.post("/account/calendars", { label: "Work", address: ADDRESS });
    const id = (await accountsEnv.DB.prepare("SELECT calendar_id FROM calendars").first<{ calendar_id: number }>())!.calendar_id;
    const bob = await signedUp(a, "bob@example.com", "Bob");
    await bob.post("/account/calendars/remove", { id: String(id) });
    expect((await accountsEnv.DB.prepare("SELECT COUNT(*) AS n FROM calendars").first<{ n: number }>())!.n).toBe(1);
    await ada.post("/account/calendars/remove", { id: String(id) });
    expect((await accountsEnv.DB.prepare("SELECT COUNT(*) AS n FROM calendars").first<{ n: number }>())!.n).toBe(0);
  });

  it("deleting the account deletes its calendars", async () => {
    const a = makeAccounts({ calendars: { [ADDRESS]: FEED } });
    const b = await signedUp(a);
    await b.post("/account/calendars", { label: "Work", address: ADDRESS });
    await b.post("/account/delete", { password: "correct horse battery" });
    expect((await accountsEnv.DB.prepare("SELECT COUNT(*) AS n FROM calendars").first<{ n: number }>())!.n).toBe(0);
  });
});

describe("profiles", () => {
  it("shows busy times from the owner's calendars, never what they are", async () => {
    const a = makeAccounts({ calendars: { [ADDRESS]: FEED } });
    const b = await signedUp(a);
    await b.post("/account/calendars", { label: "Work", address: ADDRESS });
    const res = await a.browser().get((await profilePath()) + WEEK);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = decode(await res.text());
    expect(html).toContain('aria-label="Wed 4 Nov, 10:00–10:30, 100% busy"');
    expect(html).toContain('aria-label="Wed 4 Nov, 11:00–11:30, 0% busy"');
    for (const hidden of ["Secret meeting title", "secret-uid", "calendar.example", "Work", "ada@example.com"]) expect(html).not.toContain(hidden);
  });

  it("with no calendars, shows the owner as free", async () => {
    const a = makeAccounts();
    await signedUp(a);
    const html = decode(await (await a.browser().get((await profilePath()) + WEEK)).text());
    expect(html).toContain('aria-label="Wed 4 Nov, 10:00–10:30, 0% busy"');
  });

  it("private: name, bio and busy times; public adds time zone and member since", async () => {
    const a = makeAccounts();
    const b = await signedUp(a);
    await b.post("/account/profile", { name: "Ada", bio: "Engines.", zone: "Asia/Tokyo", visibility: "private" });
    const path = await profilePath();
    let html = decode(await (await a.browser().get(path + WEEK)).text());
    expect(html).toContain("Ada");
    expect(html).toContain("Engines.");
    expect(html).not.toContain("Asia/Tokyo");
    expect(html).not.toContain("Member since");
    await b.post("/account/profile", { name: "Ada", bio: "Engines.", zone: "Asia/Tokyo", visibility: "public" });
    html = decode(await (await a.browser().get(path + WEEK)).text());
    expect(html).toContain("Asia/Tokyo");
    expect(html).toContain("Member since November 2026");
  });

  it("the card: name, bio and the full profile link with Copy; the owner gets no Add friend", async () => {
    const a = makeAccounts();
    const b = await signedUp(a);
    await b.post("/account/profile", { name: "Ada Lovelace", bio: "Engines.", zone: "Europe/London", visibility: "private" });
    const html = decode(await (await b.get((await profilePath()) + WEEK)).text());
    const card = html.slice(html.indexOf('<section class="profile-card profile-strip"'), html.indexOf("</section>", html.indexOf('<section class="profile-card profile-strip"')));
    expect(card).toContain("Member since");
    expect(card).toContain('<p class="profile-bio">Engines.</p>');
    // The link text is the full address without https://, wrapped in left-to-right marks; Copy copies it with the scheme.
    expect(card).toContain('<span class="profile-link"><a href="/@ada">\u200elocalhost/@ada\u200e</a>');
    expect(card).toContain('data-copy="http://localhost/@ada"');
    expect(card).not.toContain("add-friend");
    expect(card).not.toContain('href="/account"');
  });

  it("signed out, the card's Add friend goes to sign in and back; signed in, phase 3 wires it", async () => {
    const a = makeAccounts();
    const b = await signedUp(a);
    const out = decode(await (await a.browser().get("/@ada?view=week")).text());
    expect(out).toMatch(/<a class="add-friend" data-state="signed-out" data-signin-tip="" href="\/account\/sign-in\?next=%2F%40ada%3Fview%3Dweek"/);
    const grace = await signedUp(a, "grace@example.com", "Grace Hopper");
    expect(await (await grace.get("/@ada")).text()).not.toContain("add-friend");
    expect(await (await b.get("/@ada")).text()).not.toContain("add-friend");
  });

  it("is drawn in the viewer's zone, and its links stay on the profile", async () => {
    const a = makeAccounts({ calendars: { [ADDRESS]: FEED } });
    const b = await signedUp(a);
    await b.post("/account/calendars", { label: "Work", address: ADDRESS });
    const path = await profilePath();
    const html = decode(await (await a.browser().get(`${path}?view=week&date=2026-11-02&dtz=Asia/Tokyo`)).text());
    expect(html).toContain('aria-label="Wed 4 Nov, 19:00–19:30, 100% busy"'); // 10:00 UTC is 19:00 in Tokyo
    const tabs = [...html.matchAll(/<a class="tab" href="([^"]+)"/g)].map((m) => m[1]!);
    expect(tabs.every((h) => h.startsWith(`${path}?`))).toBe(true);
    expect(html).toContain(`href="/tz?view=week&date=2026-11-02&back=${path}&dtz=Asia/Tokyo"`);
    const range = await (await a.browser().get(`${path}?view=range&from=2026-11-02&to=2026-11-04`)).text();
    expect(range).toContain(`action="${path}#`); // the Range form is a GET to the profile
  });

  it("has the site's top bar, the cog its only menu, and no Maxence pages", async () => {
    const a = makeAccounts();
    await signedUp(a);
    const html = await (await a.browser().get((await profilePath()) + WEEK)).text();
    const topbar = html.slice(html.indexOf('<header class="topbar"'), html.indexOf("</header>"));
    expect([...topbar.matchAll(/data-tb="([a-z]+)"/g)].map((m) => m[1])).toEqual(["tabs", "today", "prev", "next", "period", "tz", "indicator", "settings"]);
    // Without JS the cog goes to /account.
    expect(topbar).toMatch(/<a class="pill round tb-cog" id="tb-cog" data-tb="settings" data-settings="dlg-settings" href="\/account"/);
    expect(html).not.toContain('id="dlg-download"');
    expect(html).not.toContain('id="dlg-contact"');
    expect(html).toContain('id="dlg-help"');
  });

  it("signed out, the settings hold a sentence, Sign in and Create an account, Theme (the switch only) and Help", async () => {
    const a = makeAccounts();
    await signedUp(a);
    const html = decode(await (await a.browser().get("/@ada")).text());
    const dlg = html.slice(html.indexOf('<dialog class="settings"'), html.indexOf("</dialog>", html.indexOf('<dialog class="settings"')));
    expect(dlg).toContain("Sign in to show your free time on a profile, add friends and find a time together.");
    expect(dlg).toContain('href="/account/sign-in?next=%2F%40ada"');
    expect(dlg).toContain('href="/account/sign-up?next=%2F%40ada"');
    expect([...dlg.matchAll(/<span class="row-what">([^<]+)<\/span>/g)].map((m) => m[1])).toEqual(["Theme", "Help"]);
    expect(dlg).toContain('class="theme-switch" data-palette="parula"');
    expect(dlg).not.toContain("pal-btn");
    expect(dlg).toContain('data-dialog="dlg-help"');
  });

  it("signed in, the settings hold you, then Profile, Theme, Security, Calendars, Help and Sign out, coming back here", async () => {
    const a = makeAccounts();
    await signedUp(a);
    const grace = await signedUp(a, "grace@example.com", "Grace Hopper");
    const html = decode(await (await grace.get("/@ada?view=week")).text());
    const dlg = html.slice(html.indexOf('<dialog class="settings"'), html.indexOf("</dialog>", html.indexOf('<dialog class="settings"')));
    // The header is the viewer's own: name and full profile link with Copy.
    expect(dlg).toContain("<strong>Grace Hopper</strong>");
    expect(dlg).toContain('<a href="/@grace">\u200elocalhost/@grace\u200e</a>');
    expect(dlg).toContain('data-copy="http://localhost/@grace"');
    expect([...dlg.matchAll(/<span class="row-what">([^<]+)<\/span>/g)].map((m) => m[1])).toEqual(["Profile", "Theme", "Security", "Calendars", "Help", "Sign out"]);
    for (const action of ["/account/profile", "/account/picture", "/account/email", "/account/password", "/account/sign-out-everywhere", "/account/delete", "/account/calendars", "/account/palette", "/account/sign-out"]) {
      expect(dlg, action).toContain(`action="${action}"`);
    }
    // Every settings form comes back to this profile.
    expect(dlg).toContain('<input type="hidden" name="next" value="/@ada?view=week"/>');
    // Theme: the mode and the viewer's map in the head; the switch in the viewer's map.
    expect(dlg).toMatch(/<span class="row-values"><span data-theme-mode="true">Dark<\/span><span>parula<\/span><\/span>/);
    expect(dlg).toContain('class="theme-switch" data-palette="parula"');
    expect(dlg).toContain('aria-pressed="true" aria-label="Colour map: parula"');
    // Delete is last in Security, and asks for the password.
    expect(dlg).toContain('id="f-delete-password"');
  });

  it("a form sent from the modal comes back to the profile it was on", async () => {
    const a = makeAccounts();
    const b = await signedUp(a);
    const res = await b.post("/account/palette", { palette: "magma", next: "/@ada?view=week" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/@ada?view=week");
    const out = await b.post("/account/sign-out", { next: "/@ada" });
    expect(out.headers.get("location")).toBe("/@ada");
  });

  it("changing the username from the modal comes back to the profile at its new address", async () => {
    const a = makeAccounts();
    const b = await signedUp(a);
    const res = await b.post("/account/profile", { name: "Ada", username: "countess", bio: "", visibility: "private", next: "/@ada?view=week" });
    expect(res.headers.get("location")).toBe("/@countess?view=week");
    // Never anywhere but this site.
    const away = await b.post("/account/profile", { name: "Ada", bio: "", visibility: "private", next: "//evil.example" });
    expect(away.headers.get("location")).toBe("/account?done=profile");
  });

  it("a calendar that can't be loaded shows the error panel, not a free week", async () => {
    let up = true;
    const a = makeAccounts({ calendars: { [ADDRESS]: () => (up ? new Response(FEED) : new Response("down", { status: 500 })) } });
    const b = await signedUp(a);
    await b.post("/account/calendars", { label: "Work", address: ADDRESS });
    up = false;
    // The check on save was cached under its own key; the profile's first load has no saved copy.
    const res = await a.browser().get((await profilePath()) + WEEK);
    expect(res.status).toBe(503);
    expect(decode(await res.text())).toContain("FEED_STATUS_500");
  });

  it("unknown and unconfirmed profiles are 404", async () => {
    const a = makeAccounts();
    expect((await a.browser().get("/u/aaaaaaaaaa")).status).toBe(404);
    expect((await a.browser().get("/u/not-an-id")).status).toBe(404);
    await a.browser().post("/account/sign-up", { username: "eve", name: "Eve", email: "eve@example.com", password: "correct horse battery", zone: "Europe/London" });
    expect((await a.browser().get(await profilePath("eve@example.com"))).status).toBe(404);
  });
});

describe("profile addresses", () => {
  it("/@username is the profile, found ignoring case; other spellings move to the stored one", async () => {
    const a = makeAccounts();
    await signedUp(a);
    const res = await a.browser().get("/@ada" + WEEK);
    expect(res.status).toBe(200);
    expect(decode(await res.text())).toContain("Ada Lovelace");
    const upper = await a.browser().get("/@ADA?f=x");
    expect(upper.status).toBe(301);
    expect(upper.headers.get("location")).toBe("/@ada?f=x");
    for (const missing of ["/@nobody", "/@ab", "/@help"]) expect((await a.browser().get(missing)).status, missing).toBe(404);
  });

  it("/u/<id> moves for good to /@username, keeping the query and the friend invite", async () => {
    const a = makeAccounts();
    await signedUp(a);
    const res = await a.browser().get(`/u/${await publicId()}?f=abcdefghijklmnop&view=week`);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/@ada?f=abcdefghijklmnop&view=week");
  });

  it("/u/<id> still works for an account with no username yet", async () => {
    const a = makeAccounts();
    await signedUp(a);
    await accountsEnv.DB.prepare("UPDATE users SET username = NULL").run();
    const id = await publicId();
    const res = await a.browser().get(`/u/${id}` + WEEK);
    expect(res.status).toBe(200);
    const html = decode(await res.text());
    const tabs = [...html.matchAll(/<a class="tab" href="([^"]+)"/g)].map((m) => m[1]!);
    expect(tabs.every((h) => h.startsWith(`/u/${id}?`))).toBe(true);
  });

  it("the share link is /@username with the friend invite", async () => {
    const a = makeAccounts();
    const b = await signedUp(a);
    expect(decode(await (await b.get("/account")).text())).toMatch(/http:\/\/localhost\/@ada\?f=[a-z0-9]{16}/);
  });
});

describe("colour map", () => {
  const map = async (email = "ada@example.com") =>
    (await accountsEnv.DB.prepare("SELECT palette FROM users WHERE email = ?").bind(email).first<{ palette: string }>())!.palette;
  const form = { name: "Ada", bio: "", zone: "Europe/London", visibility: "private" };

  it("defaults to parula, offered with the other maps in Theme", async () => {
    const a = makeAccounts();
    const b = await signedUp(a);
    expect(await map()).toBe("parula");
    const html = decode(await (await b.get("/account")).text());
    expect(html).toContain('<form class="palette-choice" method="post" action="/account/palette">');
    for (const name of PALETTE_NAMES) {
      expect(html).toContain(`name="palette" value="${name}"`);
      expect(html).toContain(`class="palette-swatch" data-palette="${name}"`);
    }
    expect(html).toMatch(/name="palette" value="parula" aria-pressed="true"/);
  });

  it("one tap saves a map; the profile form keeps it", async () => {
    const a = makeAccounts();
    const b = await signedUp(a);
    const res = await b.post("/account/palette", { palette: "viridis" });
    expect(res.headers.get("location")).toBe("/account?done=palette");
    expect(await map()).toBe("viridis");
    const html = decode(await (await b.get("/account?done=palette")).text());
    expect(html).toContain("Colour map saved.");
    expect(html).toMatch(/name="palette" value="viridis" aria-pressed="true"/);
    expect(html).toMatch(/<span data-theme-mode="true">Dark<\/span><span>viridis<\/span>/);
    await b.post("/account/profile", form);
    expect(await map()).toBe("viridis");
    expect((await b.post("/account/palette", { palette: "jet" })).status).toBe(400);
    expect(await map()).toBe("viridis");
  });

  it("the older profile form's palette still saves", async () => {
    const a = makeAccounts();
    const b = await signedUp(a);
    expect((await b.post("/account/profile", { ...form, palette: "plasma" })).headers.get("location")).toBe("/account?done=profile");
    expect(await map()).toBe("plasma");
  });

  it.each([["jet"], [""], ["Viridis"], ["parula'); --"]])("refuses %j and keeps the current map", async (value) => {
    const a = makeAccounts();
    const b = await signedUp(a);
    await b.post("/account/profile", { ...form, palette: "magma" });
    const res = await b.post("/account/profile", { ...form, name: "Changed", palette: value });
    expect(res.status).toBe(400);
    expect(decode(await res.text())).toContain("Choose one of the colour maps shown.");
    expect(await map()).toBe("magma");
  });

  it("the database refuses names outside the list", async () => {
    const a = makeAccounts();
    await signedUp(a);
    await expect(accountsEnv.DB.prepare("UPDATE users SET palette = 'jet'").run()).rejects.toThrow(/CHECK/);
  });

  it("a profile is drawn in its owner's map for every visitor; parula sets nothing", async () => {
    const a = makeAccounts();
    const b = await signedUp(a);
    const path = (await profilePath()) + WEEK;
    expect(await (await a.browser().get(path)).text()).toMatch(/<html lang="en-GB">/);
    await b.post("/account/profile", { ...form, palette: "cividis" });
    for (const viewer of [a.browser(), b]) {
      const html = await (await viewer.get(path)).text();
      expect(html).toContain('<html lang="en-GB" data-palette="cividis">');
      // The colour bar is inside, so it follows the same map.
      expect(html).toContain('class="colourbar"');
    }
  });
});
