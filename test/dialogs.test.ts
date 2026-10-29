import { describe, expect, it } from "vitest";
import { attr, decode, makeApp, params, tagWith } from "./helpers";

const app = makeApp();

/** The HTML of the <dialog> with this id. */
function dialog(html: string, id: string): string {
  const start = html.indexOf(`<dialog class="dialog`, html.indexOf(`id="${id}"`) - 60);
  return html.slice(start, html.indexOf("</dialog>", start));
}

describe("dialogs", () => {
  it.each(["dlg-help", "dlg-contact", "dlg-download"])("%s has a Close (×) at the top right", async (id) => {
    const html = await app.html("/?view=week&date=2026-11-02");
    const d = dialog(html, id);
    // The head comes first: the title, then Close as its last item.
    expect(d).toMatch(/^<dialog[^>]*><div class="dialog-head"><h2 [^>]*>[^<]+<\/h2><button type="button" class="pill round close" data-close="true" aria-label="Close">/);
  });

  it("Contact's only close control is the ×", async () => {
    const d = dialog(await app.html("/"), "dlg-contact");
    expect(d.match(/data-close/g)?.length).toBe(1);
  });

  it("Download keeps Cancel next to Download; Cancel and × both close", async () => {
    const d = dialog(await app.html("/"), "dlg-download");
    expect(d.match(/data-close/g)?.length).toBe(2);
    expect(d).toMatch(/download="">Download<\/a><button type="button" class="pill" data-close="true">Cancel<\/button>/);
  });

  it("Help opens as a modal with JS and falls back to /help without it", async () => {
    const html = await app.html("/?view=month&date=2026-11-01&dtz=Europe/Paris");
    const help = tagWith(html, 'data-tb="help"');
    expect(attr(help, "data-dialog")).toBe("dlg-help");
    expect(attr(help, "href")).toBe("/help?view=month&date=2026-11-01&dtz=Europe/Paris");
    expect(dialog(html, "dlg-help")).toContain("What time. is");
    for (const name of ["download", "contact"]) expect(attr(tagWith(html, `data-tb="${name}"`), "data-dialog")).toBe(`dlg-${name}`);
  });
});

describe("pages close back to the calendar", () => {
  const q = "view=range&from=2026-11-02&to=2026-11-06&dtz=Europe/Paris&tz=Asia/Tokyo";
  it.each(["/help", "/contact", "/export", "/tz"])("%s", async (path) => {
    const html = decode(await app.html(`${path}?${q}`));
    const header = html.slice(html.indexOf('<header class="subheader">'), html.indexOf("</header>"));
    // Close is the last item in the header, so it sits at the top right.
    expect(header).toMatch(/<a class="pill round close" href="[^"]*" aria-label="Close"><svg[^>]*>.*<\/svg><\/a>$/);
    const href = /<a class="pill round close" href="([^"]*)"/.exec(header)![1]!;
    expect(href.startsWith("/?")).toBe(true);
    expect(Object.fromEntries(params(href))).toEqual({ view: "range", from: "2026-11-02", to: "2026-11-06", dtz: "Europe/Paris", tz: "Asia/Tokyo" });
    expect(html).not.toContain("‹ Calendar");
  });
});
