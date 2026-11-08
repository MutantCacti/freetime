// ./ft deploy (DEV-SPEC.md §5): the one flow that changes production.
import { commitOfMessage, databaseIdState, depsState, host, nodeOk, parseVersionId, resendFromState, unsafeMigrations } from "../checks.mjs";
import { readRepoFile, routePatterns } from "../config.mjs";
import { gitInfo, isIgnored } from "../git.mjs";
import { M } from "../messages.mjs";
import { stripAnsi } from "../output.mjs";
import { d1Databases, remotePending, whoami } from "../remote.mjs";
import {
  HASHES_FILE,
  SECRETS_FILE,
  changesSince,
  loadHashes,
  missingLocal,
  parseSecrets,
  readSecretsFile,
  recordDeployed,
  saveHashes,
  secretsJson,
} from "../secrets.mjs";
import { runSmoke } from "../smoke.mjs";
import { DATABASE, DEPLOY_ORDER, KEEP_FOREVER, WORKERS } from "../workers.mjs";

/** The wrangler deploy arguments for one Worker. Secrets arrive on stdin, never as arguments. */
/** @param {"site" | "accounts"} w @param {{ dryRun?: boolean, message?: string }} o */
export function deployArgs(w, { dryRun = false, message } = {}) {
  return [
    "deploy",
    ...WORKERS[w].configArgs,
    "--env=",
    ...(dryRun ? ["--dry-run"] : []),
    ...(message ? ["--message", message] : []),
    "--secrets-file",
    "/dev/stdin",
  ];
}

export const REMOTE_MIGRATE = ["d1", "migrations", "apply", DATABASE, "--remote", ...WORKERS.accounts.configArgs];

/** @param {string} text */
function tail(text, n = 20) {
  return stripAnsi(text)
    .split("\n")
    .filter((l) => l.trim())
    .slice(-n);
}

/**
 * Prints smoke results; returns whether all passed.
 * @param {import("../output.mjs").Output} out @param {Awaited<ReturnType<typeof runSmoke>>} results
 */
export function reportSmoke(out, results) {
  const failed = results.filter((r) => r.problems.length);
  for (const r of failed) {
    /** @type {string[]} */
    const more = [...r.problems];
    if (r.wrongWorker && r.check.worker === "accounts") more.push(...M.smoke.customDomain);
    if (r.debug) more.push(M.smoke.debug(r.debug.code, r.debug.ref));
    out.check("fail", `smoke ${r.check.n}`, `${r.check.method} ${r.check.path}`, more);
  }
  if (failed.length === 0) out.check("ok", "smoke", M.smoke.allPassed(results.length));
  else out.check("fail", "smoke", M.smoke.someFailed(failed.length, results.length));
  return failed.length === 0;
}

