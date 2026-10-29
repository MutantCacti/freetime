import { describe, expect, it } from "vitest";
import dates from "./fixtures/w2m/dates.html?raw";
import home from "./fixtures/w2m/home.html?raw";
import june from "./fixtures/w2m/june.html?raw";
import missing from "./fixtures/w2m/missing.html?raw";
import nyGrid from "./fixtures/w2m/ny-grid.html?raw";
import ny from "./fixtures/w2m/ny.html?raw";
import weekdays from "./fixtures/w2m/weekdays.html?raw";

// Captured when2meet pages (docs/W2M-GET-SPEC.md §8). They must hold the event's structure only:
// no participants, no availability, no third-party scripts, and no real event link.
const EVENTS: Record<string, [html: string, slots: number]> = {
  weekdays: [weekdays, 160],
  dates: [dates, 160],
  june: [june, 160],
  ny: [ny, 60],
};
const GRIDS = { ...Object.fromEntries(Object.entries(EVENTS).map(([k, [html]]) => [k, html])), "ny-grid": nyGrid };
const PAGES = { ...GRIDS, home, missing };

// Names Maxence signs in with on the test events. None used yet; add them here when they are.
const DENY_NAMES: string[] = [];

describe("when2meet fixtures", () => {
  for (const [name, [html, slots]] of Object.entries(EVENTS)) {
    it(`${name} has the event's ${slots} slots, each with no one available`, () => {
      expect(html.match(/TimeOfSlot\[\d+\]=\d+;/g)).toHaveLength(slots);
      const avail = html.match(/AvailableAtSlot\[\d+\]=new Array\([^)]*\);/g) ?? [];
      expect(avail).toHaveLength(slots);
      for (const a of avail) expect(a).toMatch(/new Array\(\);$/);
    });
  }

  for (const [name, html] of Object.entries(GRIDS)) {
    it(`${name} lists no participants`, () => {
      expect(html).not.toMatch(/People(Names|IDs)\[\d+\]\s*=/);
      expect(html).not.toMatch(/People(Names|IDs)\s*=\s*new Array\([^)]/);
      expect(html).not.toMatch(/AvailableIDs\s*=\s*new Array\([^)]/);
      // Raw pages leave these unclosed, so check that nothing but a tag follows them.
      for (const id of ["Available", "Unavailable"]) expect(html).toMatch(new RegExp(`<div id=["']?${id}["']?><`));
      expect(html).toMatch(/<span id=["']?UserName["']?><\/span>/);
      for (const n of DENY_NAMES) expect(html).not.toContain(n);
    });
  }

  for (const [name, html] of Object.entries(PAGES)) {
    it(`${name} uses a placeholder event link, not a real one`, () => {
      for (const m of html.matchAll(/\?(\d+)-([A-Za-z0-9]+)/g)) expect(m[1]).toMatch(/^1000000[1-4]$|^99999999$/);
      for (const m of html.matchAll(/append\('(?:id|event)', '?(\d+)/g)) expect(m[1]).toMatch(/^1000000[1-4]$/);
    });

    it(`${name} keeps no third-party scripts or ads`, () => {
      expect(html).not.toMatch(/<script[^>]*\ssrc=/);
      expect(html).not.toMatch(/gtag|adsbygoogle|googlesyndication|<iframe|<ins\b|_files\//);
    });
  }
});
