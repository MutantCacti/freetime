import { beforeEach, describe, expect, it } from "vitest";
import { accountsEnv, decode, makeAccounts, resetDb, signedUp } from "./helpers";

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

async function profilePath(email = "ada@example.com"): Promise<string> {
  const row = await accountsEnv.DB.prepare("SELECT public_id FROM users WHERE email = ?").bind(email).first<{ public_id: string }>();
  return `/u/${row!.public_id}`;
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

  it("the owner always sees the public card, with Edit profile and the share link", async () => {
    const a = makeAccounts();
    const b = await signedUp(a);
    const html = decode(await (await b.get((await profilePath()) + WEEK)).text());
    expect(html).toContain("Member since");
    expect(html).toContain('href="/account"');
    expect(html).toMatch(/data-copy="http:\/\/localhost\/u\/[a-z0-9]{10}\?f=[a-z0-9]{16}"/);
    const other = decode(await (await a.browser().get((await profilePath()) + WEEK)).text());
    expect(other).not.toContain("data-copy=");
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

  it("has the site's top bar without Maxence's pages", async () => {
    const a = makeAccounts();
    await signedUp(a);
    const html = await (await a.browser().get((await profilePath()) + WEEK)).text();
    for (const tb of ["tabs", "today", "prev", "next", "period", "tz", "account", "theme"]) expect(html).toContain(`data-tb="${tb}"`);
    for (const tb of ["download", "contact", "help"]) expect(html).not.toContain(`data-tb="${tb}"`);
    expect(html).not.toContain('id="dlg-download"');
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
    await a.browser().post("/account/sign-up", { name: "Eve", email: "eve@example.com", password: "correct horse battery", zone: "Europe/London" });
    expect((await a.browser().get(await profilePath("eve@example.com"))).status).toBe(404);
  });
});
