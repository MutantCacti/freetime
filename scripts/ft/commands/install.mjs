// ./ft install (DEV-SPEC.md §3.1)
import { depsState, devVarsState, nodeOk, parseWhoami } from "../checks.mjs";
import { M } from "../messages.mjs";
import { stripAnsi } from "../output.mjs";
import { SECRETS_FILE, parseSecrets, readSecretsFile, missingLocal } from "../secrets.mjs";
import { DEV_DATABASE, WORKERS, WORKER_KEYS } from "../workers.mjs";

/** The local database for ./ft start (also used by start). */
export const LOCAL_MIGRATE = ["d1", "migrations", "apply", DEV_DATABASE, "--local", ...WORKERS.accounts.configArgs, "--env", "dev"];

/** @param {import("../cli.mjs").Ctx} ctx */
export async function localDatabase({ out, runner }) {
  const r = await runner.capture("wrangler", LOCAL_MIGRATE, { timeoutMs: 120_000 });
  if (r.code !== 0) {
    out.check("fail", "local-db", M.localDb.failed(DEV_DATABASE));
    for (const l of stripAnsi(r.stdout + r.stderr).split("\n").filter((l) => l.trim()).slice(-15)) out.prefixed("wrangler", l);
    return false;
  }
  out.check("ok", "local-db", M.localDb.ok(DEV_DATABASE));
  return true;
}

/** @param {import("../cli.mjs").Ctx} ctx */
export async function run(ctx) {
  const { out, runner, root, deps } = ctx;
  out.heading(M.install.title);

  if (!nodeOk(deps.nodeVersion)) {
    out.check("fail", "node", M.node.old(deps.nodeVersion));
    return 1;
  }
  out.check("ok", "node", M.node.ok(deps.nodeVersion));

  // npm ci replaces node_modules, so it only runs when node_modules doesn't match the lock file.
  let state = depsState(root);
  if (state.ok) out.check("ok", "deps", M.deps.ok);
  else {
    out.check("info", "deps", M.deps.installing(state.problems.length));
    const code = await runner.stream("npm", ["ci"], { onLine: (l) => out.prefixed("npm", l) });
    state = depsState(root);
    if (code !== 0 || !state.ok) {
      out.check("fail", "deps", M.deps.failed);
      return 1;
    }
    out.check("ok", "deps", M.deps.ok);
  }

  if (!(await localDatabase(ctx))) return 1;

  const who = parseWhoami((await runner.capture("wrangler", ["whoami"], { timeoutMs: 30_000 })).stdout);
  if (who.loggedIn) out.check("ok", "login", M.login.ok(who.email));
  else if (who.loggedIn === false) out.check("warn", "login", M.login.out, [M.login.onlyToDeploy]);
  else out.check("warn", "login", M.login.unknown);

  const dv = devVarsState(root);
  for (const [name, value] of Object.entries(dv.values)) out.redactor.add(name, value);
  if (dv.state === "absent") out.check("ok", "dev-vars", M.devVars.absent, [M.devVars.forLive]);
  else if (dv.state === "ok") out.check("ok", "dev-vars", M.devVars.ok);
  else out.check("warn", "dev-vars", dv.state === "no-key" ? M.devVars.noKey : M.devVars.placeholder);

  const text = readSecretsFile(root);
  if (text === null) out.check("ok", "secrets-file", M.secretsFile.absent(SECRETS_FILE), [M.secretsFile.howToStart]);
  else {
    const { values } = parseSecrets(text);
    const missing = missingLocal(values, WORKER_KEYS, WORKERS);
    if (missing.length) out.check("warn", "secrets-file", M.secretsFile.someMissing(missing.map((m) => m.name)), [M.secretsFile.forDeploy]);
    else out.check("ok", "secrets-file", M.secretsFile.complete);
  }

  out.text("");
  out.text(M.install.ready);
  return 0;
}
