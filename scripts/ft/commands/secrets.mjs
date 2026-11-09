// ./ft secrets (DEV-SPEC.md §3.5): the local .secrets file, and setting one secret by hand.
import { isIgnored } from "../git.mjs";
import { M } from "../messages.mjs";
import { secretNames, whoami } from "../remote.mjs";
import {
  SECRETS_FILE,
  generateKey,
  loadHashes,
  parseSecrets,
  readSecretsFile,
  recordDeployed,
  saveHashes,
  setSecretText,
  startingText,
  writeSecretsFile,
} from "../secrets.mjs";
import { GENERATE, KEEP_FOREVER, WORKERS, WORKER_KEYS, workerOfSecret } from "../workers.mjs";

/** @param {import("../cli.mjs").Ctx} ctx */
export async function run(ctx) {
  const { out, runner, flags, root, deps } = ctx;
  const text = readSecretsFile(root);
  const parsed = parseSecrets(text ?? "");
  for (const w of WORKER_KEYS) for (const [n, v] of Object.entries(parsed.values[w])) out.redactor.add(n, v);

  if (text !== null && !(await isIgnored(runner, SECRETS_FILE))) {
    out.check("fail", "secrets-file", M.secretsFile.notIgnored);
    return 1;
  }

  /** @param {"site" | "accounts"} w @param {string} name @param {string} value */
  const save = (w, name, value) => writeSecretsFile(root, setSecretText(text ?? startingText(root), w, name, value));

  if (flags.generate) {
    const name = String(flags.generate);
    const bytes = GENERATE[name];
    const w = workerOfSecret(name);
    if (!bytes || !w) {
      out.text(M.secrets.cannotGenerate(name, Object.keys(GENERATE)));
      return 2;
    }
    if (parsed.values[w][name]) {
      out.check("fail", "secrets-file", M.secrets.alreadySet(name));
      return 1;
    }
    save(w, name, generateKey(bytes));
    out.check("ok", "secrets-file", M.secrets.generated(name, bytes, SECRETS_FILE), M.secrets.generatedMore);
    return 0;
  }

  if (flags.set) {
    const name = String(flags.set);
    const w = workerOfSecret(name);
    if (!w) {
      out.text(M.secrets.unknown(name, WORKER_KEYS.flatMap((k) => WORKERS[k].secrets)));
      return 2;
    }
    const hashes = loadHashes(root);
    if (KEEP_FOREVER.includes(name) && (hashes[w][name] || parsed.values[w][name])) {
      out.check("fail", "secret-rotate", M.secretsFile.keepForever(name), M.secretsFile.keepForeverMore);
      return 1;
    }
    if (!deps.stdinIsTTY) {
      out.text(M.common.noTerminal);
      return 1;
    }
    out.text(M.secrets.hint(name));
    const value = await deps.readHidden(M.secrets.prompt(name));
    if (value === null) {
      out.text(M.secrets.cancelled);
      return 130;
    }
    if (!value.trim()) {
      out.check("fail", "secrets-file", M.secrets.empty(name));
      return 1;
    }
    if (/[\r\n]/.test(value)) {
      out.check("fail", "secrets-file", M.secrets.oneLine);
      return 1;
    }
    out.redactor.add(name, value);
    save(w, name, value.trim());
    out.check("ok", "secrets-file", M.secrets.saved(name, SECRETS_FILE));

    // Optionally put it on the live Worker now, so a fix (a new ICAL_URL) doesn't wait for a deploy.
    const who = await whoami(runner);
    if (!who.loggedIn) {
      out.check("info", "secrets", M.secrets.nextDeploy(WORKERS[w].name));
      return 0;
    }
    const yes = flags.yes || ["y", "yes"].includes((await deps.ask(M.secrets.putNow(name, WORKERS[w].name))).trim().toLowerCase());
    if (!yes) {
      out.check("info", "secrets", M.secrets.nextDeploy(WORKERS[w].name));
      return 0;
    }
    const code = await runner.stream("wrangler", ["secret", "put", name, ...WORKERS[w].configArgs], { input: value.trim(), onLine: (l) => out.prefixed("wrangler", l) });
    if (code !== 0) {
      out.check("fail", "secrets", M.secrets.putFailed(name, WORKERS[w].name));
      return 1;
    }
    recordDeployed(hashes, w, { [name]: value.trim() }, [name]);
    saveHashes(root, hashes);
    out.check("ok", "secrets", M.secrets.put(name, WORKERS[w].name));
    return 0;
  }

  // No flags: what's set where, names only.
  out.heading(M.secrets.listHeading(SECRETS_FILE));
  const who = await whoami(runner);
  let missingLocal = 0;
  for (const w of WORKER_KEYS) {
    const remote = who.loggedIn ? await secretNames(runner, w) : null;
    for (const n of WORKERS[w].secrets) {
      const here = Boolean(parsed.values[w][n]);
      if (!here) missingLocal++;
      const there = remote === null ? null : remote.includes(n);
      out.check(here ? "ok" : "fail", n, M.secrets.row(WORKERS[w].name, here, there), here ? [] : [M.secretsFile.setOne(n)]);
    }
  }
  if (!who.loggedIn) out.check("info", "login", M.secrets.remoteUnknown);
  if (text === null) out.text(M.secretsFile.howToStart);
  return missingLocal ? 3 : 0;
}
