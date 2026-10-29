import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors";
import { type W2mEvent, eventUrl, fetchEvent, gridFor, parseEventPage, parseW2mLink, parseW2mParam } from "../src/w2m";
import dates from "./fixtures/w2m/dates.html?raw";
import home from "./fixtures/w2m/home.html?raw";
import june from "./fixtures/w2m/june.html?raw";
import missing from "./fixtures/w2m/missing.html?raw";
import nyGrid from "./fixtures/w2m/ny-grid.html?raw";
import ny from "./fixtures/w2m/ny.html?raw";
import weekdays from "./fixtures/w2m/weekdays.html?raw";
import { fakeEventPage } from "./w2m-helpers";

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof AppError ? e.code : `not an AppError: ${String(e)}`;
  }
  return "no error";
}

describe("when2meet links (GET spec §1)", () => {
  it.each([
    ["https://www.when2meet.com/?10000002-Test2", "10000002", "Test2"],
    ["https://when2meet.com/?10000002-Test2", "10000002", "Test2"],
    ["  https://www.when2meet.com/?10000002-Test2  ", "10000002", "Test2"],
    ["https://www.when2meet.com/?10000002-Test2\n", "10000002", "Test2"],
    ["\thttps://www.when2meet.com/?1-AbC12\r\n", "1", "AbC12"],
  ])("accepts %j", (input, id, code) => {
    expect(parseW2mLink(input)).toEqual({ id, code });
  });

  it.each([
    "http://www.when2meet.com/?10000002-Test2",
    "https://www.when2meet.com.evil.example/?10000002-Test2",
    "https://evilwhen2meet.com/?10000002-Test2",
    "https://www.when2meet.co/?10000002-Test2",
    "https://user:pass@www.when2meet.com/?10000002-Test2",
    "https://www.when2meet.com:8443/?10000002-Test2",
    "https://www.when2meet.com/index.php?10000002-Test2",
    "https://www.when2meet.com?10000002-Test2",
    "https://www.when2meet.com/?10000002-Test2&x=1",
    "https://www.when2meet.com/?10000002-Test2#frag",
    "https://www.when2meet.com/?10000002-Test",
    "https://www.when2meet.com/?10000002-Test21",
    "https://www.when2meet.com/?0123-Test2",
    "https://www.when2meet.com/?10000002_Test2",
    "https://www.when2meet.com/redirect?to=https://example.com/?1-AAAAA",
    "https://www.when2meet.com/?10000002-Test2 https://example.com",
    "https://www.when2meet.com/?" + "1".repeat(300) + "-Test2",
    " ".repeat(190) + "https://www.when2meet.com/?10000002-Test2",
    "",
  ])("refuses %j", (input) => {
    expect(parseW2mLink(input)).toBeNull();
  });

  it("rebuilds the address from the id and code, never the input", () => {
    const ref = parseW2mLink(" https://when2meet.com/?10000002-Test2 ")!;
    expect(eventUrl(ref)).toBe("https://www.when2meet.com/?10000002-Test2");
  });

  it("reads the w2m parameter strictly", () => {
    expect(parseW2mParam("10000002-Test2")).toEqual({ id: "10000002", code: "Test2" });
    for (const bad of ["", "10000002", "10000002-Test", " 10000002-Test2", "10000002-Test2/x"]) expect(parseW2mParam(bad)).toBeNull();
  });
});

describe("parse contract (GET spec §3.10)", () => {
  it("days of the week", async () => {
    const e = await parseEventPage("10000001", weekdays);
    expect(e).toMatchObject({ kind: "weekdays", zone: null, slotSeconds: 900, fill: "ok" });
    expect(e.slots).toHaveLength(160);
    expect(e.slots[0]).toBe(279795600);
    expect(e.slots[159]).toBe(280169100);
  });

  it("specific dates", async () => {
    const e = await parseEventPage("10000002", dates);
    expect(e).toMatchObject({ kind: "dates", zone: "Europe/London", slotSeconds: 900, fill: "ok" });
    expect([e.slots[0], e.slots[159], e.slots.length]).toEqual([1793610000, 1793983500, 160]);
    expect(gridFor(e.slots, "Europe/London").dates).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]);
  });

  it("specific dates in summer time: the slots are real instants", async () => {
    const e = await parseEventPage("10000003", june);
    expect(e.zone).toBe("Europe/London");
    expect(e.slots[0]).toBe(Date.UTC(2027, 5, 1, 8, 0) / 1000); // 09:00 BST
    expect(gridFor(e.slots, "Europe/London").times[0]).toBe(9 * 3600);
  });

  it("an event made in New York", async () => {
    const e = await parseEventPage("10000004", ny);
    expect(e).toMatchObject({ kind: "dates", zone: "America/New_York", slotSeconds: 900 });
    expect(e.slots).toHaveLength(60);
    const g = gridFor(e.slots, "America/New_York");
    expect(g.dates).toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
    expect(g.times[0]).toBe(18 * 3600);
  });

  it("the missing-event page is W2M_NOT_FOUND", async () => {
    expect(await code(parseEventPage("99999999", missing))).toBe("W2M_NOT_FOUND");
  });

  it("the home page is W2M_PARSE", async () => {
    expect(await code(parseEventPage("1", home))).toBe("W2M_PARSE");
  });

  it("reports drift in the fill contract without failing the parse", async () => {
    const e = await parseEventPage("10000002", dates.replace("function SelectStop(", "function SelectEnd("));
    expect(e.fill).toBe("drift");
    expect((await parseEventPage("10000002", dates.replace('"SaveTimes.php"', '"Save.php"'))).fill).toBe("drift");
  });
});