/** @param {import("../cli.mjs").Ctx} ctx */
export async function run(ctx) {
  const { out, runner, flags, root, deps } = ctx;
  /** @type {("site" | "accounts")[]} */
  const which = flags.only ? [flags.only] : DEPLOY_ORDER;
  const dryRun = Boolean(flags["dry-run"]);
  let failures = 0;
  let setupMissing = 0;
  /** @param {string} name @param {string} msg @param {string[]} [more] @param {boolean} [setup] */
  const fail = (name, msg, more = [], setup = false) => {
    out.check("fail", name, msg, more);
    if (setup) setupMissing++;
    else failures++;
  };
  const exitForFailures = () => (failures ? 1 : 3);

  out.heading(M.deploy.localHeading);

  // 1. Node and dependencies: nothing else can run without them.
  if (!nodeOk(deps.nodeVersion)) {
    out.check("fail", "node", M.node.old(deps.nodeVersion));
    return 1;
  }
  out.check("ok", "node", M.node.ok(deps.nodeVersion));
  if (!depsState(root).ok) {
    out.check("fail", "deps", M.common.needInstall);
    return 1;
  }
  out.check("ok", "deps", M.deps.ok);

  // 2–3. The commit being deployed.
  const git = await gitInfo(runner);
  if (!git.ok) fail("tree", M.git.unreadable);
  else if (!git.clean) fail("tree", M.git.dirty(git.changed));
  else out.check("ok", "tree", M.git.clean);
  if (git.ok) {
    if (git.branch !== "main" && !flags["allow-branch"]) fail("branch", M.git.notMain(git.branch));
    else out.check("ok", "branch", M.git.branch(git.branch, git.sha, git.subject));
    if (git.upstream === null) out.check("warn", "branch", M.git.noUpstream);
    else if (git.ahead) out.check("warn", "branch", M.git.ahead(git.ahead, git.upstream));
  }

  // 4. Accounts settings.
  if (which.includes("accounts")) {
    const id = databaseIdState(root);
    if (id.state === "set") out.check("ok", "database-id", M.database.set);
    else fail("database-id", id.state === "missing" ? M.database.missing : M.database.placeholder, M.database.howTo, true);
    const rf = resendFromState(root);
    if (rf.domain) out.check("ok", "resend-from", M.resend.fromOk(rf.domain));
    else fail("resend-from", M.resend.fromBad);
  }

  // 5. Local secret values (.secrets), which go up with each Worker's deploy.
  const text = readSecretsFile(root);
  const { values, problems } = text === null ? { values: { site: {}, accounts: {} }, problems: [] } : parseSecrets(text);
  for (const w of ["site", "accounts"]) for (const [n, v] of Object.entries(values[/** @type {"site" | "accounts"} */ (w)])) out.redactor.add(n, v);
  if (text === null) fail("secrets-file", M.secretsFile.absent(SECRETS_FILE), [M.secretsFile.howToStart], true);
  else {
    for (const p of problems) fail("secrets-file", M.secretsFile.problem(p.line, p.kind, p.name));
    const missing = missingLocal(values, which, WORKERS);
    for (const m of missing) fail("secrets-file", M.secretsFile.missing(m.worker, m.name), [M.secretsFile.setOne(m.name)], true);
    if (!problems.length && !missing.length) out.check("ok", "secrets-file", M.secretsFile.allThere(which));
  }
  if (text !== null && !(await isIgnored(runner, SECRETS_FILE))) fail("secrets-file", M.secretsFile.notIgnored);

  const hashes = loadHashes(root);
  /** @type {Record<string, Record<string, "new" | "same" | "changed">>} */
  const changes = {};
  for (const w of which) {
    changes[w] = changesSince(hashes, w, values[w], WORKERS[w].secrets);
    for (const n of KEEP_FOREVER) if (changes[w]?.[n] === "changed") fail("secret-rotate", M.secretsFile.keepForever(n), M.secretsFile.keepForeverMore);
  }

  // 6–7. The gate: tests, typecheck and a build of each Worker. Skipped if anything above failed.
  const earlier = failures + setupMissing;
  if (earlier) {
    out.check("skip", "tests", M.deploy.skippedAfterFailures);
  } else {
    const t = await runner.capture("npm", ["test"], { timeoutMs: 600_000 });
    const count = stripAnsi(t.stdout).match(/Tests\s+(\d+) passed/)?.[1];
    if (t.code === 0) out.check("ok", "tests", M.test.passedCount(count ?? null));
    else {
      fail("tests", M.test.failed);
      for (const l of tail(t.stdout + t.stderr, 30)) out.prefixed("npm", l);
    }
    const tc = await runner.capture("npm", ["run", "typecheck"], { timeoutMs: 600_000 });
    if (tc.code === 0) out.check("ok", "typecheck", M.test.typecheckPassed);
    else {
      fail("typecheck", M.test.typecheckFailed);
      for (const l of tail(tc.stdout + tc.stderr, 30)) out.prefixed("npm", l);
    }
    for (const w of which) {
      const b = await runner.capture("wrangler", deployArgs(w, { dryRun: true }), { input: secretsJson(values[w], WORKERS[w].secrets), timeoutMs: 180_000 });
      if (b.code === 0) out.check("ok", "build", M.deploy.built(WORKERS[w].name));
      else {
        fail("build", M.deploy.buildFailed(WORKERS[w].name));
        for (const l of tail(b.stdout + b.stderr)) out.prefixed("wrangler", l);
      }
    }
  }

  // 8–11. Cloudflare, read-only.
  out.heading(M.deploy.remoteHeading);
  /** @type {string[]} */
  let pending = [];
  const who = await whoami(runner);
  if (!who.loggedIn) {
    fail("login", who.loggedIn === false ? M.login.out : M.login.unknown, [M.login.howTo], true);
    out.check("skip", "remote-db", M.deploy.skippedNoLogin);
  } else {
    out.check("ok", "login", M.login.ok(who.email));
    if (which.includes("accounts")) {
      const id = databaseIdState(root);
      if (id.state === "set") {
        const dbs = await d1Databases(runner);
        const match = dbs?.find((d) => d.id === id.id);
        if (dbs === null) fail("database-id", M.database.listFailed);
        else if (!match) fail("database-id", M.database.notFound(id.id ?? ""), M.database.howTo, true);
        else if (match.name !== DATABASE) fail("database-id", M.database.otherName(match.name));
      }
      const list = await remotePending(runner);
      if (list === null) fail("remote-db", M.remoteDb.unreadable);
      else {
        pending = list;
        out.check("ok", "remote-db", list.length ? M.remoteDb.pending(list) : M.remoteDb.none);
        const unsafe = unsafeMigrations(root, list);
        for (const u of unsafe) fail("migration-safety", M.remoteDb.unsafe(u), [M.remoteDb.unsafeHow]);
      }
    }
  }
  const siteHost = host(root);
  if (!siteHost) fail("dns", M.dns.noRoute);
  else if (await deps.resolves(siteHost)) out.check("ok", "dns", M.dns.ok(siteHost));
  else fail("dns", M.dns.missing(siteHost), [M.dns.howTo], true);

  if (failures || setupMissing) {
    out.text("");
    out.text(M.deploy.notDeployed);
    return exitForFailures();
  }

  // The plan.
  const message = `${git.sha} ${git.branch}`;
  const accountsRoutes = routePatterns(readRepoFile(root, WORKERS.accounts.config)).map((p) => p.slice(p.indexOf("/")));
  const siteRoutes = routePatterns(readRepoFile(root, WORKERS.site.config));
  /** @type {string[]} */
  const steps = [];
  if (which.includes("accounts") && pending.length) steps.push(M.plan.migrate(DATABASE, pending));
  for (const w of which) {
    steps.push(M.plan.deploy(WORKERS[w].name, w === "accounts" ? accountsRoutes : siteRoutes));
    steps.push(M.plan.secrets(changes[w] ?? {}));
  }
  steps.push(M.plan.check(`https://${siteHost}`));
  out.block(M.plan.block(steps, git.branch, git.sha, git.subject));

  if (dryRun) {
    out.text(M.deploy.dryRunDone);
    return 0;
  }

  if (!flags.yes) {
    if (!deps.stdinIsTTY) {
      out.text(M.common.noTerminal);
      return 1;
    }
    const answer = (await deps.ask(M.deploy.confirm)).trim().toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      out.text(M.deploy.declined);
      return 130;
    }
  }

  // The writes. Stop at the first failure; never retry, never roll back.
  let migrated = false;
  /** @type {Partial<Record<"site" | "accounts", string>>} */
  const deployed = {};
  /** @param {string} what @param {string[]} next */
  const incomplete = (what, next) => {
    const changed = migrated || Object.keys(deployed).length > 0;
    if (!changed) {
      out.text(M.deploy.failedNothingChanged(what));
      return 1;
    }
    out.block(M.incomplete.block(what, which, deployed, migrated, next));
    return 4;
  };

  if (which.includes("accounts") && pending.length) {
    out.heading(M.deploy.migratingHeading(DATABASE));
    const code = await runner.stream("wrangler", REMOTE_MIGRATE, { onLine: (l) => out.prefixed("wrangler", l) });
    if (code !== 0) {
      migrated = true; // Some may have run.
      return incomplete(M.incomplete.migration, [M.incomplete.checkMigrations]);
    }
    migrated = true;
  }

  for (const w of which) {
    out.heading(M.deploy.deployingHeading(WORKERS[w].name));
    let output = "";
    const code = await runner.stream("wrangler", deployArgs(w, { message }), {
      input: secretsJson(values[w], WORKERS[w].secrets),
      onLine: (l) => {
        output += `${l}\n`;
        out.prefixed("wrangler", l);
      },
    });
    if (code !== 0) {
      const next = w === "site" && deployed.accounts ? [M.incomplete.retrySite, M.incomplete.rollback(WORKERS.accounts)] : [M.incomplete.fixAndRetry];
      return incomplete(M.incomplete.deployOf(WORKERS[w].name), next);
    }
    deployed[w] = parseVersionId(output) ?? M.deploy.unknownVersion;
    recordDeployed(hashes, w, values[w], WORKERS[w].secrets);
    saveHashes(root, hashes);
  }

  out.heading(M.deploy.smokeHeading(`https://${siteHost}`));
  const results = await runSmoke({ base: `https://${siteHost}`, fetch: deps.fetch, sleep: deps.sleep, now: deps.now });
  if (!reportSmoke(out, results)) {
    const next = [M.incomplete.logs, ...which.map((w) => M.incomplete.rollback(WORKERS[w]))];
    return incomplete(M.incomplete.smoke, next);
  }

  out.block(M.deploy.success(git.sha, git.branch, which.map((w) => [WORKERS[w].name, deployed[w] ?? ""])));
  if (which.includes("accounts")) out.block(M.deploy.manualCheck(`https://${siteHost}`));
  return 0;
}

export { HASHES_FILE, commitOfMessage };
