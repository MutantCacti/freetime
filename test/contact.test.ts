import { describe, expect, it } from "vitest";
import { attr, decode, makeApp } from "./helpers";

const app = makeApp();
// Email first, LinkedIn last, the rest in their original order.
const LINKS: [string, string, string][] = [
  ["Email", "mutantcacti@gmail.com", "Copy email address"],
  ["Discord", "https://discord.com/users/1129364853157535797", "Copy Discord link"],
  ["GitHub", "https://github.com/MutantCacti", "Copy GitHub link"],
  ["Instagram", "https://instagram.com/maxencetmd", "Copy Instagram link"],
  ["LinkedIn", "https://www.linkedin.com/in/moreldierckxm/", "Copy LinkedIn link"],
];

describe("contact", () => {
  it.each(["/contact", "/"])("%s: every link has its own Copy button, in a right-aligned cell", async (path) => {
    const html = decode(await app.html(path));
    const list = html.slice(html.indexOf('<dl class="contact-list">'), html.indexOf("</dl>"));
    const rows = [...list.matchAll(/<div class="contact-row">(.*?)<\/div>/g)].map((m) => m[1]!);
    expect(rows.length).toBe(LINKS.length);
    rows.forEach((row, i) => {
      const [name, value, label] = LINKS[i]!;
      // Each medium has its Tabler icon, decorative, before its name.
      expect(row).toMatch(new RegExp(`^<dt><svg [^>]*aria-hidden="true"[^>]*class="icon icon-brand">.*?</svg>${name}</dt>`));
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
