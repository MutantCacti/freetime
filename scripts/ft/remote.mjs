// Read-only questions to Cloudflare, through wrangler.
import { parseD1List, parseLatestDeployment, parseMigrationsList, parseSecretList, parseWhoami } from "./checks.mjs";
import { DATABASE, WORKERS } from "./workers.mjs";

const T = { timeoutMs: 60_000 };

/** @param {import("./run.mjs").Runner} runner */
export async function whoami(runner) {
  return parseWhoami((await runner.capture("wrangler", ["whoami"], T)).stdout);
}

/** @param {import("./run.mjs").Runner} runner */
export async function remotePending(runner) {
  const r = await runner.capture("wrangler", ["d1", "migrations", "list", DATABASE, "--remote", ...WORKERS.accounts.configArgs], T);
  return r.code === 0 ? parseMigrationsList(r.stdout + r.stderr) : null;
}

/** @param {import("./run.mjs").Runner} runner */
export async function d1Databases(runner) {
  const r = await runner.capture("wrangler", ["d1", "list", "--json"], T);
  return r.code === 0 ? parseD1List(r.stdout) : null;
}

/** Secret names of one Worker; null if they couldn't be listed (for example, no such Worker yet). */
/** @param {import("./run.mjs").Runner} runner @param {"site" | "accounts"} w */
export async function secretNames(runner, w) {
  const r = await runner.capture("wrangler", ["secret", "list", ...WORKERS[w].configArgs, "--format", "json"], T);
  return r.code === 0 ? parseSecretList(r.stdout) : null;
}

/** @param {import("./run.mjs").Runner} runner @param {"site" | "accounts"} w */
export async function latestDeployment(runner, w) {
  const r = await runner.capture("wrangler", ["deployments", "list", ...WORKERS[w].configArgs, "--json"], T);
  return r.code === 0 ? parseLatestDeployment(r.stdout) : null;
}
