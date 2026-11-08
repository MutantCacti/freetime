// The shared checks (DEV-SPEC.md §4). Each returns what it found; the commands print it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PLACEHOLDER_ID, databaseId, readRepoFile, senderDomain, siteHost, topLevelVar } from "./config.mjs";
import { stripAnsi } from "./output.mjs";
import { DEV_VARS, parseDotenv } from "./secrets.mjs";
import { DATABASE, NODE_MIN, WORKERS } from "./workers.mjs";

/** @param {string} version */
export function nodeOk(version) {
  return Number(version.split(".")[0]) >= NODE_MIN;
}

/**
 * Whether node_modules matches package-lock.json: every package the lock file
 * installs on this machine is there, at the locked version.
 * @param {string} root
 */
export function depsState(root) {
  if (!existsSync(join(root, "node_modules", ".bin", "wrangler"))) return { ok: false, problems: ["node_modules/.bin/wrangler"] };
  /** @type {Record<string, { version?: string, optional?: boolean, link?: boolean }>} */
  let packages;
  try {
    packages = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")).packages ?? {};
  } catch {
    return { ok: false, problems: ["package-lock.json"] };
  }
  /** @type {string[]} */
  const problems = [];
  for (const [path, entry] of Object.entries(packages)) {
    if (!path.startsWith("node_modules/") || !entry.version || entry.link) continue;
    const pkg = join(root, path, "package.json");
    if (!existsSync(pkg)) {
      // Optional packages are for other platforms (for example another CPU's esbuild).
      if (!entry.optional) problems.push(path.slice("node_modules/".length));
      continue;
    }
    try {
      if (JSON.parse(readFileSync(pkg, "utf8")).version !== entry.version) problems.push(path.slice("node_modules/".length));
    } catch {
      problems.push(path.slice("node_modules/".length));
    }
  }
  return { ok: problems.length === 0, problems };
}

/** @param {string} root */
export function host(root) {
  return siteHost(readRepoFile(root, WORKERS.site.config));
}

/** @param {string} root */
export function databaseIdState(root) {
  const id = databaseId(readRepoFile(root, WORKERS.accounts.config));
  if (!id) return { state: /** @type {const} */ ("missing"), id };
  if (id === PLACEHOLDER_ID) return { state: /** @type {const} */ ("placeholder"), id };
  return { state: /** @type {const} */ ("set"), id };
}

/** @param {string} root */
export function resendFromState(root) {
  const from = topLevelVar(readRepoFile(root, WORKERS.accounts.config), "RESEND_FROM");
  return { from, domain: senderDomain(from) };
}

/** `.dev.vars`: absent, without ICAL_URL, still the example, or filled in. Never returns the value. */
/** @param {string} root */
export function devVarsState(root) {
  const path = join(root, DEV_VARS);
  if (!existsSync(path)) return { state: /** @type {const} */ ("absent"), values: {} };
  const values = parseDotenv(readFileSync(path, "utf8"));
  const v = values.ICAL_URL;
  if (!v) return { state: /** @type {const} */ ("no-key"), values };
  if (v.includes("/.../")) return { state: /** @type {const} */ ("placeholder"), values };
  return { state: /** @type {const} */ ("ok"), values };
}

// ---------------------------------------------------------------- wrangler output

/** @param {string} text */
export function parseWhoami(text) {
  const t = stripAnsi(text);
  if (/not authenticated/i.test(t)) return { loggedIn: false, email: null };
  if (/You are logged in/i.test(t)) return { loggedIn: true, email: t.match(/associated with the email\s+(\S+?)\.?\s*$/m)?.[1] ?? null };
  return { loggedIn: null, email: null };
}

/** Pending migrations from `wrangler d1 migrations list`. */
/** @param {string} text @returns {string[] | null} null if the output wasn't understood */
export function parseMigrationsList(text) {
  const t = stripAnsi(text);
  if (/No migrations to apply/i.test(t)) return [];
  if (!/Migrations to be applied/i.test(t)) return null;
  return [...new Set([...t.matchAll(/\b(\d{4}_[\w.-]+?\.sql)\b/g)].map((m) => m[1] ?? ""))];
}

/** Names only: anything else in each entry is dropped here. */
/** @param {string} text @returns {string[] | null} */
export function parseSecretList(text) {
  const t = stripAnsi(text);
  const start = t.indexOf("[");
  if (start < 0) return null;
  try {
    const data = JSON.parse(t.slice(start, t.lastIndexOf("]") + 1));
    if (!Array.isArray(data)) return null;
    return data.map((e) => (e && typeof e.name === "string" ? e.name : null)).filter((n) => n !== null);
  } catch {
    return null;
  }
}

/** `wrangler d1 list --json`: name and id of each database. */
/** @param {string} text @returns {{ name: string, id: string }[] | null} */
export function parseD1List(text) {
  const t = stripAnsi(text);
  const start = t.indexOf("[");
  if (start < 0) return null;
  try {
    const data = JSON.parse(t.slice(start, t.lastIndexOf("]") + 1));
    if (!Array.isArray(data)) return null;
    return data.map((d) => ({ name: String(d?.name ?? ""), id: String(d?.uuid ?? d?.id ?? "") }));
  } catch {
    return null;
  }
}

/**
 * `wrangler deployments list --json`: the newest deployment's time and message.
 * @param {string} text @returns {{ when: string, message: string | null } | null}
 */
export function parseLatestDeployment(text) {
  const t = stripAnsi(text);
  const start = t.indexOf("[");
  if (start < 0) return null;
  try {
    const data = JSON.parse(t.slice(start, t.lastIndexOf("]") + 1));
    if (!Array.isArray(data) || data.length === 0) return null;
    const newest = [...data].sort((a, b) => String(b?.created_on ?? "").localeCompare(String(a?.created_on ?? "")))[0];
    const message = newest?.annotations?.["workers/message"] ?? null;
    return { when: String(newest?.created_on ?? ""), message: typeof message === "string" ? message : null };
  } catch {
    return null;
  }
}

/** The version id `wrangler deploy` prints. */
/** @param {string} text */
export function parseVersionId(text) {
  return stripAnsi(text).match(/Current Version ID:\s*([0-9a-f-]{8,})/i)?.[1] ?? null;
}

/** The commit at the start of a deploy message written by ft (`<sha> <branch>`). */
/** @param {string | null} message */
export function commitOfMessage(message) {
  return message?.match(/^([0-9a-f]{7,40})\b/)?.[1] ?? null;
}

// ---------------------------------------------------------------- migrations

/** Statements that remove or rename data: ft never applies these (DEV-SPEC.md §5.2). */
export const UNSAFE_SQL = [
  /\bDROP\s+(TABLE|COLUMN|INDEX|VIEW|TRIGGER)\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bALTER\s+TABLE\b[^;]*\bRENAME\b/i,
  /\bALTER\s+TABLE\b[^;]*\bDROP\b/i,
];

/** @param {string} sql */
export function withoutComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/** @param {string} sql */
export function isUnsafeMigration(sql) {
  const s = withoutComments(sql);
  return UNSAFE_SQL.some((re) => re.test(s));
}

/** @param {string} root @param {string[]} names */
export function unsafeMigrations(root, names) {
  return names.filter((n) => {
    const path = join(root, "migrations", n);
    return existsSync(path) && isUnsafeMigration(readFileSync(path, "utf8"));
  });
}

export { DATABASE };
