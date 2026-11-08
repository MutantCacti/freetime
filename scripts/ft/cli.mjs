// Argument parsing and dispatch for ./ft (DEV-SPEC.md §3).
import { M } from "./messages.mjs";
import { createOutput } from "./output.mjs";
import { guarded } from "./run.mjs";

export const COMMANDS = ["help", "install", "start", "test", "status", "deploy", "secrets", "logs"];

/** @typedef {"bool" | "string" | "worker" | "int"} FlagType */

/** @type {Record<string, FlagType>} */
const COMMON = { help: "bool", verbose: "bool" };

/** @type {Record<string, Record<string, FlagType>>} */
export const FLAGS = {
  help: {},
  install: {},
  start: { live: "bool", only: "worker", "no-router": "bool", "port-offset": "int" },
  test: { only: "worker" },
  status: { offline: "bool" },
  deploy: { only: "worker", "dry-run": "bool", yes: "bool", "allow-branch": "bool" },
  secrets: { set: "string", generate: "string", yes: "bool" },
  logs: { ref: "string", errors: "bool" },
};

/** How many positional arguments each command takes: [min, max]. */
/** @type {Record<string, [number, number]>} */
const POSITIONALS = { help: [0, 1], logs: [1, 1] };

/** @param {string} a @param {string} b */
export function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** @param {string} word */
export function suggest(word) {
  const best = COMMANDS.map((c) => /** @type {const} */ ([c, distance(word, c)])).sort((x, y) => x[1] - y[1])[0];
  return best && best[1] <= 2 ? best[0] : null;
}

/**
 * @typedef {{ ok: true, command: string, flags: Record<string, any>, positionals: string[] }} Parsed
 * @typedef {{ ok: false, command: string | null, error: string }} ParseError
 * @param {string[]} argv
 * @returns {Parsed | ParseError}
 */
export function parse(argv) {
  const first = argv.find((a) => !a.startsWith("-"));
  const command = first ?? "help";
  if (!COMMANDS.includes(command)) {
    const s = suggest(command);
    return { ok: false, command: null, error: M.usage.unknownCommand(command, s) };
  }
  const spec = { ...COMMON, ...FLAGS[command] };
  /** @type {Record<string, any>} */
  const flags = {};
  /** @type {string[]} */
  const positionals = [];
  let seenCommand = first === undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (!a.startsWith("-")) {
      if (!seenCommand && a === command) {
        seenCommand = true;
        continue;
      }
      positionals.push(a);
      continue;
    }
    if (!a.startsWith("--") || a === "--") return { ok: false, command, error: M.usage.unknownFlag(a, command) };
    const eq = a.indexOf("=");
    const name = a.slice(2, eq < 0 ? undefined : eq);
    const type = spec[name];
    if (!type) return { ok: false, command, error: M.usage.unknownFlag(`--${name}`, command) };
    if (type === "bool") {
      if (eq >= 0) return { ok: false, command, error: M.usage.noValue(`--${name}`) };
      flags[name] = true;
      continue;
    }
    let value = eq >= 0 ? a.slice(eq + 1) : argv[++i];
    if (value === undefined || value === "" || (eq < 0 && value.startsWith("--"))) return { ok: false, command, error: M.usage.missingValue(`--${name}`) };
    if (type === "worker" && value !== "site" && value !== "accounts") return { ok: false, command, error: M.usage.badWorker(`--${name}`, value) };
    if (type === "int") {
      if (!/^\d{1,4}$/.test(value)) return { ok: false, command, error: M.usage.badInt(`--${name}`, value) };
      flags[name] = Number(value);
      continue;
    }
    flags[name] = value;
  }
  if (flags.help) return { ok: true, command, flags, positionals };
  const [min, max] = POSITIONALS[command] ?? [0, 0];
  if (positionals.length > max) return { ok: false, command, error: M.usage.extraArgs(positionals[max] ?? "", command) };
  if (positionals.length < min) return { ok: false, command, error: M.usage.missingArg(command) };
  if (command === "help" && positionals[0] && !COMMANDS.includes(positionals[0])) {
    return { ok: false, command: null, error: M.usage.unknownCommand(positionals[0], suggest(positionals[0])) };
  }
  if (command === "logs" && positionals[0] !== "site" && positionals[0] !== "accounts") {
    return { ok: false, command, error: M.usage.badWorker("logs", positionals[0] ?? "") };
  }
  if (command === "secrets" && flags.set && flags.generate) return { ok: false, command, error: M.usage.setAndGenerate };
  return { ok: true, command, flags, positionals };
}

/**
 * @typedef {object} Deps
 * @property {string} root
 * @property {(s: string) => void} write
 * @property {boolean} color
 * @property {import("./run.mjs").Runner} runner
 * @property {string} nodeVersion
 * @property {boolean} stdinIsTTY
 * @property {(question: string) => Promise<string>} ask
 * @property {(question: string) => Promise<string | null>} readHidden
 * @property {typeof fetch} fetch
 * @property {(ms: number) => Promise<void>} sleep
 * @property {() => number} now
 * @property {(host: string, type?: "TXT") => Promise<boolean>} resolves
 * @property {(port: number) => Promise<boolean>} portBusy
 * @property {(port: number, timeoutMs: number) => Promise<boolean>} waitHttp
 * @property {(handler: () => void) => () => void} onInterrupt
 * @property {number} [stopGraceMs]
 * @property {(o: { accountsPaths: string[], ports: Record<string, number> }) => import("node:http").Server} [createRouter]
 */

/**
 * Runs one ft invocation and returns its exit code.
 * @param {string[]} argv @param {Deps} deps
 */
export async function main(argv, deps) {
  const out = createOutput({ write: deps.write, color: deps.color });
  const parsed = parse(argv);
  if (!parsed.ok) {
    out.text(parsed.error);
    out.text("");
    out.block(parsed.command ? M.help[parsed.command] : M.help.list);
    return 2;
  }
  const { command, flags, positionals } = parsed;
  if (command === "help") {
    out.block(positionals[0] ? M.help[positionals[0]] : flags.help && argv.includes("help") ? M.help.help : M.help.list);
    return 0;
  }
  if (flags.help) {
    out.block(M.help[command]);
    return 0;
  }
  const runner = guarded(deps.runner, { verbose: Boolean(flags.verbose), echo: (l) => out.text(l) });
  const ctx = { root: deps.root, out, runner, flags, positionals, deps };
  try {
    const mod = await import(`./commands/${command}.mjs`);
    return await mod.run(ctx);
  } catch (e) {
    const err = /** @type {Error} */ (e);
    out.text(M.common.internal(err.message));
    if (flags.verbose && err.stack) out.text(err.stack);
    return 1;
  }
}

/** @typedef {{ root: string, out: import("./output.mjs").Output, runner: import("./run.mjs").Runner, flags: Record<string, any>, positionals: string[], deps: Deps }} Ctx */
