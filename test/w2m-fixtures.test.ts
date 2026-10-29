import { describe, expect, it } from "vitest";
import dates from "./fixtures/w2m/dates.html?raw";
import home from "./fixtures/w2m/home.html?raw";
import missing from "./fixtures/w2m/missing.html?raw";
import weekdays from "./fixtures/w2m/weekdays.html?raw";

// Saved when2meet pages (docs/W2M-GET-SPEC.md §8). They must hold the event's structure only:
// no participants, no availability, no third-party scripts, and no real event link.
const EVENTS = { dates, weekdays };
const PAGES = { ...EVENTS, home, missing };

// Names Maxence signs in with on the test events. None used yet; add them here when they are.
const DENY_NAMES: string[] = [];

describe("when2meet fixtures", () => {
  for (const [name, html] of Object.entries(EVENTS)) {
    describe(name, () => {
      it("has the event's 160 slots, each with no one available", () => {
        expect(html.match(/TimeOfSlot\[\d+\]=\d+;/g)).toHaveLength(160);
        const avail = html.match(/AvailableAtSlot\[\d+\]=new Array\([^)]*\);/g) ?? [];
        expect(avail).toHaveLength(160);
        for (const a of avail) expect(a).toMatch(/new Array\(\);$/);
      });

      it("lists no participants", () => {
        expect(html).not.toMatch(/People(Names|IDs)\[\d+\]\s*=/);
        expect(html).not.toMatch(/People(Names|IDs)\s*=\s*new Array\([^)]/);
        expect(html).not.toMatch(/AvailableIDs\s*=\s*new Array\([^)]/);
        expect(html).toContain('<div id="Available"></div>');
        expect(html).toContain('<div id="Unavailable"></div>');
        expect(html).toContain('<span id="UserName"></span>');
        for (const n of DENY_NAMES) expect(html).not.toContain(n);
      });
    });
  }

  for (const [name, html] of Object.entries(PAGES)) {
    describe(name, () => {
      it("uses a placeholder event link, not a real one", () => {
        for (const m of html.matchAll(/\?(\d+)-([A-Za-z0-9]+)/g)) expect(m[1]).toMatch(/^1000000[12]$/);
        for (const m of html.matchAll(/append\('(?:id|event)', '?(\d+)/g)) expect(m[1]).toMatch(/^1000000[12]$/);
      });

      it("keeps no third-party scripts, ads or saved-page files", () => {
        expect(html).not.toMatch(/<script[^>]*\ssrc=/);
        expect(html).not.toMatch(/gtag|adsbygoogle|googlesyndication|<iframe|<ins\b|_files\//);
      });
    });
  }
});
