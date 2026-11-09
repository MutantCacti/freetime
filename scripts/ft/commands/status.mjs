// ./ft status (DEV-SPEC.md §3.4): read-only. What's here, what's live, what's missing.
import { commitOfMessage, databaseIdState, depsState, host, parseMigrationsList, resendFromState } from "../checks.mjs";
import { commitsBehind, gitInfo } from "../git.mjs";
import { M } from "../messages.mjs";
import { d1Databases, latestDeployment, remotePending, secretNames, whoami } from "../remote.mjs";
import { SECRETS_FILE, missingLocal, parseSecrets, readSecretsFile } from "../secrets.mjs";
import { runSmoke } from "../smoke.mjs";
import { DATABASE, DEV_DATABASE, WORKERS, WORKER_KEYS } from "../workers.mjs";
import { reportSmoke } from "./deploy.mjs";

/** @param {import("../cli.mjs").Ctx} ctx */
export async function run(ctx) {
  const { out, runner, flags, root, deps } = ctx;
  let attention = 0;
  let setup = 0;
  /** @param {"ok" | "warn" | "fail"} kind @param {string} name @param {string} msg @param {string[]} [more] @param {boolean} [isSetup] */
  const report = (kind, name, msg, more = [], isSetup = false) => {
    out.check(kind, name, msg, more);
    if (kind !== "ok") {
      if (isSetup) setup++;
      else attention++;
    }
  };

  out.heading(M.status.local);
  const git = await gitInfo(runner);
  if (!git.ok) report("fail", "branch", M.git.unreadable);
  else {
    const pushed = git.upstream === null ? M.git.noUpstreamShort : git.ahead ? M.git.aheadShort(git.ahead, git.upstream) : M.git.sameAs(git.upstream);
    report(git.clean && git.upstream !== null && !git.ahead ? "ok" : "warn", "branch", M.status.branch(git.branch, git.clean, pushed));
    out.check("ok", "commit", `${git.sha} ${git.subject}`);
  }
  if (!depsState(root).ok) report("warn", "deps", M.common.needInstall);
  else out.check("ok", "deps", M.deps.ok);
  const local = await runner.capture("wrangler", ["d1", "migrations", "list", DEV_DATABASE, "--local", ...WORKERS.accounts.configArgs, "--env", "dev"], { timeoutMs: 60_000 });
  const localPending = local.code === 0 ? parseMigrationsList(local.stdout + local.stderr) : null;
  if (localPending === null) report("warn", "local-db", M.localDb.unreadable(DEV_DATABASE));
  else if (localPending.length) report("warn", "local-db", M.localDb.pending(DEV_DATABASE, localPending));
  else out.check("ok", "local-db", M.localDb.upToDate(DEV_DATABASE));

  out.heading(M.status.setup);
  const id = databaseIdState(root);
  if (id.state === "set") out.check("ok", "database-id", M.database.set);
  else report("fail", "database-id", id.state === "missing" ? M.database.missing : M.database.placeholder, M.database.howTo, true);
  const rf = resendFromState(root);
  if (rf.domain) out.check("ok", "resend-from", M.resend.fromOk(rf.domain));
  else report("fail", "resend-from", M.resend.fromBad);
  const text = readSecretsFile(root);
  if (text === null) report("fail", "secrets-file", M.secretsFile.absent(SECRETS_FILE), [M.secretsFile.howToStart], true);
  else {
    const missing = missingLocal(parseSecrets(text).values, WORKER_KEYS, WORKERS);
    if (missing.length) report("fail", "secrets-file", M.secretsFile.someMissing(missing.map((m) => m.name)), [M.secretsFile.forDeploy], true);
    else out.check("ok", "secrets-file", M.secretsFile.complete);
  }
  const siteHost = host(root);
  if (!flags.offline) {
    if (siteHost && (await deps.resolves(siteHost))) out.check("ok", "dns", M.dns.ok(siteHost));
    else report("fail", "dns", M.dns.missing(siteHost ?? "?"), [M.dns.howTo], true);
    if (rf.domain) {
      if (await deps.resolves(`resend._domainkey.${rf.domain}`, "TXT")) out.check("ok", "resend-dns", M.resend.dkimOk(rf.domain));
      else report("warn", "resend-dns", M.resend.dkimMissing(rf.domain));
    }
  }

  if (!flags.offline) {
    const who = await whoami(runner);
    out.heading(M.status.cloudflare(who.loggedIn ? who.email : null));
    if (!who.loggedIn) report("fail", "login", who.loggedIn === false ? M.login.out : M.login.unknown, [M.login.howTo], true);
    else {
      for (const w of WORKER_KEYS) {
        const d = await latestDeployment(runner, w);
        if (!d) {
          report("warn", w, M.status.notDeployed(WORKERS[w].name));
          continue;
        }
        const sha = commitOfMessage(d.message);
        let where;
        if (!sha) where = M.status.withoutFt;
        else if (git.ok && sha.startsWith(git.sha)) where = M.status.sameAsHead;
        else {
          const behind = await commitsBehind(runner, sha);
          where = behind === null ? M.status.notInHistory : M.status.behind(behind);
        }
        report(sha && git.ok && sha.startsWith(git.sha) ? "ok" : "warn", w, M.status.deployed(WORKERS[w].name, d.when, sha, where));
      }
      for (const w of WORKER_KEYS) {
        const names = await secretNames(runner, w);
        if (names === null) report("warn", "secrets", M.status.secretsUnknown(WORKERS[w].name));
        else {
          const missing = WORKERS[w].secrets.filter((n) => !names.includes(n));
          if (missing.length) report("warn", "secrets", M.status.secretsMissing(WORKERS[w].name, missing));
          else out.check("ok", "secrets", M.status.secretsSet(WORKERS[w].name, WORKERS[w].secrets));
        }
      }
      if (id.state === "set") {
        const dbs = await d1Databases(runner);
        const match = dbs?.find((d) => d.id === id.id);
        if (dbs === null) report("warn", "database-id", M.database.listFailed);
        else if (!match) report("fail", "database-id", M.database.notFound(id.id ?? ""), M.database.howTo, true);
        else if (match.name !== DATABASE) report("fail", "database-id", M.database.otherName(match.name));
      } else {
        const dbs = await d1Databases(runner);
        const existing = dbs?.find((d) => d.name === DATABASE);
        if (existing) out.check("info", "database-id", M.database.paste(existing.id));
      }
      const pending = await remotePending(runner);
      if (pending === null) report("warn", "remote-db", M.remoteDb.unreadable);
      else if (pending.length) report("warn", "remote-db", M.remoteDb.pending(pending));
      else out.check("ok", "remote-db", M.remoteDb.none);
    }

    if (siteHost) {
      out.heading(M.status.live(`https://${siteHost}`));
      const results = await runSmoke({ base: `https://${siteHost}`, fetch: deps.fetch, sleep: deps.sleep, now: deps.now, timeoutMs: 0 });
      if (!reportSmoke(out, results)) attention++;
    }
  }

  out.text("");
  if (setup) return 3;
  return attention ? 1 : 0;
}
