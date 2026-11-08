// Narrow, tested readers for the two wrangler configs (DEV-SPEC.md §4).
// One value each; not a TOML parser. The tests run them on the real files.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";

/** @param {string} root @param {string} rel */
export function readRepoFile(root, rel) {
  return readFileSync(join(root, rel), "utf8");
}

/** @param {string} root @param {string} rel */
export function repoFileExists(root, rel) {
  return existsSync(join(root, rel));
}

/** The part of a config before the first `[env.…]` table: production settings only. */
/** @param {string} toml */
export function topLevel(toml) {
  const i = toml.search(/^\[\[?env\./m);
  return i < 0 ? toml : toml.slice(0, i);
}

/** @param {string} toml @returns {string[]} */
export function routePatterns(toml) {
  return [...topLevel(toml).matchAll(/^\s*\{\s*pattern\s*=\s*"([^"]+)"/gm)].map((m) => m[1] ?? "");
}

/** The production host, from the first route pattern (`host/*`). */
/** @param {string} toml */
export function siteHost(toml) {
  const first = routePatterns(toml)[0];
  if (!first) return null;
  return first.split("/")[0] || null;
}

/** Route paths without the host: `/account*`, `/u/*`, … */
/** @param {string} toml */
export function routePaths(toml) {
  return routePatterns(toml).map((p) => p.slice(p.indexOf("/")));
}

/** @param {string} toml */
export function workerName(toml) {
  return toml.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? null;
}

/** The top-level D1 `database_id` (the `env.dev` one is local only). */
/** @param {string} toml */
export function databaseId(toml) {
  return topLevel(toml).match(/^\s*database_id\s*=\s*"([^"]*)"/m)?.[1] ?? null;
}

/** A top-level `[vars]` value. */
/** @param {string} toml @param {string} name */
export function topLevelVar(toml, name) {
  const top = topLevel(toml);
  const start = top.search(/^\[vars\]\s*$/m);
  if (start < 0) return null;
  const rest = top.slice(start).split("\n").slice(1).join("\n");
  const end = rest.search(/^\[/m);
  const block = end < 0 ? rest : rest.slice(0, end);
  const re = new RegExp(`^\\s*${name}\\s*=\\s*"([^"]*)"`, "m");
  return block.match(re)?.[1] ?? null;
}

/** `name <address@domain>`: returns the domain, or null if it doesn't look like that. */
/** @param {string | null} from */
export function senderDomain(from) {
  return from?.match(/^[^<>]+<[^@<>\s]+@([a-z0-9.-]+\.[a-z]{2,})>$/i)?.[1] ?? null;
}
