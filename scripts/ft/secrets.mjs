// The local secrets file, `.secrets` (DEV-SPEC.md §6). Gitignored, never read by
// anything in src/ or public/. ft sends its values to wrangler on stdin only.
import { createHmac, randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WORKER_KEYS } from "./workers.mjs";

export const SECRETS_FILE = ".secrets";
export const SECRETS_EXAMPLE = ".secrets.example";
/** Keyed hashes of the values last deployed, for change detection. Never the values. */
export const HASHES_FILE = ".secrets.hashes";
export const DEV_VARS = ".dev.vars";

/**
 * @typedef {{ line: number, kind: "section" | "syntax" | "outside" | "multiline", name?: string }} Problem
 * @typedef {{ site: Record<string, string>, accounts: Record<string, string> }} SecretValues
 */

/** @param {string} v */
function unquote(v) {
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) return v.slice(1, -1);
  return v;
}

/**
 * `[site]` and `[accounts]` sections of `NAME=value` lines. `#` starts a comment line.
 * The value is the rest of the line (quotes around it are removed).
 * @param {string} text
 */
export function parseSecrets(text) {
  /** @type {SecretValues} */
  const values = { site: {}, accounts: {} };
  /** @type {Problem[]} */
  const problems = [];
  /** @type {"site" | "accounts" | null} */
  let section = null;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const s = line.match(/^\[([^\]]+)\]$/);
    if (s) {
      const name = s[1] ?? "";
      section = name === "site" || name === "accounts" ? name : null;
      if (!section) problems.push({ line: i + 1, kind: "section", name });
      return;
    }
    const kv = line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!kv) {
      problems.push({ line: i + 1, kind: "syntax" });
      return;
    }
    if (!section) {
      problems.push({ line: i + 1, kind: "outside", name: kv[1] });
      return;
    }
    values[section][kv[1] ?? ""] = unquote(kv[2] ?? "");
  });
  return { values, problems };
}

/** `NAME=value` lines without sections (`.dev.vars`). Names and values; values are only for redaction. */
/** @param {string} text */
export function parseDotenv(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) out[m[1] ?? ""] = unquote(m[2] ?? "");
  }
  return out;
}

/**
 * Sets one value in the file's text, keeping everything else (comments included).
 * @param {string} text @param {"site" | "accounts"} section @param {string} name @param {string} value
 */
export function setSecretText(text, section, name, value) {
  if (/[\r\n]/.test(value)) throw new Error("A secret value must be one line.");
  const lines = text.split("\n");
  /** @type {string | null} */
  let current = null;
  let lastInSection = -1;
  let found = -1;
  lines.forEach((raw, i) => {
    const line = raw.trim();
    const s = line.match(/^\[([^\]]+)\]$/);
    if (s) {
      current = s[1] ?? null;
      if (current === section) lastInSection = i;
      return;
    }
    if (current !== section) return;
    if (line) lastInSection = i;
    if (new RegExp(`^${name}\\s*=`).test(line)) found = i;
  });
  const entry = `${name}=${value}`;
  if (found >= 0) lines[found] = entry;
  else if (lastInSection >= 0) lines.splice(lastInSection + 1, 0, entry);
  else {
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    lines.push("", `[${section}]`, entry, "");
  }
  let out = lines.join("\n");
  if (!out.endsWith("\n")) out += "\n";
  return out;
}

/** @param {string} root */
export function readSecretsFile(root) {
  const path = join(root, SECRETS_FILE);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

/** Writes `.secrets` readable by its owner only. @param {string} root @param {string} text */
export function writeSecretsFile(root, text) {
  const path = join(root, SECRETS_FILE);
  writeFileSync(path, text, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** The text a new `.secrets` starts from: the example, if there is one. @param {string} root */
export function startingText(root) {
  const example = join(root, SECRETS_EXAMPLE);
  return existsSync(example) ? readFileSync(example, "utf8") : "";
}

/** base64url of `bytes` random bytes. @param {number} bytes */
export function generateKey(bytes) {
  return randomBytes(bytes).toString("base64url");
}

/** The required secrets of the given Workers that have no local value. */
/** @param {SecretValues} values @param {("site" | "accounts")[]} workers @param {Record<string, { secrets: string[] }>} defs */
export function missingLocal(values, workers, defs) {
  return workers.flatMap((w) => (defs[w]?.secrets ?? []).filter((n) => !values[w][n]).map((n) => ({ worker: w, name: n })));
}

// ---------------------------------------------------------------- hashes

/**
 * @typedef {{ salt: string, site: Record<string, string>, accounts: Record<string, string> }} Hashes
 */

/** @param {string} root @returns {Hashes} */
export function loadHashes(root) {
  const path = join(root, HASHES_FILE);
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    if (typeof data.salt === "string") return { salt: data.salt, site: data.site ?? {}, accounts: data.accounts ?? {} };
  } catch {
    // Missing or unreadable: nothing recorded yet.
  }
  return { salt: randomBytes(16).toString("base64url"), site: {}, accounts: {} };
}

/** @param {string} root @param {Hashes} hashes */
export function saveHashes(root, hashes) {
  const path = join(root, HASHES_FILE);
  writeFileSync(path, `${JSON.stringify(hashes, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** @param {string} salt @param {string} value */
export function hashOf(salt, value) {
  return createHmac("sha256", salt).update(value).digest("base64url");
}

/**
 * For each secret of a Worker: "new" (never deployed through ft), "same" or "changed".
 * @param {Hashes} hashes @param {"site" | "accounts"} worker @param {Record<string, string>} values @param {string[]} names
 * @returns {Record<string, "new" | "same" | "changed">}
 */
export function changesSince(hashes, worker, values, names) {
  /** @type {Record<string, "new" | "same" | "changed">} */
  const out = {};
  for (const n of names) {
    const last = hashes[worker][n];
    const v = values[n];
    out[n] = !last ? "new" : v !== undefined && hashOf(hashes.salt, v) === last ? "same" : "changed";
  }
  return out;
}

/** Records the values just deployed. @param {Hashes} hashes @param {"site" | "accounts"} worker @param {Record<string, string>} values @param {string[]} names */
export function recordDeployed(hashes, worker, values, names) {
  for (const n of names) {
    const v = values[n];
    if (v !== undefined) hashes[worker][n] = hashOf(hashes.salt, v);
  }
}

/** The JSON wrangler reads from stdin with `--secrets-file /dev/stdin`. */
/** @param {Record<string, string>} values @param {string[]} names */
export function secretsJson(values, names) {
  /** @type {Record<string, string>} */
  const obj = {};
  for (const n of names) if (values[n] !== undefined) obj[n] = values[n];
  return JSON.stringify(obj);
}

export { WORKER_KEYS };
