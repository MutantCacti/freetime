# freetime.mutantcacti.com — developer script spec

One command, `./ft`, installs, runs, checks and deploys both Workers, so Maxence can work one level above raw `wrangler` and `npm` commands. It wraps the commands the README already lists; it adds checks and order, not new ways to change production.

This file is a spec only. Nothing here is built yet. Everything in `SPEC.md` §2 applies to the script where it makes sense (plain language, PRINTED OUTPUT, as few dependencies as possible, **(unverified)** on anything not checked against current documentation), unless this file says otherwise. The two-Worker rules in `ACCOUNTS-SPEC.md` §1 are unchanged: the script deploys the Workers one after the other, never as one.

| Phase | What |
|---|---|
| 0 | This spec |
| 1 | `./ft` itself: `help`, `install`, `test`; output, exit codes, the PRINTED OUTPUT module; tests for the script |
| 2 | `start`: both Workers in one terminal, prefixed output, clean Ctrl+C, and the local router on :8780 |
| 3 | `deploy`, `status`, `secrets`, `logs`; the README's Deploy section rewritten around them |

Each phase is its own pull request.

**Where it came from.** Maxence's Mite Spotter plan (`standrewsvcs/mitespotter-api`, `planning.md`, "Sprint 0: Backend"; §6 here) listed developer commands with one shared prefix (`minstall`, `mstart`, `mtest`, `mhelp`, …), and its scheduled jobs follow one rule, which this script follows too: **check integrity first, failures stop, nothing self-heals.**

---

## 1. Name and invocation

**The command is `ft`** (freetime), run from the repository root as:

```bash
./ft <command> [flags]
```

`npm run ft -- <command> [flags]` does exactly the same thing, for anyone who prefers npm.

- `./ft` is a 5-line POSIX `sh` file at the repository root. It finds its own directory, checks that `node` is on the `PATH` (if not: "ft needs Node 20 or later: https://nodejs.org", exit 1), and runs `exec node scripts/ft.mjs "$@"`.
- The work is done by `scripts/ft.mjs` and the modules in `scripts/ft/`: plain JavaScript (ES modules) using only Node's standard library (`node:child_process`, `node:http`, `node:fs`, `node:dns`, `fetch`). No new runtime or dev dependency is needed to run it.
- It works from any directory inside the repository: it resolves the root from its own path, not from the current directory.
- It needs only Node 20+ and npm, on macOS and Linux. Windows isn't a target (`./ft` is a shell file); `npm run ft -- …` probably works there, but isn't tested **(unverified)**.
- **Wrangler is always the repository's own copy** (`node_modules/.bin/wrangler`, version pinned in `package.json`), never `npx wrangler`, which can quietly download a different version if `node_modules` is missing. Without `node_modules`, every command but `help` and `install` stops with "Run ./ft install first."

### 1.1 Why `ft`

| Candidate | Problem |
|---|---|
| `deploy` | Maxence's first idea. But `./deploy start` and `./deploy install` read wrongly, and a bare `./deploy` (or `npm run deploy`, which people type by habit) sounds like it deploys. The rule "never deploy without an explicit command" is easiest to keep when the tool's name isn't the dangerous verb. `deploy` stays, as the subcommand. |
| `run` | `npm run run -- start` is confusing; `run` is a shell word in many people's heads, and it says nothing about the project. |
| `freetime` | Clear, but long to type dozens of times a day. |
| `dev` | Collides with the existing `npm run dev`, which means "the site with the fixture feed". |
| **`ft`** | Short, names the project, and isn't an npm script or a standard macOS or Linux command **(unverified that no common package installs an `ft` binary)**. Run as `./ft`, so even a global `ft` couldn't be picked up by mistake. |

