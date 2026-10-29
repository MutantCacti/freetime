import { describe, expect, it } from "vitest";
import { attr, decode, makeApp } from "./helpers";

const app = makeApp();
// In Maxence's order: [name for screen readers, link text, href, copied value, Copy's accessible name].
const LINKS: [string, string, string, string, string][] = [
  ["Email", "mutantcacti@gmail.com", "mailto:mutantcacti@gmail.com", "mutantcacti@gmail.com", "Copy email address"],
  ["GitHub", "github.com/MutantCacti", "https://github.com/MutantCacti", "https://github.com/MutantCacti", "Copy GitHub link"],
  ["Instagram", "instagram.com/maxencetmd", "https://instagram.com/maxencetmd", "https://instagram.com/maxencetmd", "Copy Instagram link"],
  ["LinkedIn", "linkedin.com/in/moreldierckxm", "https://www.linkedin.com/in/moreldierckxm/", "https://www.linkedin.com/in/moreldierckxm/", "Copy LinkedIn link"],
  ["Discord", "mutantcacti", "https://discord.com/users/1129364853157535797", "mutantcacti", "Copy Discord username"],
];

describe("contact", () => {
  it.each(["/contact", "/"])("%s: every link has its own Copy button, in a right-aligned cell", async (path) => {
    const html = decode(await app.html(path));
    const list = html.slice(html.indexOf('<dl class="contact-list">'), html.indexOf("</dl>"));
    const rows = [...list.matchAll(/<div class="contact-row">(.*?)<\/div>/g)].map((m) => m[1]!);
    expect(rows.length).toBe(LINKS.length);
    rows.forEach((row, i) => {
      const [name, text, href, value, label] = LINKS[i]!;
      // Icon only: the Tabler icon is decorative, and the name is there for screen readers only.
      expect(row).toMatch(new RegExp(`^<dt><svg [^>]*aria-hidden="true"[^>]*class="icon icon-brand">.*?</svg><span class="sr-only">${name}</span></dt>`));
      expect(row).toContain(`<a href="${href}"`);
      expect(row).toMatch(new RegExp(`>${text.replace(/[.]/g, "\\.")}</a>`));
      const button = /<button [^>]*class="btn copy-btn"[^>]*>/.exec(row)?.[0] ?? null;
      expect(attr(button, "data-copy")).toBe(value);
      expect(attr(button, "aria-label")).toBe(label);
      expect(button).toContain("hidden");
      expect(row).toMatch(/<dd class="copy-cell"><button/);
    });
  });

  it("has no intro text above the list", async () => {
    const html = decode(await app.html("/contact"));
    expect(html).not.toContain("Check a time here, then get in touch");
    expect(html).toMatch(/<main class="sub-main" id="main"><dl class="contact-list">/);
  });
});
