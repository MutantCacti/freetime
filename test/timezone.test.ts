import { describe, expect, it } from "vitest";
import "../public/js/head.js";
import { resolveZone } from "../src/state";
import { attr, cellClass, decode, hrefs, makeApp, params, tagWith, topbarHref } from "./helpers";

const app = makeApp();

declare global {
  // eslint-disable-next-line no-var
  var SiteHead: {
    headRedirect(href: string, zone: string | null, o?: { narrow?: boolean; lastTarget?: string | null; state?: { replaced?: boolean } }): string | null;
    readTheme(storage: unknown): "light" | "dark" | null;
    writeTheme(storage: unknown, v: string): boolean;
  };
}

describe("the zone rule", () => {
  it("tz beats dtz, which beats Europe/London", () => {
    expect(resolveZone("Asia/Tokyo", "Europe/Paris").zone).toBe("Asia/Tokyo");
    expect(resolveZone(undefined, "Europe/Paris").zone).toBe("Europe/Paris");
    expect(resolveZone(undefined, undefined).zone).toBe("Europe/London");
    expect(resolveZone("Europe/Paris", "Europe/Paris").zone).toBe(resolveZone(undefined, "Europe/Paris").zone);
  });

  it("shows only the zone name; the accessible name and summary add the offset, never a mode", async () => {
    const html = decode(await app.html("/?view=week&date=2026-11-02&dtz=Europe/Paris"));
    const button = tagWith(html, 'id="tz-button"');
    expect(html).toMatch(/<span class="tz-text">Europe\/Paris<\/span><svg[^>]*class="icon icon-chevron"/);
    expect(attr(button, "aria-label")).toBe("Time zone: Europe/Paris, UTC plus 1. Change");
    expect(attr(button, "data-summary")).toBe("Europe/Paris · UTC+1");
    const pinned = decode(await app.html("/?view=week&date=2026-11-02&dtz=Europe/Paris&tz=Asia/Kolkata"));
    expect(pinned).toContain('<span class="tz-text">Asia/Kolkata</span>');
    expect(attr(tagWith(pinned, 'id="tz-button"'), "data-summary")).toBe("Asia/Kolkata · UTC+5:30");
    const none = decode(await app.html("/?view=week&date=2026-11-02"));
    expect(attr(tagWith(none, 'id="tz-button"'), "data-summary")).toBe("Europe/London · UTC+0");
    for (const page of [html, pinned, none]) expect(page).not.toMatch(/\b(pinned|site default|device default)\b/);
  });

  it("shows the offset in effect right now, whatever period is on screen", async () => {
    // Now is 3 Nov 2026: London is on GMT, New York on EST.
    for (const date of ["2026-10-19", "2026-07-06", "2027-03-22", "2026-11-02"]) {
      const html = decode(await app.html(`/?view=week&date=${date}`));
      expect(attr(tagWith(html, 'id="tz-button"'), "data-summary"), date).toBe("Europe/London · UTC+0");
      expect(attr(tagWith(html, 'id="tz-button"'), "aria-label"), date).toBe("Time zone: Europe/London, UTC plus 0. Change");
      expect(html).not.toContain("→ UTC");
    }
    const summer = makeApp({ now: Date.UTC(2026, 6, 1, 12) });
    expect(attr(tagWith(decode(await summer.html("/?view=week&date=2026-11-02")), 'id="tz-button"'), "data-summary")).toBe("Europe/London · UTC+1");
    const ny = decode(await app.html("/?view=month&date=2026-10-01&dtz=America/New_York"));
    expect(attr(tagWith(ny, 'id="tz-button"'), "data-summary")).toBe("America/New_York · UTC-5");
  });
});