Like Mite Spotter's `m` prefix, one short name groups every developer command; unlike it, they are subcommands of one program rather than seven separate binaries, so there's one `help`, one set of checks and one place for the output text. (npm has no equivalent of Python's `[project.scripts]` without `npm link` or a global install, which this deliberately avoids.)

### 1.2 The existing npm scripts

`dev`, `dev:live`, `dev:accounts`, `test` and `typecheck` stay as they are: they're the raw layer, and `ft` runs the same commands. `ft` is added as `"ft": "node scripts/ft.mjs"`. `deploy:accounts` is **removed in phase 3**: it deploys one Worker with no checks, which is what `./ft deploy` replaces. The README keeps the raw `wrangler` commands as a documented fallback, marked "not through ft: no checks".

---

## 2. Rules for every command

### 2.1 Output

- **Every string `ft` prints is PRINTED OUTPUT** (`SPEC.md` §2.1). All of them live in one module, `scripts/ft/messages.mjs`, each with its marker, for example `// PRINTED OUTPUT: ft deploy / dirty tree`. The README's search line becomes `grep -rn "PRINTED OUTPUT" src public scripts`.
- **Wrangler's and npm's own output is not ft's text.** When it's shown, each line is prefixed with the source (`site     | `, `accounts | `, `wrangler | `, `npm      | `), so it's always clear who said what. It carries no marker and ft doesn't rewrite it.
- **One line per check**, in this shape (a fixed-width status word, the check's name, then plain words):

```text
  ok    node          Node 22.22.0
  ok    deps          node_modules matches package-lock.json
  warn  login         Not logged in to Cloudflare. Only needed to deploy: npx wrangler login
  FAIL  database-id   wrangler.accounts.toml still has the placeholder database_id (all zeros).
                      Create the database and paste its id: see ./ft status, "Setup".
  skip  smoke         Not run: --dry-run.
```

  The check's name (`database-id`) is its code, like the site's error codes: short, stable, searchable, and listed in §9.
- Plain ASCII only, no emoji. Colour (green `ok`, yellow `warn`, red `FAIL`) only when the output is a terminal and `NO_COLOR` isn't set.
- **Expected failures never print a stack trace**, a file path inside `node_modules` or a URL with a secret in it. An unexpected error prints `ft: internal error (FT_INTERNAL)` and one line of message; `--verbose` adds the stack.
- `--verbose` on any command also prints each command ft runs, before it runs it (`$ wrangler d1 migrations list freetime-accounts --remote -c wrangler.accounts.toml`). These never contain secret values, because ft never passes secrets as arguments (§2.3).

### 2.2 Exit codes

| Code | Meaning |
|---|---|
| 0 | Done, everything passed. |
| 1 | A check or step failed. Nothing in production changed. |
| 2 | Usage: unknown command or flag, or a missing argument. The command's help is printed. |
| 3 | One-time setup is missing (§8). The message says which step and how to do it. |
| 4 | **Production changed, but not completely**: a migration ran or one Worker deployed, and a later step or a smoke check failed (§5.6). |
| 130 | Stopped with Ctrl+C, or a confirmation was answered "no". |

### 2.3 Secrets

- **ft never reads, prints, stores or passes a secret value.**
  - `wrangler secret put` runs with ft's terminal handed straight to it, so the value is typed into wrangler's own hidden prompt and ft never sees it.
  - `wrangler secret list` is read for the **names** only; anything else in its output is dropped before it's kept in memory.
  - `.dev.vars` is read for its **key names** only (and whether a value is still the example's placeholder, §3.1); values are never kept or printed.
- **Belt and braces:** before printing any captured line of wrangler output, ft replaces every value it can find in `.dev.vars` with `[NAME]` (as the Worker's logs replace `ICAL_URL` with `[ICAL_URL]`). A test plants a fake value and checks it never appears.
- No log file, no cache file, no state file. ft writes nothing itself; the only files that change are the ones the commands it runs change (`node_modules/`, `.wrangler/`).

### 2.4 What ft never does

These are never run, by any command, with any flag. Every `wrangler`, `npm` and `git` call goes through one module, `scripts/ft/run.mjs`, which only accepts the subcommands ft uses (an allow-list) and refuses everything else; a test checks that the allow-list has none of these, and that no other module starts a process:

- `wrangler delete`, `wrangler d1 delete`, `wrangler secret delete`, `wrangler r2 bucket delete`, `wrangler versions` / `deployments` writes, `wrangler rollback`;
- `wrangler d1 execute --remote` (arbitrary SQL against production), and `d1 time-travel restore`;
- `wrangler login` or `logout` (it says when to log in; Maxence runs it);
- `git commit`, `git push`, `git checkout`, `git stash`, `git reset`, or anything else that changes the repository;
- editing `wrangler.toml`, `wrangler.accounts.toml`, `package.json`, `.dev.vars` or any other file;
- `npm install <package>` or `npm update`;
- deploying without the `deploy` command, or deploying a Worker the command didn't name.

Rollback commands are **printed** when they're the right next step (§5.6), never run.

### 2.5 Confirmations

- `deploy` asks once before its first write: `Deploy? [y/N]`. Only `y` or `yes` continues; anything else (including Enter) stops with exit 130.
- `--yes` answers that question. It never skips a check.
- If standard input isn't a terminal and `--yes` wasn't given, a command that would ask stops instead: "This needs an answer, and there's no terminal to ask. Run it in a terminal, or add --yes." (exit 1). `secrets` always needs a terminal.

---

## 3. Commands

| Command | One line |
|---|---|
| `./ft help [command]` | The command list, or one command's help. |
| `./ft install` | Install exact dependencies, set up the local database, and say what else is missing. |
| `./ft start` | Run both Workers locally in one terminal; Ctrl+C stops both. |
| `./ft test` | Tests and typecheck: the same gate `deploy` uses. |
| `./ft status` | What's local, what's deployed, what's missing; read-only. |
| `./ft deploy` | The one flow that checks everything, migrates and deploys both Workers, then checks the live site. |
| `./ft secrets` | Set any missing secret for either Worker, through wrangler's own prompt. |
| `./ft logs <site\|accounts>` | Live logs (`wrangler tail`) for one Worker. |

Flags common to every command: `--help` (same as `./ft help <command>`), `--verbose` (§2.1). Flags are long-form only (`--dry-run`, not `-n`), so a typo is an error rather than a different flag.

### 3.1 `install`

**Does, in order:**

1. **Checks Node:** `node` is 20 or later (`process.versions.node`). Older: FAIL `node`, exit 1.
2. **Installs dependencies:** `npm ci`, always (it's idempotent and takes seconds; it's the only way to be sure `node_modules` matches `package-lock.json` exactly). Output prefixed `npm      | `. Failure: FAIL `deps`, exit 1.
3. **Sets up the local database** for `./ft start`: `wrangler d1 migrations apply freetime-accounts-dev --local -c wrangler.accounts.toml --env dev` (the same command as `npm run dev:accounts`). Running it again applies nothing new and is harmless.
4. **Reports, without doing:**
   - Cloudflare login (`login`): `wrangler whoami` **(unverified output wording; the parser is tested against captured output from wrangler 4.154.0)**. Not logged in is a `warn`, since only `deploy`, `status`, `secrets` and `logs` need it: "Not logged in to Cloudflare. Only needed to deploy: npx wrangler login".
   - `.dev.vars` (`dev-vars`):
     - missing: `ok` with "Not needed for ./ft start. For ./ft start --live, copy .dev.vars.example to .dev.vars and put the calendar's secret iCal address in it.";
     - present without an `ICAL_URL` key, or with the example's value (it contains `/.../`): `warn`;
     - present and filled in: `ok`. The value is never printed.
5. Ends with `Ready. Next: ./ft start` (or the list of warnings).

**Flags:** none besides the common ones.

**Exit:** 0 when steps 1–3 pass (warnings don't fail it), 1 otherwise.

**Never:** runs `wrangler login`, creates `.dev.vars`, touches the remote database.

### 3.2 `start`

Runs both Workers locally, together, in one terminal.

**Checks first:** Node, `node_modules` matches the pinned wrangler (`deps`), and the ports 8787, 8788 and 8780 (and inspector ports 9229, 9230) are free (`ports`). A busy port stops it: "Port 8787 is in use. Is another ./ft start or npm run dev running?" (exit 1). ft never picks a different port, because then the addresses printed and remembered would be wrong.

**Does:**

1. Applies local migrations (as in `install`, step 3), so a new migration pulled from git just works.
2. Starts, as child processes:

| Prefix | Command | Address |
|---|---|---|
| `site` | `wrangler dev --env dev --port 8787 --inspector-port 9229` (fixture feed, as `npm run dev`) | http://localhost:8787 |
| `accounts` | `wrangler dev -c wrangler.accounts.toml --env dev --port 8788 --inspector-port 9230` (as `npm run dev:accounts`; emails printed in the terminal) | http://localhost:8788 |
| `router` | ft's local router (§3.2.1) | http://localhost:8780 |

   Two `wrangler dev` processes both want inspector port 9229 by default, so ft gives each its own **(unverified whether wrangler 4 falls back on its own)**. Wrangler's interactive keys (`[b]` open a browser, `[x]` exit) are turned off, since ft owns the keyboard **(unverified flag: `--show-interactive-dev-session=false`)**.
3. **Prefixes every line** of each child's stdout and stderr with its name, padded so the bars line up, splitting on new lines so lines never interleave mid-line:

```text
site     | Ready on http://localhost:8787
accounts | Ready on http://localhost:8788
accounts | --- email to you@example.com: Confirm your email address
```

4. Waits until each address answers an HTTP request (up to 60 s each), then prints:

```text
  Ready.
    http://localhost:8780   both Workers, split by path as in production
    http://localhost:8787   the site only (the account icon goes nowhere here)
    http://localhost:8788   the accounts Worker only
  Ctrl+C stops both.
```

5. **Ctrl+C:** ft sends SIGINT to both Workers, waits up to 5 s, then SIGTERM, then after 5 more seconds SIGKILL; closes the router; prints `Stopped site and accounts.`; exits 130. It then checks the ports are free again, and if one isn't, says so with the command to find the process (`lsof -i :8787`), since a leftover `workerd` would make the next start fail.
6. **If one child stops on its own** (a crash, not a code error; wrangler keeps running through those and reloads), ft stops the other one too and exits 1: "accounts stopped unexpectedly (exit 1). Stopped site too." **It never restarts anything.** Restarting hides the reason.

**Flags:**

| Flag | Effect |
|---|---|
| `--live` | The site uses the real feed (`wrangler dev`, the default environment, as `npm run dev:live`). Needs `.dev.vars` with `ICAL_URL` (checked, exit 3 if missing, with the copy instruction). |
| `--only site\|accounts` | Starts just one Worker. No router. |
| `--no-router` | Both Workers, without the router on :8780. |

**Never:** deploys, uses the remote database (`--remote`), or reads secrets from Cloudflare. `.dev.vars` is read by wrangler, not ft.

**Note:** both configs live in the repository root, so wrangler loads the same `.dev.vars` for both Workers **(unverified for wrangler 4; `.dev.vars.<env>` files may change this)**. The accounts Worker doesn't need anything from it locally (emails are printed, not sent), and nothing in it is a production value except `ICAL_URL`.

#### 3.2.1 The local router (:8780): in scope, phase 2

**The problem:** in production both Workers answer on one host, split by path. Locally they're on two ports, so the account icon on :8787 links to `/account` on :8787, which the site answers with its 404 page (README, "The accounts Worker").

**The fix:** a small HTTP proxy in ft (about 60 lines of `node:http`), on its own port, that sends each request to the Worker production would send it to:

- The accounts paths are read from the route patterns in `wrangler.accounts.toml` (`/account*`, `/u/*`, `/spaces*`, `/s/*`, `/auth/*`), never typed into the script, so a new route works locally without a change to ft. A trailing `*` matches any suffix, as Cloudflare's route patterns do (so `/account*` matches `/account`, `/account/sign-in` and `/accounts`) **(unverified exact route-matching semantics; the table test in §10 records what ft assumes)**.
- Everything else goes to the site (:8787).
- It streams the method, headers and body through unchanged, **including `Host`**, so both Workers see `localhost:8780` as their own origin. That matters: the accounts Worker rejects any POST whose `Origin` isn't its own (`AUTH_ORIGIN`), and builds email links from its own origin.
- It adds no headers, strips none, and keeps no cookies or state. It's local only and listens on `127.0.0.1`, never `0.0.0.0`.

**Why a new port, not :8787:** `npm run dev` and :8787 keep meaning "the site, as it was". Nothing changes for anyone who doesn't use ft, and the extra address is printed every time.

**Phase 2 must confirm** (and record in the README): signing up, the printed confirmation link and signing in all work through :8780, which proves `wrangler dev` keeps the incoming `Host` in `request.url` **(unverified)**. The `__Host-session` cookie needs a secure context; browsers treat `http://localhost` as one, and this already works on :8788 **(unverified for Safari)**. If the `Host` check fails and no wrangler setting fixes it, the router is dropped from phase 2 and the README's sentence stays; the accounts Worker's code is not changed for local development.

**Alternative considered:** `wrangler dev -c wrangler.toml -c wrangler.accounts.toml`, which runs several Workers in one process. It only serves the first config over HTTP and reaches the others through service bindings, not by path **(unverified)**, so it doesn't reproduce production's routing.

### 3.3 `test`

**Does:** `npm test`, then `npm run typecheck`, with their output passed straight through (Vitest's output is already clear). Both always run, even if the first fails, so one run shows everything. Ends with:

```text
  ok    tests        site and accounts
  FAIL  typecheck    npm run typecheck failed (see above)
```

**Flags:** `--only site|accounts` runs one Vitest project (`vitest run --project site`) and skips typecheck, for speed while working. `deploy` never uses it.

**Exit:** 0 if both pass, 1 otherwise.

### 3.4 `status`

Read-only. Answers "what's live, what's here, and what's missing?". Everything it runs only reads.

```text
Local
  ok    branch        main, clean, same as origin/main
  ok    commit        5795eac Accounts phase 1: the accounts Worker, ...
  ok    local-db      freetime-accounts-dev: 1 of 1 migrations applied

Cloudflare (you@example.com)
  ok    site          freetime: deployed 2026-11-08 14:03Z from 5795eac (same as HEAD)
  warn  accounts      freetime-accounts: deployed 2026-11-07 18:20Z from de35ebb (2 commits behind HEAD)
  ok    secrets       site: ICAL_URL · accounts: RESEND_API_KEY
  warn  remote-db     freetime-accounts: 1 migration not applied: 0002_profiles.sql

Setup
  ok    database-id   wrangler.accounts.toml points at freetime-accounts
  ok    dns           freetime.mutantcacti.com resolves
  warn  resend-dns    No DKIM record found for the sending domain (see §8)

Live (https://freetime.mutantcacti.com)
  ok    smoke         12 of 12 checks passed
```

- **Deployed vs local:** `deploy` passes the commit and branch to wrangler as the deployment message (`wrangler deploy --message "5795eac main"` **(unverified flag)**). `status` reads the latest deployment of each Worker (`wrangler deployments list`, **(unverified JSON output flag)**), takes the commit from the message, and compares it with `HEAD`: "same as HEAD", "n commits behind HEAD", "not in this repository's history" or "deployed without ft" (no commit in the message).
- **Secrets:** names only, as in §2.3. Missing ones are `FAIL` with "Run ./ft secrets".
- **Setup:** the checks in §8.
- **Live:** the smoke checks in §5.5, unless `--offline`.

**Flags:** `--offline` (only the Local and Setup checks that need no network; no login needed).

**Exit:** 0 when nothing is `warn` or `FAIL`; 1 when something is; 3 when a setup step is missing.

### 3.5 `secrets`

Guided `wrangler secret put` for both Workers. It earns its place because `deploy` stops on a missing secret, and the fix should be one command, not "remember the `-c` flag".

**Does:**

1. Needs a terminal and a Cloudflare login.
2. Lists each Worker's required secrets (§3.5.1) and which are set (`wrangler secret list`, names only).
3. For each **missing** one, prints what it is and asks `Set RESEND_API_KEY for freetime-accounts now? [y/N]`. On yes, it runs `wrangler secret put RESEND_API_KEY -c wrangler.accounts.toml` with the terminal handed over, so Maxence types the value into wrangler's hidden prompt.
4. Before each prompt, it prints the README's hint for that secret, for example for `ICAL_URL`: "Paste the calendar's secret iCal address. Several calendars: all their addresses on one line, separated by spaces (at most 10). This replaces the whole secret." and for `RESEND_API_KEY`: "A Resend API key with sending access only."
5. Ends by listing the names again.

**Flags:**

| Flag | Effect |
|---|---|
| `--set NAME` | Replace one secret even though it exists (for example a new calendar list in `ICAL_URL`). The Worker is found from the name. |

**Never:** deletes a secret, reads one, uses `secret bulk` (which would read values from a file), or copies anything from `.dev.vars` to Cloudflare.

**If the Worker doesn't exist yet:** `wrangler secret put` offers to create it **(unverified, as in the README)**. ft says so before the prompt; answering yes there is Maxence's choice, in wrangler's prompt.

#### 3.5.1 The required list

`scripts/ft/workers.mjs` holds both Workers' facts in one place: config file, Worker name, required secrets, required vars, smoke paths. Phase 1 secrets: site `ICAL_URL`; accounts `RESEND_API_KEY`; var `RESEND_FROM`. A test reads `Env` (`src/app.tsx`) and `AccountsEnv` (`src/accounts/app.tsx`) and fails if a string field there isn't either a secret or a var in this list, so phase 2's `ACCOUNTS_KEY` can't be forgotten.

### 3.6 `logs`

```bash
./ft logs site
```

```bash
./ft logs accounts --ref 7K2Q9M
```

**Does:** `wrangler tail --format pretty` for the site, or with `-c wrangler.accounts.toml` for accounts. Output passed straight through. Ctrl+C stops it (exit 130).

**Flags:** `--ref REF` passes `--search REF`, to find one error reference from a page's debug line; `--errors` passes `--status error` **(unverified flag names, wrangler 4)**.

It earns its place because the README's verify step and every error page point to a reference in the logs, and the accounts Worker's `-c` flag is easy to forget. It needs a login; without one, exit 3 with the login line.

### 3.7 `help`

`./ft`, `./ft help` and `./ft --help` print the list and exit 0. `./ft help deploy` and `./ft deploy --help` print one command's help and exit 0. An unknown command prints "Unknown command: dpeloy. Did you mean deploy?" (closest by edit distance, only if close) and the list, exit 2.

```text
ft: freetime's developer commands

  ./ft install            Install exact dependencies and set up the local database
  ./ft start              Run both Workers locally (Ctrl+C stops both)
  ./ft test               Run the tests and the typecheck
  ./ft status             Show what's local, what's deployed and what's missing
  ./ft deploy             Check everything, then deploy both Workers
  ./ft secrets            Set missing secrets, through wrangler's own prompt
  ./ft logs <worker>      Live logs for site or accounts

  ./ft help <command>     More about one command
  Same as: npm run ft -- <command>
```

Per-command help has the same four parts for every command: what it does (one or two lines), its flags, what it never does, and its exit codes. A spec-sync test (§10) keeps the help, §2.2 and §3 of this file in step.

---

## 4. Shared checks

Each check has a name (its code). Commands run the ones marked.

| Check | How | install | start | test | status | deploy |
|---|---|---|---|---|---|---|
| `node` | `process.versions.node` ≥ 20 | ● | ● | ● | ● | ● |
| `deps` | `node_modules/wrangler/package.json` version equals `package.json`'s pin (and `npm ci` has run) | after | ● | ● | ● | ● |
| `ports` | 8787, 8788, 8780, 9229, 9230 free | | ● | | | |
| `dev-vars` | key names in `.dev.vars` (§3.1) | ● | `--live` | | | |
| `tree` | `git status --porcelain` is empty (untracked files count) | | | | ● | ● |
| `branch` | current branch; whether it matches its upstream | | | | ● | ● |
| `tests`, `typecheck` | as `./ft test` | | | ● | | ● |
| `database-id` | the **top-level** `database_id` in `wrangler.accounts.toml` isn't all zeros, and `wrangler d1 list` has a database with that id named `freetime-accounts` (the `env.dev` one stays zeros: it's local only) | | | | ● | ● |
| `resend-from` | `RESEND_FROM` in `wrangler.accounts.toml` is set and looks like `name <address@domain>` | | | | ● | ● |
| `build` | `wrangler deploy --dry-run` for each Worker (bundles and validates the config; uploads nothing) | | | | | ● |
| `login` | `wrangler whoami` | warn | | | ● | ● |
| `secrets` | `wrangler secret list` names (§2.3) | | | | ● | ● |
| `remote-db` | `wrangler d1 migrations list freetime-accounts --remote -c wrangler.accounts.toml` | | | | ● | ● |
| `dns` | the site's host resolves (`node:dns`) | | | | ● | ● |
| `smoke` | §5.5 | | | | ● | after |

**The site's host is read from the route in `wrangler.toml`**, never written in the script: the name lock (`test/name.test.ts`) says the name lives only in `src/config.ts` and that route. Phase 1 extends that test's code glob to `scripts/**/*.mjs`.

`wrangler.toml` and `wrangler.accounts.toml` are read with narrow, tested readers (one value each: a route pattern, `database_id`, `RESEND_FROM`), not a TOML library. The tests run them on the real files, so a format change fails a test rather than a deploy.

---

## 5. `deploy`

**One flow that deploys both Workers.** It's the only ft command that changes production, and it does nothing to production until every check has passed and Maxence has said yes.

### 5.1 Flags

| Flag | Effect |
|---|---|
| `--only site\|accounts` | Deploy one Worker. Its own checks and steps only (`--only site` skips D1, Resend and migrations). Tests, typecheck and **all** smoke checks still run. |
| `--dry-run` | Every check, local and remote, and the plan; then stop with exit 0. Nothing is written: no migration, no deploy, no secret. |
| `--yes` | Answers the one confirmation. Never skips a check. Needed when there's no terminal. |
| `--allow-branch` | Deploy from a branch other than `main` (§5.2). |

**`--skip-tests` doesn't exist.** The only reasons to skip are speed (the suite takes well under a minute) or a failing test, and deploying with a failing test is what the gate is for. If Maxence ever must, the raw wrangler commands are in the README, marked "not through ft: no checks". `--force` doesn't exist either.

### 5.2 Pre-flight

All of these run before anything is written, in this order (cheap and local first), and **any FAIL stops the deploy** with exit 1 (or 3 for a setup step). Every failure is printed, not just the first, as long as the next checks can still run.

**Local (no network):**

1. `node`, `deps`.
2. `tree`: clean. Otherwise: "There are uncommitted changes. Deploy only commits: commit or stash them first." Untracked files count, since a new file under `src/` could be bundled.
3. `branch`: on `main`, or `--allow-branch`. Otherwise: "You're on claude/dev-script-spec, not main. Add --allow-branch to deploy it anyway." If the branch is ahead of its upstream (or has none), a `warn`: "This commit isn't on GitHub yet." It warns rather than stops, because Maxence deploys from their own machine and may push after.
4. `database-id` (local half: not zeros), `resend-from`.
5. `tests`, `typecheck` (as `./ft test`, both projects).
6. `build`: `wrangler deploy --dry-run` for each Worker being deployed.
7. **Migration safety:** each pending migration file (from step 9 below) is read; if one contains `DROP TABLE`, `DROP COLUMN`, `DELETE FROM`, `ALTER TABLE … RENAME` or `DROP INDEX`, ft stops: "0003_x.sql removes or renames data. ft only applies migrations that add. Read it, then apply it by hand: (command)." Exit 1. Migrations run while the old accounts code is still live (§5.3), so they must add, never take away.

**Cloudflare (read-only):**

8. `login`. Not logged in: exit 3 with "npx wrangler login".
9. `remote-db`: lists pending migrations (for the plan and step 7). Also confirms the database id exists (`database-id`, remote half).
10. `secrets` for each Worker being deployed. A missing secret: exit 3, "Run ./ft secrets". If a Worker doesn't exist yet (first deploy), its secrets can't be listed: the message says so and points to `./ft secrets`, which handles creating it (§3.5).
11. `dns`: the host resolves. Otherwise exit 3, pointing to §8.

### 5.3 The plan and the order

Then ft prints the plan and asks once:

```text
  Plan
    1  migrate   freetime-accounts (remote): 0002_profiles.sql
    2  deploy    freetime-accounts   /account*, /u/*, /spaces*, /s/*, /auth/*
    3  deploy    freetime            freetime.mutantcacti.com/*
    4  check     https://freetime.mutantcacti.com (12 checks)
  From main at 5795eac "Accounts phase 1: the accounts Worker, ..."
  Deploy? [y/N]
```

With `--dry-run`, it prints the plan and `Dry run: nothing was changed.`, exit 0.

**Order: migrations, then accounts, then the site, then the checks.**

| Option | Chosen? | Why |
|---|---|---|
| Migrations before the accounts code | **yes** | New code expects the new schema; the old code still running for a few seconds must cope with it, which is why migrations only add (§5.2, step 7). |
| Accounts before the site | **yes** | The site is what visitors use, so it's touched **last, and only if everything before it worked**. If accounts fails, the site is exactly as it was. The accounts Worker's only dependency on the new site is its stylesheets (`/css/*` belong to the main Worker), so for a few seconds an account page could look slightly off. |
| Site before accounts | no | If accounts then failed, every visitor would see an account icon leading to a 404 until it was fixed. |
| Both at once (in parallel) | no | Two failures at once are harder to read, and "stop at the first failure" stops meaning anything. |

Between steps there's no pause: each starts when the previous one has succeeded.

### 5.4 The writes

1. `wrangler d1 migrations apply freetime-accounts --remote -c wrangler.accounts.toml`, with the terminal handed over in case wrangler asks its own question **(unverified whether wrangler 4 asks for remote applies)**. Output prefixed `wrangler | `.
2. `wrangler deploy -c wrangler.accounts.toml --message "<sha> <branch>"`.
3. `wrangler deploy --message "<sha> <branch>"`.

After each, ft keeps the version id wrangler prints **(unverified wording: "Current Version ID")**, for the summary and the rollback lines.

ft never retries a failed write. The first failure stops the flow (§5.6).

### 5.5 Smoke checks

Read-only requests from Node's `fetch` to the live host (`redirect: "manual"`). Each check is retried every 2 s for up to 30 s, because a new version and new routes take a few seconds to reach every data centre **(unverified timing)**; after that it's a FAIL. They run after every deploy, whichever Workers were deployed, because a wrong route on one Worker can break the other's paths.

| # | Request | Expect |
|---|---|---|
| 1 | `GET /` | 200, `text/html`; HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin`, a CSP containing `frame-ancestors 'none'`, a `Cache-Control`; **no** `Set-Cookie`; the account link (`href="/account"`) |
| 2 | `HEAD /` | 200 |
| 3 | `POST /` | 405 (the site is read-only) |
| 4 | `GET /free-busy.ics` | 200, `text/calendar`, filename `mutantcacti-busy.ics` |
| 5 | `GET /css/app.css` | 200, `text/css` (the main Worker serves the shared stylesheets) |
| 6 | `GET /css/calendar.css` | 200, `text/css` (generated) |
| 7 | `GET /help` | 200 |
| 8 | `GET /account` | 200, `text/html`, the same security headers; the signed-out page (a link to `/account/sign-in`); **answered by the accounts Worker** (below) |
| 9 | `GET /account/sign-in` | 200 |
| 10 | `GET /account/sign-up` | 200 |
| 11 | `GET /account/ft-missing` | 404, the accounts Worker's 404 page (its home link is `/account`), not the site's |
| 12 | `GET /u/ft-missing` | 404 from the accounts Worker |

**Telling the Workers apart** needs no code change: the accounts Worker's pages and its 404 link home to `/account`; the site's 404 doesn't. If check 8 or 11 gets the site's 404, ft prints: "/account is answered by the main site, not the accounts Worker. If the site still has a custom domain, it takes precedence over routes: remove it (README, Deploy, step 4), then run ./ft status." **(unverified that a custom domain takes precedence over a zone route)**

**When `/` answers 503**, the page has a debug line (`FEED_STATUS_404 · ref 7K2Q9M · …`). ft prints that code and reference, never the page, and suggests `./ft logs site --ref 7K2Q9M`. The likely cause is `ICAL_URL`, and `./ft secrets --set ICAL_URL` replaces it.

No smoke check signs up, signs in or sends email. ft ends a full deploy by printing the README's manual check (create an account with your own address, confirm it from the email, sign out, reset the password, sign in, and check the calendar and its account icon).

### 5.6 When something fails part-way

**No automatic rollback.** A rollback chosen by a script, on a guess, is a second change to production that nobody looked at. ft stops at the first failure, says exactly what is live now, and prints the next steps. Maxence decides.

| What failed | What's live | ft prints | Exit |
|---|---|---|---|
| A check, before the plan | Nothing changed | the failing checks | 1 or 3 |
| Answered "no" | Nothing changed | `Not deployed.` | 130 |
| Migration | Some migrations may have run **(unverified whether D1 applies each file atomically)**; both Workers unchanged | which migrations are now applied (`migrations list`), and that the old code is still live | 4 |
| Accounts deploy | Migrations applied; both Workers unchanged | the wrangler error; "The site was not touched." | 4 |
| Site deploy | New accounts Worker, **old site** | "freetime-accounts is live at version X; freetime is still the previous version." Then: fix and run `./ft deploy --only site`, **or** go back with `npx wrangler rollback -c wrangler.accounts.toml` (printed, not run) | 4 |
| Smoke checks | Both new | the failing checks; `./ft logs <worker>`; the rollback line for each Worker deployed (printed, not run) | 4 |

Every exit 4 is loud: a block that starts and ends with a line of `=` and the words `DEPLOY INCOMPLETE`, listing each Worker's live version, so it can't scroll past unnoticed. Migrations are never rolled back by ft or by `wrangler rollback`; D1's Time Travel is the way back for data, done by hand from the dashboard or CLI **(unverified)**.

### 5.7 Success

```text
  ok    smoke         12 of 12 checks passed

  Deployed 5795eac (main):
    freetime-accounts   version 1a2b3c4d
    freetime            version 5e6f7a8b

  Now check by hand: create an account with your own address, ...
```

Exit 0.

---

## 6. What carries over from Mite Spotter, and what doesn't

Read: `planning.md` on `main` (§ "Sprint 0: Backend", the developer tools and Scheduled Jobs) and on `sprint/0-backend` (the updated plan, which adds Accounts & Authentication, Deployment on Cloudflare, Migrations and Testing & CI), plus that branch's `README.md`, `.env.example`, `deploy/wrangler.toml`, `tests/test_spec.py` and `.github/workflows/test.yml`. There are no `m-` script files on either branch: the commands exist only as a list in the plan.

| Mite Spotter | freetime `ft` |
|---|---|
| `minstall`, `mstart`, `mtest`, `mhelp`, …: one prefix, short verbs | Same verbs, as subcommands of `./ft` (§1.1). |
| The sprint 0 branch trims the list to what exists: "the rest are added when needed, not promised" | Each command here says why it earns its place; `madduser`, `mclean` and `mhttps` don't (§7). |
| Nightly job: check integrity before a snapshot; "if any of these fail, assume there is a bug and manual intervention is required" | Pre-flight before any write; any FAIL stops; no retries, no automatic rollback, no restarts in `start`. |
| Backups verified by restoring them into a sandbox | `wrangler deploy --dry-run` builds both Workers before the real deploy. |
| Digest and heartbeat at the end of every job | The deploy summary and smoke checks, and `./ft status` any time. (A scheduled heartbeat is `W2M-SPEC.md` phase 3, not this script.) |
| `.env.example` with a `REPLACE_URL` placeholder, filled in by hand | `.dev.vars.example` and the zeros `database_id`: ft detects placeholders and says what to do, never fills them in. |
| Secrets only in the environment, never committed; `deploy/wrangler.toml` comments list the one-time `wrangler` commands | Secrets only through wrangler's prompt (§2.3); one-time steps guided, not done (§8). |
| Spec-sync tests (`tests/test_spec.py`) check code constants against `planning.md` | A spec-sync test checks `ft help`, the exit codes and the command list against this file (§10). |
| `uv`, Python, Postgres, Alembic, systemd, a VPS, `cloudflared` | Not relevant: freetime is two Workers, D1 and wrangler. |
| CI runs the suite with coverage per file | Not carried: freetime has no CI and deploys from Maxence's machine, so `deploy` runs the suite itself. |

---

## 7. Commands left out, and why

| Command | Why not |
|---|---|
| `check` | It would be `test` plus half of `status`. Two names for overlapping things is worse than none. |
| `clean` / reset the local database | Deleting `.wrangler/state` throws away local accounts. Rarely needed, and easy by hand (README gets the one line). ft never deletes. |
| `adduser` (Mite Spotter's `madduser`) | Sign-up works locally with emails printed in the terminal, so there's nothing to add by hand. |
| `https` (Mite Spotter's `mhttps`) | `http://localhost` is already a secure context for cookies. |
| `migrate` / `db new` | Migrations are applied by `install`, `start` and `deploy`. Creating one is a rare `wrangler d1 migrations create`; the README has it. |
| `rollback` | Choosing a version to go back to is a decision, not a routine. ft prints the command when it's the next step (§5.6). |
| `login` | One wrangler command, run once; ft says when it's needed. |

---

## 8. One-time setup: guided, never done silently

These change accounts, DNS or third-party services, so ft never does them. It detects each missing step, stops (exit 3) when a command needs it, and prints the exact step. `./ft status` lists them all under "Setup".

| Step | How ft notices it's missing | What it prints |
|---|---|---|
| Cloudflare login | `wrangler whoami` | "npx wrangler login" |
| Zone on Cloudflare and the `freetime` DNS record (`AAAA freetime 100::`, proxied) | The host doesn't resolve (`dns`). A proxied record and a custom domain both resolve to Cloudflare, so DNS alone can't tell them apart | README, Deploy, steps 1–4 |
| The site's custom domain removed (the one-time switch to a zone route) | Only after a deploy: `/account` answered by the site (§5.5) | The custom domain line in §5.5 |
| D1 database created and its id pasted | Top-level `database_id` is all zeros. If `wrangler d1 list` already has `freetime-accounts`, ft prints its id and the exact line to paste into `wrangler.accounts.toml`; it doesn't edit the file | "npx wrangler d1 create freetime-accounts", then the line |
| Id points at the wrong database | The id isn't in `wrangler d1 list`, or belongs to another name | Both values; nothing else runs |
| Resend sending domain verified | ft can't ask Resend (the key lives only in Cloudflare). It looks for the domain's DKIM record in DNS (`resend._domainkey.<domain>` TXT) **(unverified record name)**: missing is a `warn`, not a stop. The real proof is the manual email check after deploy | README, Deploy, step 4a.2 |
| `RESEND_API_KEY`, `ICAL_URL` set | `wrangler secret list` | "Run ./ft secrets" |
| `.dev.vars` for `--live` | §3.1 | "Copy .dev.vars.example to .dev.vars …" |

**The first switch from custom domain to zone route**, safest order (README step 4 has the details):

| Situation | Steps |
|---|---|
| The site was never deployed | Add the `AAAA freetime 100::` record (proxied), then `./ft deploy`. |
| The site is live on a custom domain | 1. `./ft deploy` deploys both; the site keeps answering on its custom domain, and the smoke check reports `/account` answered by the site (exit 4, expected this once). 2. In the dashboard, remove the custom domain and at once add the `AAAA` record; the site is unreachable for the moment in between **(unverified how long)**. 3. `./ft status`: all smoke checks pass. |

---

## 9. Check and failure codes

| Code | Meaning |
|---|---|
| `node` | Node is older than 20 |
| `deps` | `node_modules` is missing or doesn't match the lock file |
| `ports` | A local port is in use |
| `dev-vars` | `.dev.vars` missing or still the example (only for `--live`) |
| `tree` | Uncommitted or untracked changes |
| `branch` | Not on `main` without `--allow-branch` |
| `tests`, `typecheck` | The gate failed |
| `build` | `wrangler deploy --dry-run` failed |
| `migration-safety` | A pending migration removes or renames data |
| `login` | Not logged in to Cloudflare |
| `database-id` | Placeholder or wrong `database_id` |
| `resend-from`, `resend-dns` | `RESEND_FROM` not set; no DKIM record found |
| `secrets` | A required secret isn't set |
| `remote-db` | Pending remote migrations (`status`), or the list couldn't be read |
| `dns` | The host doesn't resolve |
| `smoke` | A live check failed (each check also has its number from §5.5) |
| `FT_INTERNAL` | A bug in ft |

---

## 10. Testing the script

Tests for ft run in Node, not the Workers runtime: a third Vitest project, `scripts` (`test/scripts/*.test.ts`, `environment: "node"`), next to `site` and `accounts`, so `npm test` still runs everything. Each command's `main` takes its runner (the function that starts `wrangler`, `npm` and `git`) as a parameter, so tests give it a fake that records every call and returns canned output. **No test runs the real wrangler or touches the network.**

**Unit tests:**

- Arguments: every command and flag parses; unknown ones exit 2 with help; `--only` takes only `site` or `accounts`.
- Help: every command has help with the four parts; the list matches the commands.
- **Spec sync** (as Mite Spotter's `tests/test_spec.py`): the command table in §3, the exit codes in §2.2 and the codes in §9 match what ft defines.
- The TOML readers on the real `wrangler.toml` and `wrangler.accounts.toml` (host, routes, `database_id` placeholder, `RESEND_FROM`) and on edited copies.
- The router's path table: for a list of paths (`/`, `/account`, `/accounts`, `/account/sign-in`, `/u/x`, `/s/x`, `/spaces`, `/auth/x`, `/css/app.css`, `/help`, `/sx`), the Worker it picks, matching the "no path belongs to both" test in `test/workers.test.ts`.
- Parsers for `wrangler whoami`, `secret list`, `d1 list`, `migrations list`, `deployments list` and the deploy output, on output captured from wrangler 4.154.0. The secret-list fixture includes a planted value field; the test checks it's dropped.
- Redaction: a temporary `.dev.vars` with a fake `ICAL_URL`; no line ft prints contains it.
- The required-secrets list matches `Env` and `AccountsEnv` (§3.5.1).
- Migration safety: each listed statement stops; `CREATE TABLE` and `ALTER TABLE … ADD COLUMN` pass.
- Smoke evaluation on canned responses: each missing header, a `Set-Cookie` on `/`, the site's 404 at `/account` (prints the custom-domain line), a 503 with a debug line (prints only code and reference).
- The allow-list (§2.4): it contains none of the forbidden commands, the runner refuses each of them, and no module but `run.mjs` imports `node:child_process`. (Rollback commands appear only as printed text in `messages.mjs`.)
- PRINTED OUTPUT: every string in `messages.mjs` has a marker; no other module prints a literal.

**Flow tests (dry run with the fake runner):**

- `deploy --dry-run` runs every read and **no write**: no `deploy` without `--dry-run`, no `migrations apply --remote`, no `secret put`.
- `deploy --yes`: the calls happen in the order of §5.3; with `--only site`, no D1 or accounts call.
- Failure at each write step gives the row of §5.6: the message, the "printed, not run" rollback line, exit 4, and no later step called.
- A dirty tree, a non-`main` branch, a failing test, zeros in `database_id`, a missing secret: each stops before any write, with its code.
- No terminal and no `--yes`: stops before asking.

**`start` tests:** fake children (tiny Node scripts that print lines, then exit on SIGINT, or ignore it, or crash): lines are prefixed and never split; Ctrl+C stops both and escalates to SIGTERM and SIGKILL on time; one child crashing stops the other and exits 1; a busy port stops before starting anything. The router is tested with two local HTTP servers standing in for the Workers: method, body, headers and `Host` arrive unchanged.

**By hand, once per phase:** Maxence runs the new commands on their machine. Before the first real deploy through ft: `./ft deploy --dry-run`, and compare its plan with what they expect.

---

## 11. Decisions

Anything not checked against current documentation is marked **(unverified)**.

| Chosen | Alternatives | Why | Would change my mind |
|---|---|---|---|
| `./ft` with subcommands | `deploy`, `run`, separate `m`-style commands | §1.1 | Maxence preferring `./deploy` anyway: only the shim's name changes. |
| A Node script (`.mjs`), standard library only, behind a 5-line `sh` shim | A POSIX shell script; TypeScript run with `tsx` | Starting two processes, prefixing lines, signals, an HTTP router, JSON and `fetch` are all simple in Node and awkward in `sh`. Node 20 can't run `.ts` without a new dependency. | Node gaining stable TypeScript support at the project's minimum version. |
| Wrangler from `node_modules/.bin`, never `npx` | `npx wrangler` | The pinned version, always; no surprise downloads. | — |
| Deploy order: migrations, accounts, site, checks | Site first; parallel | §5.3 | — |
| No automatic rollback; exit 4 and printed next steps | Roll back on smoke failure | Nothing self-heals (§6); a guessed rollback is a second unreviewed change. | Repeated partial deploys where the right fix was always the same. |
| No `--skip-tests`, no `--force` | Escape hatches | The gate exists to stop exactly those deploys. Raw wrangler remains documented for emergencies. | Tests becoming slow enough to matter. |
| Only additive migrations through ft | Apply anything | Old code runs on the new schema for a moment; removing data deserves a human reading the SQL. | — |
| Local router on a new port (:8780), in scope (phase 2) | Leave the two ports apart; make :8787 the router; change the Workers | Matches production routing with no change to either Worker, and `npm run dev` keeps meaning what it means. | The `Host` check failing (§3.2.1): then it's dropped. |
| Smoke checks tell the Workers apart by page content | A response header naming the Worker | No code change to either Worker, and no new header to explain. | Content checks proving flaky. |
| `deploy` requires `main` unless `--allow-branch` | Any branch; `main` only | Deploying a feature branch before merging is real (accounts phase 1), but it should be a choice, not an accident. | — |
| Not pushed: a warning, not a stop | Require pushed | Maxence deploys from their machine and may push afterwards. | Maxence wanting the stricter rule (open item 3). |
| `deploy:accounts` removed in phase 3 | Keep it | Two deploy paths, one without checks. | — |

---

## 12. Open items (ask Maxence before deciding)

1. **Name:** `./ft`, or `./deploy` after all? (Only the shim's name and the help text change.)
2. **Branches:** is `--allow-branch` right, or should `deploy` only ever run from `main`?
3. **Pushed commits:** should a commit that isn't on GitHub stop the deploy instead of warning?
4. **The router:** port 8780, and should the "Ready" block list it first (as the address to open) or last?
5. **Types for the script:** checking `scripts/` with `tsc` (`// @ts-check`) needs `@types/node` as a dev dependency. Add it (and justify it in the README), or rely on the tests alone?
6. **Migration safety:** is the list in §5.2 step 7 right? Should a destructive migration be possible through ft with a typed confirmation, rather than only by hand?
7. **`deploy:accounts`:** remove it in phase 3 as planned, or keep it as an alias for `./ft deploy --only accounts`?

---

## 13. Definition of done (per phase)

- **Phase 1:** `./ft`, `npm run ft`, `help`, `install` and `test` work as in §3.1, §3.3 and §3.7 on macOS and Linux; exit codes as §2.2; every string in `messages.mjs` with a PRINTED OUTPUT marker; the `scripts` Vitest project with the tests in §10 that apply; the name lock covers `scripts/`; README "Run it locally" leads with `./ft install` and `./ft start` (raw commands kept); PRINTED OUTPUT count for ft reported.
- **Phase 2:** `start` as §3.2, including Ctrl+C, a crashing child and busy ports; the router as §3.2.1, with sign-up, the printed confirmation link and sign-in confirmed through :8780 (or the router dropped, with the reason in the README); the README's "account icon doesn't reach :8788" sentence updated; tests green.
- **Phase 3:** `deploy`, `status`, `secrets` and `logs` as §3.4–3.6 and §5; the dry-run and failure tests in §10 green; README Deploy steps 4 and 4a rewritten around `./ft deploy`, `./ft secrets` and §8, with the raw commands as a marked fallback; `deploy:accounts` removed (or kept, per open item 7); the decisions table in the README updated; Maxence has run `./ft deploy --dry-run` and one real `./ft deploy`.
