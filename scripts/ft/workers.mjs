// The facts about the two Workers, in one place (DEV-SPEC.md §3.5.1).
// The site's host is never written here: it's read from the route in wrangler.toml.

/**
 * @typedef {object} Worker
 * @property {"site" | "accounts"} key  ft's short name, used in flags and prefixes
 * @property {string} name              the Worker's name in its wrangler config
 * @property {string} config            its wrangler config file
 * @property {string[]} configArgs      the arguments that select that config
 * @property {string[]} secrets         secrets the Worker needs in production
 * @property {string[]} vars            plain variables it needs in its config
 */

/** @type {Record<"site" | "accounts", Worker>} */
export const WORKERS = {
  site: {
    key: "site",
    name: "freetime",
    config: "wrangler.toml",
    configArgs: [],
    secrets: ["ICAL_URL"],
    vars: [],
  },
  accounts: {
    key: "accounts",
    name: "freetime-accounts",
    config: "wrangler.accounts.toml",
    configArgs: ["-c", "wrangler.accounts.toml"],
    // ACCOUNTS_KEY: AES-GCM key material for calendar addresses in D1 (ACCOUNTS-SPEC.md, phase 2).
    secrets: ["RESEND_API_KEY", "ACCOUNTS_KEY"],
    vars: ["RESEND_FROM"],
  },
};

/** @type {("site" | "accounts")[]} */
export const WORKER_KEYS = ["site", "accounts"];

/** Deploy order (DEV-SPEC.md §5.3): the site is touched last. */
/** @type {("site" | "accounts")[]} */
export const DEPLOY_ORDER = ["accounts", "site"];

export const DATABASE = "freetime-accounts";
export const DEV_DATABASE = "freetime-accounts-dev";

/** Secrets ft never replaces once deployed: changing them loses data. */
export const KEEP_FOREVER = ["ACCOUNTS_KEY"];

/** Secrets `./ft secrets --generate` can make, and how many random bytes. */
/** @type {Record<string, number>} */
export const GENERATE = { ACCOUNTS_KEY: 32 };

/** Local ports (DEV-SPEC.md §3.2). `--port-offset` adds to all of them. */
export const PORTS = { site: 8787, accounts: 8788, router: 8780, siteInspector: 9229, accountsInspector: 9230 };

export const NODE_MIN = 20;

/** @param {number} offset */
export function portsWith(offset) {
  return Object.fromEntries(Object.entries(PORTS).map(([k, v]) => [k, v + offset]));
}

/** @param {string} name @returns {"site" | "accounts" | undefined} */
export function workerOfSecret(name) {
  return WORKER_KEYS.find((k) => WORKERS[k].secrets.includes(name));
}

/** Every required secret name, for both Workers. */
export function allSecretNames() {
  return WORKER_KEYS.flatMap((k) => WORKERS[k].secrets);
}