describe("links keep the zone", () => {
  const pages = (q: string) => [
    `/?view=day&date=2026-11-03&${q}`,
    `/?view=week&date=2026-11-02&${q}`,
    `/?view=month&date=2026-11-01&${q}`,
    `/?view=range&from=2026-11-02&to=2026-11-06&${q}`,
    `/?view=range&from=2026-11-02&to=2026-12-06&${q}`,
    `/help?view=week&date=2026-11-02&${q}`,
    `/contact?${q}`,
    `/export?from=2026-11-02&to=2026-11-08&${q}`,
    `/tz?view=week&date=2026-11-02&${q}`,
    `/nope?${q}`,
  ];
  const internal = (html: string) => hrefs(html).filter((h) => h.startsWith("/"));

  it("every rendered link keeps dtz and tz", async () => {
    for (const path of pages("dtz=Pacific/Auckland&tz=America/Los_Angeles")) {
      const links = internal(await app.html(path));
      expect(links.length, path).toBeGreaterThan(0);
      for (const href of links) {
        const p = params(href);
        expect(p.get("dtz"), `${path} → ${href}`).toBe("Pacific/Auckland");
        expect(p.get("tz"), `${path} → ${href}`).toBe("America/Los_Angeles");
      }
    }
  });

  it("never adds tz on its own", async () => {
    for (const path of pages("dtz=Pacific/Auckland")) {
      for (const href of internal(await app.html(path))) {
        expect(params(href).get("dtz"), `${path} → ${href}`).toBe("Pacific/Auckland");
        expect(params(href).has("tz"), `${path} → ${href}`).toBe(false);
      }
    }
  });

  it("an invalid tz falls back to dtz, with a notice, and is dropped from links", async () => {
    const html = decode(await app.html("/?view=week&date=2026-11-02&dtz=Europe/Paris&tz=Mars/Olympus_Mons"));
    expect(html).toContain('<span class="tz-text">Europe/Paris</span>');
    expect(html).toContain("Time zone unknown, using device default.");
    expect(tagWith(html, 'data-id="tz-unknown"')).toContain('data-kind="transient"');
    for (const href of internal(html)) expect(params(href).has("tz")).toBe(false);
  });

  it("an invalid dtz falls back to Europe/London", async () => {
    const html = decode(await app.html("/?view=week&date=2026-11-02&dtz=Not/AZone"));
    expect(html).toContain('<span class="tz-text">Europe/London</span>');
    expect(attr(tagWith(html, 'id="tz-button"'), "data-summary")).toBe("Europe/London · UTC+0");
    for (const href of internal(html)) expect(params(href).has("dtz")).toBe(false);
  });
});

describe("other zones follow the zone", () => {
  // Now is Tue 3 Nov 14:20 UTC: Wed 4 Nov 03:20 in Auckland (UTC+13), Tue 3 Nov 06:20 in Los Angeles (UTC-8).
  it("Pacific/Auckland: today, day boundaries, the line, Today and arrows", async () => {
    const html = decode(await app.html("/?view=day&dtz=Pacific/Auckland"));
    expect(html).toContain('<span class="sr-only">Wed 4 Nov 2026</span>');
    expect(html).toMatch(/aria-label="Wed 4 Nov, 03:00–03:30, [^"]*"[^>]*><div class="now-line m20"/);
    // The London all-day event (4 Nov 00:00–24:00 UTC) is 13:00–13:00 in Auckland.
    expect(cellClass(html, "Wed 4 Nov, 12:30–13:00, 0% busy")).not.toBeNull();
    expect(cellClass(html, "Wed 4 Nov, 13:00–13:30, 100% busy")).not.toBeNull();
    expect(Object.fromEntries(params(topbarHref(html, "prev")!))).toMatchObject({ date: "2026-11-03" });
    expect(Object.fromEntries(params(topbarHref(html, "next")!))).toMatchObject({ date: "2026-11-05" });
    const later = decode(await app.html("/?view=day&date=2026-11-20&dtz=Pacific/Auckland"));
    expect(Object.fromEntries(params(topbarHref(later, "today")!))).toMatchObject({ view: "day", date: "2026-11-04" });
  });

  it("America/Los_Angeles: today, day boundaries, the line, Today and arrows", async () => {
    const html = decode(await app.html("/?view=day&dtz=America/Los_Angeles"));
    expect(html).toContain('<span class="sr-only">Tue 3 Nov 2026</span>');
    expect(html).toMatch(/aria-label="Tue 3 Nov, 06:00–06:30, 50% busy"[^>]*><div class="now-line m20"/);
    const later = decode(await app.html("/?view=week&date=2026-11-20&dtz=America/Los_Angeles"));
    expect(Object.fromEntries(params(topbarHref(later, "today")!))).toMatchObject({ view: "week", date: "2026-11-02" });
    expect(Object.fromEntries(params(topbarHref(later, "prev")!))).toMatchObject({ date: "2026-11-09" });
  });

  it("the same instant is a different 'today' in each zone", async () => {
    const nz = decode(await app.html("/?view=week&date=2026-11-02&dtz=Pacific/Auckland"));
    const la = decode(await app.html("/?view=week&date=2026-11-02&dtz=America/Los_Angeles"));
    expect(nz).toContain('class="colhead is-today" data-date="2026-11-04"');
    expect(la).toContain('class="colhead is-today" data-date="2026-11-03"');
  });
});

