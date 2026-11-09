// Every string ft prints (DEV-SPEC.md §2.1). Each has a PRINTED OUTPUT marker.
// Wrangler's and npm's own output is passed through, prefixed, and isn't in here.

/** @param {string[]} xs */
const list = (xs) => xs.join(", ");
/** How a signal is named to the person: Ctrl+C is what they pressed. */
/** @param {string} sig */
const how = (sig) =>
  // PRINTED OUTPUT: ft / signal names
  sig === "SIGINT" ? "Ctrl+C" : sig === "SIGHUP" ? "SIGHUP (the terminal closed)" : sig;
/** @param {number} n @param {string} one @param {string} many */
const plural = (n, one, many) => (n === 1 ? one : many);

export const M = {
  usage: {
    /** @param {string} cmd @param {string | null} s */
    // PRINTED OUTPUT: ft / usage / unknown command
    unknownCommand: (cmd, s) => `Unknown command: ${cmd}.${s ? ` Did you mean ${s}?` : ""}`,
    /** @param {string} flag @param {string} cmd */
    // PRINTED OUTPUT: ft / usage / unknown flag
    unknownFlag: (flag, cmd) => `Unknown flag for ${cmd}: ${flag}`,
    /** @param {string} flag */
    // PRINTED OUTPUT: ft / usage / flag takes no value
    noValue: (flag) => `${flag} takes no value.`,
    /** @param {string} flag */
    // PRINTED OUTPUT: ft / usage / flag needs a value
    missingValue: (flag) => `${flag} needs a value.`,
    /** @param {string} flag @param {string} value */
    // PRINTED OUTPUT: ft / usage / not a Worker
    badWorker: (flag, value) => `${flag} takes site or accounts, not ${value || "nothing"}.`,
    /** @param {string} flag @param {string} value */
    // PRINTED OUTPUT: ft / usage / not a number
    badInt: (flag, value) => `${flag} takes a whole number, not ${value}.`,
    /** @param {string} arg @param {string} cmd */
    // PRINTED OUTPUT: ft / usage / extra argument
    extraArgs: (arg, cmd) => `${cmd} doesn't take ${arg}.`,
    /** @param {string} cmd */
    // PRINTED OUTPUT: ft / usage / missing argument
    missingArg: (cmd) => `${cmd} needs an argument: site or accounts.`,
    // PRINTED OUTPUT: ft / usage / --set with --generate
    setAndGenerate: "Use --set or --generate, not both.",
  },

  common: {
    // PRINTED OUTPUT: ft / common / dependencies missing
    needInstall: "node_modules doesn't match package-lock.json. Run ./ft install first.",
    /** @param {string} msg */
    // PRINTED OUTPUT: ft / common / internal error
    internal: (msg) => `ft: internal error (FT_INTERNAL): ${msg}`,
    // PRINTED OUTPUT: ft / common / no terminal to ask
    noTerminal: "This needs an answer, and there's no terminal to ask. Run it in a terminal, or add --yes.",
  },

  lifecycle: {
    /** @param {string} sig */
    // PRINTED OUTPUT: ft / stopped by a signal
    stopped: (sig) => `Stopped by ${how(sig)}.`,
    /** @param {string} sig */
    // PRINTED OUTPUT: ft / forced stop
    forced: (sig) => `${how(sig)} again, or still stopping: killed everything ft started that was still running.`,
    // PRINTED OUTPUT: ft / stopping children after an internal error
    stoppingChildren: "Stopping everything ft started.",
  },

  help: {
    // PRINTED OUTPUT: ft help / command list
    list: `ft: freetime's developer commands

  ./ft install            Install exact dependencies and set up the local database
  ./ft start              Run both Workers locally (Ctrl+C stops both)
  ./ft test               Run the tests and the typecheck
  ./ft status             Show what's local, what's deployed and what's missing
  ./ft deploy             Check everything, then deploy both Workers
  ./ft secrets            The local secrets file, and setting one secret
  ./ft logs <worker>      Live logs for site or accounts

  ./ft help <command>     More about one command
  Same as: npm run ft -- <command>
`,
    // PRINTED OUTPUT: ft help / help
    help: `./ft help [command]

  Prints the command list, or one command's help.

Flags: none.
Never: changes anything.
Exit: 0; 2 for an unknown command.
`,
    // PRINTED OUTPUT: ft help / install
    install: `./ft install

  Checks Node, runs npm ci if node_modules doesn't match package-lock.json,
  and applies the migrations to the local database. Then reports whether
  you're logged in to Cloudflare, and the state of .dev.vars and .secrets.

Flags: --verbose (show each command run).
Never: logs in, creates .dev.vars or .secrets, touches the remote database.
Exit: 0 done (warnings allowed); 1 failed; 130 Ctrl+C (143 SIGTERM, 129 SIGHUP).
`,
    // PRINTED OUTPUT: ft help / start
    start: `./ft start [--live] [--only site|accounts] [--no-router] [--port-offset N]

  Runs both Workers locally in one terminal, each line prefixed with its name:
    http://localhost:8780   both Workers, split by path as in production
    http://localhost:8787   the site (fixture feed)
    http://localhost:8788   the accounts Worker (emails printed here)
  Ctrl+C stops both. If one stops on its own, the other is stopped too.

Flags:
  --live              The site uses the real feed from .dev.vars.
  --only <worker>     Start just one Worker, with no router.
  --no-router         Both Workers, without the router on :8780.
  --port-offset <n>   Add n to every port (for a second checkout running at once).

Never: deploys, uses the remote database, or restarts a Worker that stopped.
Exit: 130 stopped with Ctrl+C (143 SIGTERM, 129 SIGHUP); 1 a port was busy or a
Worker stopped; 3 --live without .dev.vars.
`,
    // PRINTED OUTPUT: ft help / test
    test: `./ft test [--only site|accounts]

  Runs npm test (all Vitest projects), then npm run typecheck. Both always run.

Flags:
  --only <worker>     One Vitest project, and no typecheck (for speed).

Never: changes anything.
Exit: 0 both passed; 1 otherwise.
`,
    // PRINTED OUTPUT: ft help / status
    status: `./ft status [--offline]

  Read-only. Local: branch, commit, local database. Setup: the one-time steps.
  Cloudflare: what each Worker runs (compared with HEAD), secret names,
  pending migrations. Live: the smoke checks against the production site.

Flags:
  --offline           Only what needs no network.

Never: changes anything, prints a secret value.
Exit: 0 all good; 1 something needs attention; 3 a setup step is missing.
`,
    // PRINTED OUTPUT: ft help / deploy
    deploy: `./ft deploy [--only site|accounts] [--dry-run] [--yes] [--allow-branch]

  Checks everything (clean tree, branch, tests, typecheck, a build of each
  Worker, the database id, local secret values, login, pending migrations,
  DNS), shows the plan and asks once. Then: remote migrations, the accounts
  Worker, the site (each with its secrets from .secrets), and smoke checks
  against the live site. Ctrl+C during a write lets that write finish, then
  stops and lists each step as done or not; Ctrl+C again stops it at once.

Flags:
  --only <worker>     Deploy one Worker. All tests and smoke checks still run.
  --dry-run           Every check and the plan; nothing is written.
  --yes               Answer the one question. Never skips a check.
  --allow-branch      Deploy from a branch other than main.

Never: skips tests, rolls back, deletes anything, applies a migration that
removes or renames data, or prints a secret value.
Exit: 0 deployed; 1 a check failed (nothing changed); 3 a setup step is
missing; 4 production changed but not completely; 130 answered no or Ctrl+C
(143 SIGTERM, 129 SIGHUP).
`,
    // PRINTED OUTPUT: ft help / secrets
    secrets: `./ft secrets [--set NAME [--yes]] [--generate NAME]

  With no flags: each required secret, whether it's in .secrets and whether
  it's set on Cloudflare (names only).

Flags:
  --set NAME          Type a value (hidden) into .secrets; then, if you're
                      logged in, offer to put it on the live Worker now.
  --generate NAME     Write a new random value into .secrets (ACCOUNTS_KEY:
                      32 random bytes, base64url). Refuses if one exists.
  --yes               With --set: put it on the live Worker without asking.

Never: prints, logs or deletes a secret; replaces ACCOUNTS_KEY once set.
Exit: 0 done; 1 refused or failed; 3 a required value is missing locally.
`,
    // PRINTED OUTPUT: ft help / logs
    logs: `./ft logs <site|accounts> [--ref REF] [--errors]

  Live logs from one Worker (wrangler tail). Ctrl+C stops.

Flags:
  --ref REF           Only lines containing an error reference, e.g. 7K2Q9M.
  --errors            Only failed requests.

Never: changes anything.
Exit: 130 stopped with Ctrl+C (143 SIGTERM, 129 SIGHUP); 3 not logged in.
`,
  },

  node: {
    /** @param {string} v */
    // PRINTED OUTPUT: ft / node / ok
    ok: (v) => `Node ${v}`,
    /** @param {string} v */
    // PRINTED OUTPUT: ft / node / too old
    old: (v) => `Node ${v} is too old: ft needs Node 20 or later (https://nodejs.org).`,
  },

  deps: {
    // PRINTED OUTPUT: ft / deps / ok
    ok: "node_modules matches package-lock.json",
    /** @param {number} n */
    // PRINTED OUTPUT: ft / deps / installing
    installing: (n) => `${n} ${plural(n, "package differs", "packages differ")} from package-lock.json: running npm ci`,
    // PRINTED OUTPUT: ft / deps / failed
    failed: "npm ci failed, or node_modules still doesn't match package-lock.json (see above).",
  },

  localDb: {
    /** @param {string} db */
    // PRINTED OUTPUT: ft / local database / ok
    ok: (db) => `${db} (local): migrations applied`,
    /** @param {string} db */
    // PRINTED OUTPUT: ft / local database / failed
    failed: (db) => `Couldn't apply migrations to ${db} (local):`,
    /** @param {string} db */
    // PRINTED OUTPUT: ft / local database / unreadable
    unreadable: (db) => `Couldn't list the migrations of ${db} (local).`,
    /** @param {string} db @param {string[]} names */
    // PRINTED OUTPUT: ft / local database / pending
    pending: (db, names) => `${db} (local): not applied: ${list(names)}. ./ft start applies them.`,
    /** @param {string} db */
    // PRINTED OUTPUT: ft / local database / up to date
    upToDate: (db) => `${db} (local): up to date`,
  },

  login: {
    /** @param {string | null} email */
    // PRINTED OUTPUT: ft / login / ok
    ok: (email) => (email ? `Logged in to Cloudflare as ${email}` : "Logged in to Cloudflare"),
    // PRINTED OUTPUT: ft / login / not logged in
    out: "Not logged in to Cloudflare.",
    // PRINTED OUTPUT: ft / login / only needed to deploy
    onlyToDeploy: "Only needed for deploy, status, secrets and logs: npx wrangler login",
    // PRINTED OUTPUT: ft / login / unknown
    unknown: "Couldn't tell whether you're logged in to Cloudflare (no network?).",
    // PRINTED OUTPUT: ft / login / how to
    howTo: "Log in with: npx wrangler login",
  },

  devVars: {
    // PRINTED OUTPUT: ft / .dev.vars / absent
    absent: "No .dev.vars. Not needed for ./ft start.",
    // PRINTED OUTPUT: ft / .dev.vars / for --live
    forLive: "For ./ft start --live, copy .dev.vars.example to .dev.vars and put the calendar's secret iCal address in it.",
    // PRINTED OUTPUT: ft / .dev.vars / ok
    ok: ".dev.vars has ICAL_URL (for ./ft start --live)",
    // PRINTED OUTPUT: ft / .dev.vars / no key
    noKey: ".dev.vars has no ICAL_URL.",
    // PRINTED OUTPUT: ft / .dev.vars / placeholder
    placeholder: ".dev.vars still has the example's ICAL_URL.",
    // PRINTED OUTPUT: ft / .dev.vars / needed for --live
    neededForLive: "--live needs .dev.vars with ICAL_URL.",
  },

  secretsFile: {
    /** @param {string} file */
    // PRINTED OUTPUT: ft / .secrets / absent
    absent: (file) => `No ${file} (production secrets, only needed for ./ft deploy).`,
    // PRINTED OUTPUT: ft / .secrets / how to start
    howToStart: "Copy .secrets.example to .secrets and fill it in, or use ./ft secrets --set NAME.",
    /** @param {string[]} names */
    // PRINTED OUTPUT: ft / .secrets / some missing
    someMissing: (names) => `.secrets has no value for ${list(names)}.`,
    // PRINTED OUTPUT: ft / .secrets / needed for deploy
    forDeploy: "Needed for ./ft deploy: ./ft secrets --set NAME (or --generate ACCOUNTS_KEY).",
    // PRINTED OUTPUT: ft / .secrets / complete
    complete: ".secrets has every required value",
    /** @param {number} line @param {string} kind @param {string | undefined} name */
    // PRINTED OUTPUT: ft / .secrets / problem
    problem: (line, kind, name) =>
      kind === "section"
        ? `.secrets line ${line}: unknown section [${name}] (use [site] or [accounts]).`
        : kind === "outside"
          ? `.secrets line ${line}: ${name} is outside a [site] or [accounts] section.`
          : `.secrets line ${line}: not NAME=value.`,
    /** @param {string} worker @param {string} name */
    // PRINTED OUTPUT: ft / .secrets / missing
    missing: (worker, name) => `.secrets has no ${name} under [${worker}].`,
    /** @param {string} name */
    // PRINTED OUTPUT: ft / .secrets / set one
    setOne: (name) => (name === "ACCOUNTS_KEY" ? "Make one: ./ft secrets --generate ACCOUNTS_KEY" : `Set it: ./ft secrets --set ${name}`),
    /** @param {string[]} which */
    // PRINTED OUTPUT: ft / .secrets / all there
    allThere: (which) => `.secrets has every value for ${list(which)}`,
    // PRINTED OUTPUT: ft / .secrets / not ignored
    notIgnored: ".secrets isn't ignored by git. Add it to .gitignore before anything else.",
    /** @param {string} name */
    // PRINTED OUTPUT: ft / .secrets / never rotated
    keepForever: (name) => `${name} in .secrets differs from the one last deployed. ft never replaces it.`,
    // PRINTED OUTPUT: ft / .secrets / never rotated, more
    keepForeverMore: [
      "Changing it makes every stored calendar address unreadable.",
      "Put the deployed value back in .secrets. Rotating it needs a plan (and code) first.",
    ],
  },

  install: {
    // PRINTED OUTPUT: ft install / title
    title: "ft install",
    // PRINTED OUTPUT: ft install / ready
    ready: "Ready. Next: ./ft start",
  },

  test: {
    /** @param {string | undefined} only */
    // PRINTED OUTPUT: ft test / passed
    passed: (only) => (only ? `${only} tests passed` : "all tests passed"),
    /** @param {string | null} n */
    // PRINTED OUTPUT: ft test / passed with count
    passedCount: (n) => (n ? `${n} tests passed` : "all tests passed"),
    // PRINTED OUTPUT: ft test / failed
    failed: "npm test failed (see above).",
    // PRINTED OUTPUT: ft test / typecheck skipped
    typecheckSkipped: "Not run with --only.",
    // PRINTED OUTPUT: ft test / typecheck passed
    typecheckPassed: "npm run typecheck passed",
    // PRINTED OUTPUT: ft test / typecheck failed
    typecheckFailed: "npm run typecheck failed (see above).",
  },

  start: {
    /** @param {number} p */
    // PRINTED OUTPUT: ft start / port busy
    portBusy: (p) => `Port ${p} is in use.`,
    // PRINTED OUTPUT: ft start / port busy hint
    portBusyHint: "Is another ./ft start or npm run dev running? Stop it, or use --port-offset 10 for a second checkout.",
    /** @param {string[]} which */
    // PRINTED OUTPUT: ft start / stopped
    stopped: (which) => `Stopped ${which.join(" and ")}.`,
    /** @param {number} p */
    // PRINTED OUTPUT: ft start / port still busy
    stillBusy: (p) => `Port ${p} is still in use. Find what holds it: lsof -i :${p}`,
    /** @param {string} w @param {number} code @param {string[]} others */
    // PRINTED OUTPUT: ft start / child stopped
    crashed: (w, code, others) => `${w} stopped unexpectedly (exit ${code}).${others.length ? ` Stopping ${others.join(" and ")} too.` : ""}`,
    /** @param {string[]} which */
    // PRINTED OUTPUT: ft start / not ready
    notReady: (which) => `${which.join(" and ")} didn't answer within 60 seconds. Stopping.`,
    /** @param {string} w */
    // PRINTED OUTPUT: ft start / last lines of the Worker that stopped
    lastLines: (w) => `Last lines from ${w}:`,
    /** @param {string} w */
    // PRINTED OUTPUT: ft start / no output from the Worker that stopped
    noOutput: (w) => `${w} printed nothing.`,
    /** @param {string} sig */
    // PRINTED OUTPUT: ft start / stopping after a signal
    stopping: (sig) => `${how(sig)}: stopping. ${how(sig) === "Ctrl+C" ? "Ctrl+C again" : "A second signal"} kills everything now.`,
    /** @param {Record<string, number>} ports @param {boolean} router @param {string[]} which */
    // PRINTED OUTPUT: ft start / ready
    ready: (ports, router, which) =>
      [
        "",
        "  Ready.",
        ...(router ? [`    http://localhost:${ports.router}   both Workers, split by path as in production`] : []),
        ...(which.includes("site") ? [`    http://localhost:${ports.site}   the site only${router ? " (the account icon goes nowhere here)" : ""}`] : []),
        ...(which.includes("accounts") ? [`    http://localhost:${ports.accounts}   the accounts Worker only`] : []),
        `  Ctrl+C stops ${which.length > 1 ? "both" : which[0]}.`,
        "",
      ].join("\n"),
  },

  router: {
    /** @param {string} target @param {number} port */
    // PRINTED OUTPUT: ft router / Worker not answering (plain-text 502)
    down: (target, port) => `ft router: the ${target} Worker isn't answering on :${port}.\n`,
  },

  git: {
    // PRINTED OUTPUT: ft / git / unreadable
    unreadable: "Couldn't read the git state.",
    /** @param {number} n */
    // PRINTED OUTPUT: ft / git / dirty
    dirty: (n) => `${n} uncommitted ${plural(n, "change", "changes")} (untracked files count). Deploy only commits: commit or stash them first.`,
    // PRINTED OUTPUT: ft / git / clean
    clean: "Working tree clean",
    /** @param {string} branch */
    // PRINTED OUTPUT: ft / git / not main
    notMain: (branch) => `You're on ${branch}, not main. Add --allow-branch to deploy it anyway.`,
    /** @param {string} b @param {string} sha @param {string} subject */
    // PRINTED OUTPUT: ft / git / branch
    branch: (b, sha, subject) => `${b} at ${sha} ${subject}`,
    // PRINTED OUTPUT: ft / git / no upstream
    noUpstream: "This branch isn't on GitHub yet.",
    /** @param {number} n @param {string} up */
    // PRINTED OUTPUT: ft / git / ahead
    ahead: (n, up) => `${n} ${plural(n, "commit", "commits")} not on ${up} yet.`,
    // PRINTED OUTPUT: ft / git / no upstream (short)
    noUpstreamShort: "not on GitHub",
    /** @param {number} n @param {string} up */
    // PRINTED OUTPUT: ft / git / ahead (short)
    aheadShort: (n, up) => `${n} ahead of ${up}`,
    /** @param {string} up */
    // PRINTED OUTPUT: ft / git / same as upstream
    sameAs: (up) => `same as ${up}`,
  },

  database: {
    // PRINTED OUTPUT: ft / database id / set
    set: "wrangler.accounts.toml has a database_id",
    // PRINTED OUTPUT: ft / database id / missing
    missing: "wrangler.accounts.toml has no top-level database_id.",
    // PRINTED OUTPUT: ft / database id / placeholder
    placeholder: "wrangler.accounts.toml still has the placeholder database_id (all zeros).",
    // PRINTED OUTPUT: ft / database id / how to
    howTo: [
      "Create the database: npx wrangler d1 create freetime-accounts",
      "Then paste the database_id it prints into the top-level [[d1_databases]] of wrangler.accounts.toml.",
    ],
    // PRINTED OUTPUT: ft / database id / list failed
    listFailed: "Couldn't list your D1 databases.",
    /** @param {string} id */
    // PRINTED OUTPUT: ft / database id / not found
    notFound: (id) => `No D1 database has the id ${id}.`,
    /** @param {string} name */
    // PRINTED OUTPUT: ft / database id / other name
    otherName: (name) => `The database_id in wrangler.accounts.toml belongs to ${name}, not freetime-accounts.`,
    /** @param {string} id */
    // PRINTED OUTPUT: ft / database id / paste
    paste: (id) => `freetime-accounts exists: paste database_id = "${id}" into wrangler.accounts.toml.`,
  },

  resend: {
    /** @param {string} d */
    // PRINTED OUTPUT: ft / resend / from ok
    fromOk: (d) => `RESEND_FROM sends from ${d}`,
    // PRINTED OUTPUT: ft / resend / from bad
    fromBad: "RESEND_FROM in wrangler.accounts.toml isn't set, or isn't like: name <address@domain>.",
    /** @param {string} d */
    // PRINTED OUTPUT: ft / resend / dkim ok
    dkimOk: (d) => `${d} has Resend's DKIM record`,
    /** @param {string} d */
    // PRINTED OUTPUT: ft / resend / dkim missing
    dkimMissing: (d) => `No resend._domainkey.${d} record found. Has the domain been verified in Resend? (README, Deploy)`,
  },

  dns: {
    // PRINTED OUTPUT: ft / dns / no route
    noRoute: "wrangler.toml has no route to read the site's host from.",
    /** @param {string} h */
    // PRINTED OUTPUT: ft / dns / ok
    ok: (h) => `${h} resolves`,
    /** @param {string} h */
    // PRINTED OUTPUT: ft / dns / missing
    missing: (h) => `${h} doesn't resolve.`,
    // PRINTED OUTPUT: ft / dns / how to
    howTo: "Add the proxied DNS record for the site (README, Deploy, step 4).",
  },

  remoteDb: {
    // PRINTED OUTPUT: ft / remote database / unreadable
    unreadable: "Couldn't list the remote migrations of freetime-accounts.",
    /** @param {string[]} names */
    // PRINTED OUTPUT: ft / remote database / pending
    pending: (names) => `freetime-accounts (remote): to apply: ${list(names)}`,
    // PRINTED OUTPUT: ft / remote database / none pending
    none: "freetime-accounts (remote): up to date",
    /** @param {string} name */
    // PRINTED OUTPUT: ft / remote database / unsafe migration
    unsafe: (name) => `${name} removes or renames data. ft only applies migrations that add.`,
    // PRINTED OUTPUT: ft / remote database / unsafe how
    unsafeHow: "Read it, then apply it by hand: npx wrangler d1 migrations apply freetime-accounts --remote -c wrangler.accounts.toml",
  },

  plan: {
    /** @param {string} db @param {string[]} names */
    // PRINTED OUTPUT: ft deploy / plan / migrate
    migrate: (db, names) => `migrate   ${db} (remote): ${list(names)}`,
    /** @param {string} name @param {string[]} routes */
    // PRINTED OUTPUT: ft deploy / plan / deploy
    deploy: (name, routes) => `deploy    ${name.padEnd(19)}${list(routes)}`,
    /** @param {Record<string, string>} changes */
    // PRINTED OUTPUT: ft deploy / plan / secrets
    secrets: (changes) =>
      `  with    ${Object.entries(changes)
        .map(([n, c]) => `${n} (${c === "same" ? "unchanged" : c === "new" ? "first time through ft" : "changed"})`)
        .join(", ")}`,
    /** @param {string} base */
    // PRINTED OUTPUT: ft deploy / plan / check
    check: (base) => `check     ${base} (12 checks)`,
    /** @param {string[]} steps @param {string} branch @param {string} sha @param {string} subject */
    // PRINTED OUTPUT: ft deploy / plan
    block: (steps, branch, sha, subject) => {
      let n = 0;
      const lines = steps.map((s) => (s.startsWith("  ") ? `       ${s}` : `    ${++n}  ${s}`));
      return ["", "  Plan", ...lines, `  From ${branch} at ${sha} "${subject}"`, ""].join("\n");
    },
  },

  deploy: {
    // PRINTED OUTPUT: ft deploy / heading local
    localHeading: "Checks (local)",
    // PRINTED OUTPUT: ft deploy / heading remote
    remoteHeading: "Checks (Cloudflare, read-only)",
    // PRINTED OUTPUT: ft deploy / skipped after failures
    skippedAfterFailures: "Not run: fix the failures above first (tests, typecheck and build).",
    // PRINTED OUTPUT: ft deploy / skipped without login
    skippedNoLogin: "Not checked: not logged in.",
    /** @param {string} name */
    // PRINTED OUTPUT: ft deploy / built
    built: (name) => `${name} builds (wrangler deploy --dry-run)`,
    /** @param {string} name */
    // PRINTED OUTPUT: ft deploy / build failed
    buildFailed: (name) => `${name} doesn't build:`,
    // PRINTED OUTPUT: ft deploy / not deployed
    notDeployed: "Not deployed. Nothing was changed.",
    // PRINTED OUTPUT: ft deploy / dry run done
    dryRunDone: "Dry run: nothing was changed.",
    // PRINTED OUTPUT: ft deploy / confirm
    confirm: "  Deploy? [y/N] ",
    // PRINTED OUTPUT: ft deploy / declined
    declined: "Not deployed.",
    /** @param {string} what */
    // PRINTED OUTPUT: ft deploy / failed, nothing changed
    failedNothingChanged: (what) => `${what} failed (see above). Nothing in production was changed.`,
    /** @param {string} db */
    // PRINTED OUTPUT: ft deploy / heading migrating
    migratingHeading: (db) => `Migrating ${db} (remote)`,
    /** @param {string} name */
    // PRINTED OUTPUT: ft deploy / heading deploying
    deployingHeading: (name) => `Deploying ${name}`,
    // PRINTED OUTPUT: ft deploy / unknown version
    unknownVersion: "(version id not shown)",
    /** @param {string} base */
    // PRINTED OUTPUT: ft deploy / heading smoke
    smokeHeading: (base) => `Checking ${base}`,
    /** @param {string} sha @param {string} branch @param {[string, string][]} pairs */
    // PRINTED OUTPUT: ft deploy / success
    success: (sha, branch, pairs) => ["", `  Deployed ${sha} (${branch}):`, ...pairs.map(([n, v]) => `    ${n.padEnd(20)}version ${v}`), ""].join("\n"),
    /** @param {string} base */
    // PRINTED OUTPUT: ft deploy / manual check
    manualCheck: (base) =>
      [
        "  Now check by hand:",
        `    1. Open ${base}/account and create an account with your own address.`,
        "    2. Confirm it from the email, sign out, and use Forgot your password?",
        "    3. Sign in with the new password.",
        `    4. Open ${base}/ and check the calendar, and that the account icon opens /account.`,
        "",
      ].join("\n"),
  },

  interrupted: {
    /** @param {string} sig */
    // PRINTED OUTPUT: ft deploy / interrupted before any write
    beforeWrites: (sig) => `Stopped by ${how(sig)} before any write. Not deployed. Nothing was changed.`,
    /** @param {string} sig @param {string} step */
    // PRINTED OUTPUT: ft deploy / interrupted during a write: finishing it first
    finishing: (sig, step) =>
      `${how(sig)}: finishing ${step} first, then stopping (stopping it part-way would leave it unclear whether it went live). ${how(sig) === "Ctrl+C" ? "Ctrl+C again" : "A second signal"} stops it now.`,
    /** @param {string} sig @param {string | null} during @param {{ label: string, state: "done" | "not-started" | "unknown" | "failed", detail?: string }[]} steps */
    // PRINTED OUTPUT: ft deploy / DEPLOY INTERRUPTED block
    block: (sig, during, steps) => {
      const bar = "=".repeat(64);
      const word = { done: "done", "not-started": "not done", unknown: "UNKNOWN", failed: "FAILED" };
      return [
        "",
        bar,
        `  DEPLOY INTERRUPTED by ${how(sig)}${during ? `, during ${during}` : ""}.`,
        "",
        "  Steps:",
        ...steps.map((s) => `    ${word[s.state].padEnd(10)}${s.label}${s.detail ? `: ${s.detail}` : ""}`),
        "",
        "  Next (ft does none of this for you):",
        ...(steps.some((s) => s.state === "unknown") ? ["    See what each Worker runs now: ./ft status"] : []),
        ...(steps.some((s) => s.state === "done")
          ? ["    Finish it: ./ft deploy (migrations already applied are skipped)"]
          : ["    Nothing in production was changed. Deploy when ready: ./ft deploy"]),
        bar,
        "",
      ].join("\n");
    },
    /** @param {string} db */
    // PRINTED OUTPUT: ft deploy / interrupted step: migrations
    migrations: (db) => `remote migrations on ${db}`,
    // PRINTED OUTPUT: ft deploy / interrupted step: smoke checks
    smoke: "live checks",
    // PRINTED OUTPUT: ft deploy / interrupted step detail: applied
    applied: "applied (they stay)",
    /** @param {string} v */
    // PRINTED OUTPUT: ft deploy / interrupted step detail: new version
    newVersion: (v) => `new version ${v}`,
    // PRINTED OUTPUT: ft deploy / interrupted step detail: unchanged
    unchanged: "unchanged (the previous version)",
    // PRINTED OUTPUT: ft deploy / interrupted step detail: stopped part-way
    partWay: "stopped part-way: it may or may not have gone live",
    // PRINTED OUTPUT: ft deploy / interrupted step detail: smoke not finished
    smokeNotFinished: "not finished",
    // PRINTED OUTPUT: ft deploy / interrupted step detail: smoke not run
    notRun: "not run",
  },

  incomplete: {
    /** @param {string} what @param {string[]} which @param {Partial<Record<string, string>>} deployed @param {boolean} migrated @param {string[]} next */
    // PRINTED OUTPUT: ft deploy / DEPLOY INCOMPLETE block
    block: (what, which, deployed, migrated, next) => {
      const names = { site: "freetime", accounts: "freetime-accounts" };
      const bar = "=".repeat(64);
      return [
        "",
        bar,
        `  DEPLOY INCOMPLETE: ${what} failed.`,
        "",
        "  Live now:",
        ...(migrated ? ["    freetime-accounts database: migrations applied (they stay)"] : []),
        ...which.map((w) => `    ${names[/** @type {"site" | "accounts"} */ (w)].padEnd(20)}${deployed[w] ? `new version ${deployed[w]}` : "unchanged (the previous version)"}`),
        "",
        "  Next (ft does none of this for you):",
        ...next.map((l) => `    ${l}`),
        bar,
        "",
      ].join("\n");
    },
    // PRINTED OUTPUT: ft deploy / incomplete / migration
    migration: "The migration",
    // PRINTED OUTPUT: ft deploy / incomplete / check migrations
    checkMigrations: "See what was applied: npx wrangler d1 migrations list freetime-accounts --remote -c wrangler.accounts.toml",
    /** @param {string} name */
    // PRINTED OUTPUT: ft deploy / incomplete / deploy of
    deployOf: (name) => `The deploy of ${name}`,
    // PRINTED OUTPUT: ft deploy / incomplete / retry site
    retrySite: "Fix the problem, then: ./ft deploy --only site",
    // PRINTED OUTPUT: ft deploy / incomplete / fix and retry
    fixAndRetry: "Fix the problem, then run ./ft deploy again.",
    /** @param {{ name: string, configArgs: string[] }} w */
    // PRINTED OUTPUT: ft deploy / incomplete / rollback (printed, never run)
    rollback: (w) => `Or put ${w.name} back to its previous version: npx wrangler rollback${w.configArgs.length ? ` ${w.configArgs.join(" ")}` : ""}`,
    // PRINTED OUTPUT: ft deploy / incomplete / logs
    logs: "Look at the logs: ./ft logs site, ./ft logs accounts",
    // PRINTED OUTPUT: ft deploy / incomplete / smoke
    smoke: "A live check",
  },

  smoke: {
    // PRINTED OUTPUT: ft / smoke / custom domain hint
    customDomain: [
      "/account is answered by the main site, not the accounts Worker. If the site still has a",
      "custom domain, it takes precedence over routes: remove it (README, Deploy), then ./ft status.",
    ],
    /** @param {string} code @param {string} ref */
    // PRINTED OUTPUT: ft / smoke / debug line
    debug: (code, ref) => `The page says ${code} · ref ${ref}. See: ./ft logs site --ref ${ref}`,
    /** @param {number} n */
    // PRINTED OUTPUT: ft / smoke / all passed
    allPassed: (n) => `${n} of ${n} checks passed`,
    /** @param {number} f @param {number} n */
    // PRINTED OUTPUT: ft / smoke / some failed
    someFailed: (f, n) => `${f} of ${n} checks failed`,
    problem: {
      /** @param {number} got @param {number} want */
      // PRINTED OUTPUT: ft / smoke / problem: status
      status: (got, want) => `status ${got}, expected ${want}`,
      /** @param {string} got @param {string} want */
      // PRINTED OUTPUT: ft / smoke / problem: content type
      type: (got, want) => `content-type ${got || "none"}, expected ${want}`,
      // PRINTED OUTPUT: ft / smoke / problem: headers
      hsts: "no Strict-Transport-Security",
      // PRINTED OUTPUT: ft / smoke / problem: headers
      nosniff: "no X-Content-Type-Options: nosniff",
      // PRINTED OUTPUT: ft / smoke / problem: headers
      referrer: "no Referrer-Policy: strict-origin",
      // PRINTED OUTPUT: ft / smoke / problem: headers
      csp: "Content-Security-Policy without frame-ancestors 'none'",
      // PRINTED OUTPUT: ft / smoke / problem: headers
      cache: "no Cache-Control",
      // PRINTED OUTPUT: ft / smoke / problem: cookie
      cookie: "sets a cookie",
      /** @param {string} f */
      // PRINTED OUTPUT: ft / smoke / problem: filename
      filename: (f) => `not downloaded as ${f}`,
      /** @param {string} s */
      // PRINTED OUTPUT: ft / smoke / problem: body
      contains: (s) => `page doesn't contain ${s}`,
      /** @param {string} w */
      // PRINTED OUTPUT: ft / smoke / problem: wrong Worker
      wrongWorker: (w) => `answered by the ${w} Worker`,
      /** @param {string} name */
      // PRINTED OUTPUT: ft / smoke / problem: no answer
      noAnswer: (name) => `no answer (${name})`,
    },
  },

  status: {
    // PRINTED OUTPUT: ft status / heading local
    local: "Local",
    // PRINTED OUTPUT: ft status / heading setup
    setup: "Setup",
    /** @param {string | null} email */
    // PRINTED OUTPUT: ft status / heading cloudflare
    cloudflare: (email) => (email ? `Cloudflare (${email})` : "Cloudflare"),
    /** @param {string} base */
    // PRINTED OUTPUT: ft status / heading live
    live: (base) => `Live (${base})`,
    /** @param {string} b @param {boolean} clean @param {string} pushed */
    // PRINTED OUTPUT: ft status / branch
    branch: (b, clean, pushed) => `${b}, ${clean ? "clean" : "uncommitted changes"}, ${pushed}`,
    /** @param {string} name */
    // PRINTED OUTPUT: ft status / not deployed
    notDeployed: (name) => `${name}: no deployment found (or it couldn't be listed).`,
    // PRINTED OUTPUT: ft status / deployed without ft
    withoutFt: "deployed without ft",
    // PRINTED OUTPUT: ft status / same as HEAD
    sameAsHead: "same as HEAD",
    // PRINTED OUTPUT: ft status / not in history
    notInHistory: "not in this repository's history",
    /** @param {number} n */
    // PRINTED OUTPUT: ft status / behind
    behind: (n) => `${n} ${plural(n, "commit", "commits")} behind HEAD`,
    /** @param {string} name @param {string} when @param {string | null} sha @param {string} where */
    // PRINTED OUTPUT: ft status / deployed
    deployed: (name, when, sha, where) => `${name}: deployed ${when}${sha ? ` from ${sha}` : ""} (${where})`,
    /** @param {string} name */
    // PRINTED OUTPUT: ft status / secrets unknown
    secretsUnknown: (name) => `${name}: couldn't list its secrets (not deployed yet?).`,
    /** @param {string} name @param {string[]} missing */
    // PRINTED OUTPUT: ft status / secrets missing
    secretsMissing: (name, missing) => `${name}: not set on Cloudflare: ${list(missing)}. ./ft deploy sends them.`,
    /** @param {string} name @param {string[]} names */
    // PRINTED OUTPUT: ft status / secrets set
    secretsSet: (name, names) => `${name}: ${list(names)}`,
  },

  secrets: {
    /** @param {string} name @param {string[]} names */
    // PRINTED OUTPUT: ft secrets / cannot generate
    cannotGenerate: (name, names) => `ft can't generate ${name}. It can generate: ${list(names)}.`,
    /** @param {string} name */
    // PRINTED OUTPUT: ft secrets / already set
    alreadySet: (name) => `.secrets already has ${name}. ft never replaces it; edit the file by hand if you really mean to.`,
    /** @param {string} name @param {number} bytes @param {string} file */
    // PRINTED OUTPUT: ft secrets / generated
    generated: (name, bytes, file) => `Generated ${name} (${bytes} random bytes, base64url) into ${file}.`,
    // PRINTED OUTPUT: ft secrets / generated, more
    generatedMore: ["It goes up with the next ./ft deploy.", "Keep a copy somewhere safe: if it's lost, stored calendar addresses can't be read."],
    /** @param {string} name @param {string[]} names */
    // PRINTED OUTPUT: ft secrets / unknown secret
    unknown: (name, names) => `${name} isn't a secret ft knows. Known: ${list(names)}.`,
    /** @param {string} name */
    // PRINTED OUTPUT: ft secrets / hint per secret
    hint: (name) =>
      name === "ICAL_URL"
        ? "Paste the calendar's secret iCal address. Several calendars: all their addresses on one line, separated by spaces (at most 10). This replaces the whole value."
        : name === "RESEND_API_KEY"
          ? "Paste a Resend API key with sending access only."
          : `Paste the value of ${name}.`,
    /** @param {string} name */
    // PRINTED OUTPUT: ft secrets / prompt (input hidden)
    prompt: (name) => `${name} (hidden): `,
    // PRINTED OUTPUT: ft secrets / cancelled
    cancelled: "Cancelled. Nothing was changed.",
    /** @param {string} name */
    // PRINTED OUTPUT: ft secrets / empty
    empty: (name) => `${name} can't be empty. Nothing was changed.`,
    // PRINTED OUTPUT: ft secrets / one line
    oneLine: "A secret must be one line. Nothing was changed.",
    /** @param {string} name @param {string} file */
    // PRINTED OUTPUT: ft secrets / saved
    saved: (name, file) => `Saved ${name} in ${file}.`,
    /** @param {string} worker */
    // PRINTED OUTPUT: ft secrets / next deploy
    nextDeploy: (worker) => `It goes up to ${worker} with the next ./ft deploy.`,
    /** @param {string} name @param {string} worker */
    // PRINTED OUTPUT: ft secrets / put now?
    putNow: (name, worker) => `Also put ${name} on the live ${worker} now? [y/N] `,
    /** @param {string} name @param {string} worker */
    // PRINTED OUTPUT: ft secrets / put failed
    putFailed: (name, worker) => `Couldn't put ${name} on ${worker} (see above). It's saved in .secrets.`,
    /** @param {string} name @param {string} worker */
    // PRINTED OUTPUT: ft secrets / put
    put: (name, worker) => `${name} is set on ${worker}.`,
    /** @param {string} file */
    // PRINTED OUTPUT: ft secrets / list heading
    listHeading: (file) => `Secrets (${file} and Cloudflare; names only)`,
    /** @param {string} worker @param {boolean} here @param {boolean | null} there */
    // PRINTED OUTPUT: ft secrets / row
    row: (worker, here, there) => `${worker}: ${here ? "in .secrets" : "not in .secrets"}; ${there === null ? "Cloudflare not checked" : there ? "set on Cloudflare" : "not set on Cloudflare"}`,
    // PRINTED OUTPUT: ft secrets / remote unknown
    remoteUnknown: "Not logged in, so Cloudflare wasn't checked.",
  },

  logs: {
    /** @param {string} name */
    // PRINTED OUTPUT: ft logs / starting
    starting: (name) => `Live logs from ${name}. Ctrl+C stops.`,
  },
};
