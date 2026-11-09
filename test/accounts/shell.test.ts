import { beforeEach, expect, it } from "vitest";
import { SITE_HOST } from "../../src/config";
import { makeAccounts, resetDb, signedUp } from "./helpers";

beforeEach(resetDb);

// The same list the main site's test checks (test/workers.test.ts): one shell, one stylesheet set.
const SHARED_ASSETS = ["/css/fonts.css", "/css/tokens.css", "/css/app.css", "/css/calendar.css", "/js/head.js", "/js/app.js"];
const assetsOf = (html: string) => [...html.matchAll(/<(?:link rel="stylesheet"|script) (?:href|src)="([^"]+)"/g)].map((m) => m[1]);

it.each(["/account", "/account/sign-in", "/account/sign-up", "/account/reset", "/nope"])("%s loads exactly the main site's stylesheets and scripts", async (path) => {
  const a = makeAccounts();
  expect(assetsOf(await (await a.browser().get(path)).text())).toEqual(SHARED_ASSETS);
});

it("the signed-in account page does too, with the site's sub-page header and the settings' rows", async () => {
  const a = makeAccounts();
  const b = await signedUp(a);
  const html = await (await b.get("/account")).text();
  expect(assetsOf(html)).toEqual(SHARED_ASSETS);
  expect(html).toContain('class="subheader"');
  // The theme is in its row here, not in the header.
  expect(html).toContain('class="theme-switch"');
  expect(html).not.toContain("theme-toggle");
  expect(html).toContain(`<title>Account · ${SITE_HOST}</title>`);
});