describe("the head script", () => {
  const head = globalThis.SiteHead;

  it("adds a missing dtz and keeps everything else", () => {
    const out = head.headRedirect("https://example.test/?view=week&date=2026-11-02&tz=Asia/Tokyo#h08", "Europe/Paris", { state: {} });
    const url = new URL(out!);
    expect(url.searchParams.get("dtz")).toBe("Europe/Paris");
    expect(url.searchParams.get("tz")).toBe("Asia/Tokyo");
    expect(url.searchParams.get("view")).toBe("week");
    expect(url.hash).toBe("#h08");
  });

  it("replaces a wrong dtz (a link from someone else's device)", () => {
    const out = head.headRedirect("https://example.test/?dtz=Pacific/Auckland&tz=Asia/Tokyo", "Europe/Paris", { state: {} });
    expect(new URL(out!).searchParams.get("dtz")).toBe("Europe/Paris");
    expect(new URL(out!).searchParams.get("tz")).toBe("Asia/Tokyo");
  });

  it("does nothing when dtz is already right", () => {
    expect(head.headRedirect("https://example.test/?dtz=Europe/Paris", "Europe/Paris", { state: {} })).toBeNull();
  });

  it("never replaces twice in one page view, or again on the page it just replaced to", () => {
    const state = {};
    const target = head.headRedirect("https://x.test/", "Europe/Paris", { state });
    expect(target).not.toBeNull();
    expect(head.headRedirect("https://x.test/?dtz=Wrong/Zone", "Europe/Paris", { state })).toBeNull();
    // Landed on the target but it still looks wrong (say, a rewritten zone name): stop.
    expect(head.headRedirect(target!, "Asia/Calcutta", { state: {}, lastTarget: target })).toBeNull();
    // Any other page is still corrected, however soon.
    expect(head.headRedirect("https://x.test/?view=day", "Europe/Paris", { state: {}, lastTarget: target })).not.toBeNull();
  });

  it("asks for the Day view on narrow screens only when no view is given", () => {
    const narrow = head.headRedirect("https://x.test/?dtz=Europe/Paris", "Europe/Paris", { narrow: true, state: {} });
    expect(new URL(narrow!).searchParams.get("view")).toBe("day");
    expect(head.headRedirect("https://x.test/?view=week&dtz=Europe/Paris", "Europe/Paris", { narrow: true, state: {} })).toBeNull();
    expect(head.headRedirect("https://x.test/help?dtz=Europe/Paris", "Europe/Paris", { narrow: true, state: {} })).toBeNull();
  });
});

describe("/tz without JS", () => {
  it("lists Device default first when the device zone is known, then zones grouped by region", async () => {
    const html = decode(await app.html("/tz?view=week&date=2026-11-02&dtz=Europe/Paris"));
    const select = html.slice(html.indexOf("<select"), html.indexOf("</select>"));
    expect(select).toMatch(/^<select name="tz" id="tz-select" aria-label="Time zone"><option value="" selected="">Device default \(Europe\/Paris\)<\/option><optgroup label="Africa">/);
    expect(select).toContain('<option value="Asia/Tokyo">Asia/Tokyo · UTC+9</option>');
    expect(html).toContain("Current time zone: Europe/Paris · UTC+1");
  });

  it("without JS (no device zone), doesn't offer Device default and selects the zone in use", async () => {
    const html = decode(await app.html("/tz?view=week&date=2026-11-02"));
    expect(html).not.toContain("Device default");
    expect(html).toContain('<option value="Europe/London" selected="">');
    const pinned = decode(await app.html("/tz?view=week&date=2026-11-02&tz=Asia/Tokyo"));
    expect(pinned).not.toContain("Device default");
    expect(pinned).toContain('<option value="Asia/Tokyo" selected="">');
    expect(pinned).not.toContain('<option value="Europe/London" selected="">');
  });

  it("sets tz and returns to the same view", async () => {
    const res = await app.get("/tz?apply=1&view=week&date=2026-11-02&dtz=Europe/Paris&tz=Asia/Tokyo");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/?view=week&date=2026-11-02&tz=Asia/Tokyo&dtz=Europe/Paris#h08");
  });

  it("removes tz for Device default", async () => {
    const res = await app.get("/tz?apply=1&view=range&from=2026-11-02&to=2026-11-04&dtz=Europe/Paris&tz=");
    expect(res.headers.get("location")).toBe("/?view=range&from=2026-11-02&to=2026-11-04&dtz=Europe/Paris#h08");
  });

  it("the form keeps the view and dtz", async () => {
    const html = await app.html("/tz?view=day&date=2026-11-03&dtz=Europe/Paris&tz=Asia/Tokyo");
    expect(attr(tagWith(html, 'class="tz-form"'), "method")).toBe("get");
    for (const input of ['name="view" value="day"', 'name="date" value="2026-11-03"', 'name="dtz" value="Europe/Paris"', 'name="apply" value="1"']) {
      expect(html).toContain(input);
    }
    expect(html).toContain('<option value="Asia/Tokyo" selected="">');
  });

  it("the top bar's zone button links to /tz with the current view", async () => {
    const html = await app.html("/?view=month&date=2026-11-01&dtz=Europe/Paris");
    expect(decode(attr(tagWith(html, 'id="tz-button"'), "href")!)).toBe("/tz?view=month&date=2026-11-01&dtz=Europe/Paris");
  });
});

describe("no cookies", () => {
  it("never sends Set-Cookie", async () => {
    for (const path of ["/", "/?tz=Bad/Zone", "/help", "/contact", "/export", "/tz", "/tz?apply=1&tz=UTC", "/free-busy.ics", "/css/app.css", "/nope"]) {
      expect((await app.get(path)).headers.has("set-cookie"), path).toBe(false);
    }
    expect((await app.get("/", { method: "POST" })).headers.has("set-cookie")).toBe(false);
  });
});
