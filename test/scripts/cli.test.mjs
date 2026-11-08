import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMANDS, FLAGS, parse, suggest } from "../../scripts/ft/cli.mjs";
import { M } from "../../scripts/ft/messages.mjs";
import { ROOT, ft } from "./helpers.mjs";

const spec = readFileSync(join(ROOT, "DEV-SPEC.md"), "utf8");
const sources = () => {
  const dir = join(ROOT, "scripts", "ft");
  const files = [...readdirSync(dir).map((f) => join(dir, f)), ...readdirSync(join(dir, "commands")).map((f) => join(dir, "commands", f))].filter((f) => f.endsWith(".mjs"));
  return Object.fromEntries(files.map((f) => [f.slice(ROOT.length + 1), readFileSync(f, "utf8")]));
};

describe("ft arguments", () => {
  it("parses every command and its flags", () => {
    expect(parse(["deploy", "--only", "site", "--dry-run"])).toMatchObject({ ok: true, command: "deploy", flags: { only: "site", "dry-run": true } });
    expect(parse(["deploy", "--only=accounts"])).toMatchObject({ ok: true, flags: { only: "accounts" } });
    expect(parse(["start", "--port-offset", "10"])).toMatchObject({ ok: true, flags: { "port-offset": 10 } });
    expect(parse(["logs", "accounts", "--ref", "7K2Q9M"])).toMatchObject({ ok: true, positionals: ["accounts"], flags: { ref: "7K2Q9M" } });
    expect(parse([])).toMatchObject({ ok: true, command: "help" });
    for (const c of COMMANDS) expect(parse(c === "logs" ? [c, "site"] : [c]).ok, c).toBe(true);
  });

  it("refuses what it doesn't know", () => {
    expect(parse(["deploy", "--force"]).ok).toBe(false);
    expect(parse(["deploy", "--skip-tests"]).ok).toBe(false);
    expect(parse(["deploy", "--only", "both"]).ok).toBe(false);
    expect(parse(["deploy", "-y"]).ok).toBe(false);
    expect(parse(["deploy", "--dry-run=yes"]).ok).toBe(false);
    expect(parse(["logs"]).ok).toBe(false);
    expect(parse(["logs", "everything"]).ok).toBe(false);
    expect(parse(["status", "extra"]).ok).toBe(false);
    expect(parse(["secrets", "--set", "A", "--generate", "B"]).ok).toBe(false);
    expect(parse(["start", "--port-offset", "-1"]).ok).toBe(false);
  });

  it("suggests the nearest command", () => {
    expect(suggest("dpeloy")).toBe("deploy");
    expect(suggest("stat")).toBe("start");
    expect(suggest("xyzzy")).toBeNull();
  });

  it("prints the list with no command, and exits 2 on an unknown one", async () => {
    expect(await ft([])).toMatchObject({ code: 0, output: M.help.list });
    const r = await ft(["dpeloy"]);
    expect(r.code).toBe(2);
    expect(r.output).toContain("Did you mean deploy?");
    expect(r.calls).toEqual([]);
  });

  it("has help for every command, with the same four parts", async () => {
    for (const c of COMMANDS) {
      const h = M.help[/** @type {keyof typeof M.help} */ (c)];
      expect(h, c).toBeTruthy();
      expect(h, c).toContain(`./ft ${c}`);
      for (const part of ["Flags:", "Never:", "Exit:"]) expect(h, `${c} ${part}`).toContain(part);
      for (const flag of Object.keys(FLAGS[c] ?? {})) expect(h, `${c} --${flag}`).toContain(`--${flag}`);
      expect((await ft([c, "--help"])).output).toBe(h);
      expect((await ft(["help", c])).output).toBe(h);
      if (c !== "help") expect(M.help.list, c).toContain(`./ft ${c}`);
    }
  });
});

describe("spec sync (DEV-SPEC.md)", () => {
  it("lists exactly ft's commands", () => {
    const section = spec.slice(spec.indexOf("## 3. Commands"), spec.indexOf("### 3.1"));
    const listed = [...section.matchAll(/^\| `\.\/ft (\w+)/gm)].map((m) => m[1]);
    expect(listed.sort()).toEqual([...COMMANDS].sort());
  });

  it("has the same exit codes as the help text", () => {
    const section = spec.slice(spec.indexOf("### 2.2 Exit codes"), spec.indexOf("### 2.3"));
    const codes = [...section.matchAll(/^\| (\d+) \|/gm)].map((m) => Number(m[1]));
    expect(codes).toEqual([0, 1, 2, 3, 4, 130]);
    const inHelp = new Set(Object.values(M.help).flatMap((h) => [...h.matchAll(/\b(0|1|2|3|4|130) [a-z]/g)].map((m) => Number(m[1]))));
    for (const c of inHelp) expect(codes).toContain(c);
  });

  it("documents every check name ft prints, and nothing it doesn't", () => {
    const section = spec.slice(spec.indexOf("## 10. Check and failure codes"), spec.indexOf("## 11."));
    const documented = new Set([...section.matchAll(/^\| `([a-z-]+|FT_INTERNAL)`(?:, `([a-z-]+)`)?/gm)].flatMap((m) => [m[1], m[2]]).filter(Boolean));
    const used = new Set();
    const statuses = ["ok", "warn", "fail", "skip", "info"];
    for (const text of Object.values(sources())) {
      for (const m of text.matchAll(/\b(?:check|fail|report)\(\s*(?:"(?:ok|warn|fail|skip|info)",\s*)?"([a-z-]+)"/g)) if (!statuses.includes(m[1] ?? "")) used.add(m[1]);
    }
    used.delete("tests");
    used.delete("typecheck");
    for (const u of used) expect(documented, `${u} is printed but not in DEV-SPEC.md §10`).toContain(u);
    for (const d of documented) if (d !== "FT_INTERNAL" && d !== "tests" && d !== "typecheck" && d !== "smoke") expect(used, `${d} is in §10 but never printed`).toContain(d);
  });
});

describe("PRINTED OUTPUT (SPEC.md §2.1)", () => {
  it("marks every message in messages.mjs", () => {
    const text = readFileSync(join(ROOT, "scripts", "ft", "messages.mjs"), "utf8");
    // Every property whose value is a string or function sits under a marker.
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (/^\s+[a-zA-Z]+:\s*(\(|"|`|\[)/.test(line)) {
        expect(lines[i - 1], `line ${i + 1}: ${line.trim()}`).toMatch(/PRINTED OUTPUT/);
      }
    });
    expect((text.match(/PRINTED OUTPUT/g) ?? []).length).toBeGreaterThan(150);
  });

  it("prints only through the output module", () => {
    for (const [path, text] of Object.entries(sources())) {
      expect(text, path).not.toMatch(/console\.(log|error|warn)|process\.stdout\.write/);
    }
  });
});