describe("a changed page is W2M_PARSE, never a wrong grid", () => {
  const mutations: [string, (html: string) => string][] = [
    ["a slot moved", (h) => h.replace("TimeOfSlot[1]=1793610900;", "TimeOfSlot[1]=1793611000;")],
    ["a slot index skipped", (h) => h.replace("TimeOfSlot[1]=", "TimeOfSlot[2]=")],
    ["a cell's column changed", (h) => h.replace(`id='YouTime1793610900' data-col="0"`, `id='YouTime1793610900' data-col="1"`)],
    ["a cell's row changed", (h) => h.replace(`id='YouTime1793610900' data-col="0" data-row="1"`, `id='YouTime1793610900' data-col="0" data-row="2"`)],
    ["a cell removed", (h) => h.replace(/<div id='YouTime1793610900'[^>]*><\/div>/, "")],
    ["cells renamed", (h) => h.replaceAll("id='YouTime", "id='MyTime")],
    ["the zone removed", (h) => h.replace('select.value != "Europe/London"', 'select.value != ""')],
    ["an unknown zone", (h) => h.replace('select.value != "Europe/London"', 'select.value != "Mars/Olympus"')],
    ["the zone handler rewritten", (h) => h.replace('loadTimezoneOptions("ParticipantTimeZone")', 'setupZones("ParticipantTimeZone")')],
    ["both kind signals", (h) => h.replace('loadTimezoneOptions("ParticipantTimeZone");', 'loadTimezoneOptions("ParticipantTimeZone"); el.value = "UTC";')],
  ];
  it.each(mutations)("%s", async (_name, mutate) => {
    const mutated = mutate(dates);
    expect(mutated).not.toBe(dates);
    expect(await code(parseEventPage("10000002", mutated))).toBe("W2M_PARSE");
  });

  it("a days-of-the-week event stored outside 1978", async () => {
    const mutated = weekdays.replace(/TimeOfSlot\[(\d+)\]=(\d+);/g, (_m, i, t) => `TimeOfSlot[${i}]=${Number(t) + 1_500_000_000};`);
    expect(await code(parseEventPage("10000001", mutated))).toBe("W2M_PARSE");
  });
});

describe("slot length is parsed, never assumed (GET spec §3.6)", () => {
  const nov2 = Date.UTC(2026, 10, 2, 9) / 1000;
  const day = (start: number, n: number, step: number) => Array.from({ length: n }, (_, i) => start + i * step);

  it("30-minute slots", async () => {
    const slots = [...day(nov2, 8, 1800), ...day(nov2 + 86400, 8, 1800)];
    const e = await parseEventPage("5", fakeEventPage({ zone: "Europe/London", slots }));
    expect(e.slotSeconds).toBe(1800);
  });

  it("uneven slots", async () => {
    const slots = [nov2, nov2 + 900, nov2 + 2700, nov2 + 3600];
    expect(await code(parseEventPage("5", fakeEventPage({ zone: "Europe/London", slots })))).toBe("W2M_PARSE");
  });

  it("days with different steps", async () => {
    const slots = [...day(nov2, 4, 900), ...day(nov2 + 86400, 4, 1800)];
    expect(await code(parseEventPage("5", fakeEventPage({ zone: "Europe/London", slots })))).toBe("W2M_PARSE");
  });

  it("one slot per day can't be measured", async () => {
    expect(await code(parseEventPage("5", fakeEventPage({ zone: "Europe/London", slots: [nov2, nov2 + 86400] })))).toBe("W2M_PARSE");
  });

  it("stays the same across a DST change", async () => {
    // London leaves summer time on Sun 25 Oct 2026: 09:00 is 08:00Z before, 09:00Z after.
    const slots = [...day(Date.UTC(2026, 9, 24, 8) / 1000, 4, 900), ...day(Date.UTC(2026, 9, 26, 9) / 1000, 4, 900)];
    const e = await parseEventPage("5", fakeEventPage({ zone: "Europe/London", slots }));
    expect(e.slotSeconds).toBe(900);
    expect(gridFor(e.slots, "Europe/London").times).toEqual([32400, 33300, 34200, 35100]);
  });

  it("days can skip: only the event's own dates are columns", async () => {
    const slots = [...day(nov2, 4, 900), ...day(nov2 + 3 * 86400, 4, 900)];
    const e = await parseEventPage("5", fakeEventPage({ zone: "Europe/London", slots }));
    expect(gridFor(e.slots, "Europe/London").dates).toEqual(["2026-11-02", "2026-11-05"]);
  });
});

