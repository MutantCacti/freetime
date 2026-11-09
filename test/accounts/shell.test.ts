import { beforeEach, expect, it } from "vitest";
import { APP_VERSION, SITE_HOST } from "../../src/config";
import { makeAccounts, resetDb, signedUp } from "./helpers";

beforeEach(resetDb);

// The same list the main site's test checks (test/workers.test.ts): one shell, one stylesheet set.
const SHARED_ASSETS = ["/css/fonts.css", "/css/tokens.css", "/css/app.css", "/css/calendar.css", "/js/head.js", "/js/app.js"].map((p) => `${p}?v=${APP_VERSION}`);
const assetsOf = (html: string) => [...html.matchAll(/<(?:link rel="stylesheet"|script) (?:href|src)="([^"]+)"/g)].map((m) => m[1]);

it.each(["/account", "/account/sign-in", "/account/sign-up", "/account/reset", "/nope"])("%s loads exactly the main site's stylesheets and scripts", async (path) => {
  const a = makeAccounts();
  expect(assetsOf(await (await a.browser().get(path)).text())).toEqual(SHARED_ASSETS);
});

it("the signed-in account page does too, with the site's sub-page header and the settings' rows", async () => {
  const a = makeAccounts();
  const b = await signedUp(a);
  const html = await (await b.get("/account")).text();
  // Plus the owner's accent sheet (every verified profile has one), right after the shared stylesheets.
  const accent = assetsOf(html).find((h) => h!.endsWith("/accent.css") || h!.includes("/accent.css?"));
  expect(accent).toMatch(/^\/u\/[a-z0-9]{10}\/accent\.css\?v=3-parula-none$/);
  expect(assetsOf(html).filter((h) => h !== accent)).toEqual(SHARED_ASSETS);
  expect(html).toContain('class="subheader"');
  // The theme is in its row here, not in the header.
  expect(html).toContain('class="theme-switch"');
  expect(html).not.toContain("theme-toggle");
  expect(html).toContain(`<title>Account · ${SITE_HOST}</title>`);
});