describe("the grid rule (GET spec §2.2)", () => {
  /** Cells and placeholders of the "you" grid in a page: [col, row, time or null]. */
  function youGrid(html: string): [number, number, number | null][] {
    const start = html.indexOf("YouGridSlots");
    const block = html.slice(start, html.indexOf("GroupGridSlots", start));
    return [...block.matchAll(/<div (?:id='YouTime\d+' )?data-col="(\d+)" data-row="(\d+)"(?: data-time="(\d+)")?/g)].map((m) => [
      Number(m[1]),
      Number(m[2]),
      m[3] ? Number(m[3]) : null,
    ]);
  }

  it("reproduces ny-grid.html from ny.html in Europe/London exactly", async () => {
    const event = await parseEventPage("10000004", ny);
    const g = gridFor(event.slots, "Europe/London");
    expect(g.dates).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]);
    expect(g.times).toHaveLength(20);
    expect(g.times.slice(15, 17)).toEqual([3 * 3600 + 45 * 60, 23 * 3600]); // the break after 03:45

    const expected = new Map<string, number | null>();
    for (let c = 0; c < 4; c++) for (let r = 0; r < 20; r++) expected.set(`${c},${r}`, null);
    event.slots.forEach((t, i) => expected.set(g.positions[i]!.join(","), t));
    const actual = new Map(youGrid(nyGrid).map(([c, r, t]) => [`${c},${r}`, t]));
    expect(actual).toEqual(expected);
    expect([...actual.values()].filter((t) => t === null)).toHaveLength(20);
  });
});

describe("fetching (GET spec §2)", () => {
  const ref = { id: "10000002", code: "Test2" };

  it("fetches only the rebuilt address", async () => {
    const seen: string[] = [];
    const e: W2mEvent = await fetchEvent(ref, async (url) => {
      seen.push(url);
      return new Response(dates);
    });
    expect(seen).toEqual(["https://www.when2meet.com/?10000002-Test2"]);
    expect(e.slots).toHaveLength(160);
  });

  it.each([
    [404, "W2M_NOT_FOUND"],
    [500, "W2M_STATUS_500"],
    [503, "W2M_STATUS_503"],
    [302, "W2M_STATUS_302"],
    [301, "W2M_STATUS_301"],
  ])("HTTP %i is %s", async (status, expected) => {
    const res = new Response(status === 302 || status === 301 ? null : "x", { status, headers: status < 400 ? { location: "https://example.com/" } : {} });
    expect(await code(fetchEvent(ref, async () => res))).toBe(expected);
  });

  it("a network failure is W2M_FETCH", async () => {
    expect(
      await code(
        fetchEvent(ref, async () => {
          throw new Error("timed out");
        }),
      ),
    ).toBe("W2M_FETCH");
  });

  it("a page over the size limit is W2M_TOO_LARGE", async () => {
    expect(await code(fetchEvent(ref, async () => new Response(dates), 100_000))).toBe("W2M_TOO_LARGE");
    expect(await code(fetchEvent(ref, async () => new Response(dates), 300_000))).toBe("no error");
  });

  it("errors carry the event id and nothing else", async () => {
    try {
      await fetchEvent(ref, async () => new Response(home));
    } catch (e) {
      expect((e as Error).message).toContain("10000002");
      expect((e as Error).message).not.toContain("Test2");
      expect((e as Error).message).not.toContain("when2meet.com");
    }
  });
});
