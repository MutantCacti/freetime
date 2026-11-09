# freetime.mutantcacti.com — developer script spec

One command, `./ft`, installs, runs, checks and deploys both Workers, so Maxence can work one level above raw `wrangler` and `npm` commands. It wraps the commands the README already lists; it adds checks and order, not new ways to change production.

**Status: built** (phases 1–3, in `ft` and `scripts/`). Maxence reviewed the first draft; their answers are in §13. Everything in `SPEC.md` §2 applies to the script where it makes sense (plain language, PRINTED OUTPUT, as few dependencies as possible, **(unverified)** on anything not checked against current documentation), unless this file says otherwise. The two-Worker rules in `ACCOUNTS-SPEC.md` §1 are unchanged: the script deploys the Workers one after the other, never as one.

| Phase | What | State |
|---|---|---|
| 0 | This spec | done |
| 1 | `./ft` itself: `help`, `install`, `test`; output, exit codes, the PRINTED OUTPUT module; tests for the script | built |
| 2 | `start`: both Workers in one terminal, prefixed output, clean Ctrl+C, and the local router on :8780 | built, run here |
| 3 | `deploy`, `status`, `secrets`, `logs`, the `.secrets` file; the README's Deploy section rewritten around them | built, tested through the fake runner and `--dry-run` only: never run against Cloudflare from the build session |

**Where it came from.** Maxence's Mite Spotter plan (`standrewsvcs/mitespotter-api`, `planning.md`, "Sprint 0: Backend"; §7 here) listed developer commands with one shared prefix (`minstall`, `mstart`, `mtest`, `mhelp`, …), and its scheduled jobs follow one rule, which this script follows too: **check integrity first, failures stop, nothing self-heals.**

---

## 1. Name and invocation

**The command is `ft`** (freetime), run from the repository root as:

```bash
./ft <command> [flags]
```

`npm run ft -- <command> [flags]` does exactly the same thing, for anyone who prefers npm.

- `./ft` is a 5-line POSIX `sh` file at the repository root. It finds its own directory, checks that `node` is on the `PATH` (if not: "ft needs Node 20 or later: https://nodejs.org", exit 1), and runs `exec node scripts/ft.mjs "$@"`.
- The work is done by `scripts/ft.mjs` and the modules in `scripts/ft/`: plain JavaScript (ES modules, with JSDoc types) using only Node's standard library (`node:child_process`, `node:http`, `node:fs`, `node:dns`, `node:crypto`, `fetch`). No new runtime or dev dependency.
- It works from any directory inside the repository: it resolves the root from its own path, not from the current directory.
- It needs only Node 20+ and npm, on macOS and Linux. Windows isn't a target (`./ft` is a shell file, and deploy reads secrets from `/dev/stdin`).
- **Wrangler is always the repository's own copy** (`node_modules/.bin/wrangler`, version pinned in `package.json`), never `npx wrangler`, which can quietly download a different version if `node_modules` is missing. Without a matching `node_modules`, every command but `help` and `install` stops with "Run ./ft install first."

### 1.1 Why `ft`

| Candidate | Problem |
|---|---|
| `deploy` | Maxence's first idea. But `./deploy start` and `./deploy install` read wrongly, and a bare `./deploy` (or `npm run deploy`, which people type by habit) sounds like it deploys. The rule "never deploy without an explicit command" is easiest to keep when the tool's name isn't the dangerous verb. `deploy` stays, as the subcommand. |
| `run` | `npm run run -- start` is confusing; `run` is a shell word in many people's heads, and it says nothing about the project. |
| `freetime` | Clear, but long to type dozens of times a day. |
| `dev` | Collides with the existing `npm run dev`, which means "the site with the fixture feed". |
| **`ft`** | Short, names the project, and isn't an npm script or a standard macOS or Linux command **(unverified that no common package installs an `ft` binary)**. Run as `./ft`, so even a global `ft` couldn't be picked up by mistake. **Chosen; Maxence agreed.** |

Like Mite Spotter's `m` prefix, one short name groups every developer command; unlike it, they are subcommands of one program rather than seven separate binaries, so there's one `help`, one set of checks and one place for the output text.

### 1.2 The npm scripts

`dev`, `dev:live`, `dev:accounts`, `test` and `typecheck` stay as they are: they're the raw layer, and `ft` runs the same commands. `ft` is added as `"ft": "node scripts/ft.mjs"`. `deploy:accounts` is **removed**: it deployed one Worker with no checks, which `./ft deploy --only accounts` replaces. The README keeps the raw `wrangler` commands as a fallback appendix, marked "not through ft: no checks".

---

## 2. Rules for every command

### 2.1 Output

- **Every string `ft` prints is PRINTED OUTPUT** (`SPEC.md` §2.1). They live in `scripts/ft/messages.mjs` (and the five status words in `output.mjs`), each with its marker, for example `// PRINTED OUTPUT: ft / git / dirty`. A test checks every message has one, and that no other module prints. The README's search line is `grep -rn "PRINTED OUTPUT" src public scripts ft`.
- **Wrangler's and npm's own output is not ft's text.** When it's shown, each line is prefixed with its source (`site     | `, `accounts | `, `wrangler | `, `npm      | `), so it's always clear who said what. It carries no marker and ft doesn't rewrite it, except to redact secrets (§2.3).
- **One line per check**, in this shape (a fixed-width status word, the check's name, then plain words):

```text
  ok    node              Node 22.22.0
  ok    deps              node_modules matches package-lock.json
  warn  login             Not logged in to Cloudflare.
                          Only needed for deploy, status, secrets and logs: npx wrangler login
  FAIL  database-id       wrangler.accounts.toml still has the placeholder database_id (all zeros).
                          Create the database: npx wrangler d1 create freetime-accounts
  skip  tests             Not run: fix the failures above first (tests, typecheck and build).
```

  The check's name (`database-id`) is its code, like the site's error codes: short, stable, searchable, and listed in §10.
- Plain ASCII apart from what wrangler prints, no emoji. Colour (green `ok`, yellow `warn`, red `FAIL`) only when the output is a terminal and `NO_COLOR` isn't set. Terminal colour codes only; no hex colours anywhere.
- **Expected failures never print a stack trace.** An unexpected error prints `ft: internal error (FT_INTERNAL): <message>`; `--verbose` adds the stack.
- `--verbose` on any command also prints each command ft runs, before it runs it (`$ wrangler d1 migrations list freetime-accounts --remote -c wrangler.accounts.toml`). Secret values are never arguments (§2.3), so they can't appear there.

### 2.2 Exit codes

| Code | Meaning |
|---|---|
| 0 | Done, everything passed. |
| 1 | A check or step failed. Nothing in production changed. |
| 2 | Usage: unknown command or flag, or a missing argument. The command's help is printed. |
| 3 | One-time setup is missing (§9), including a missing local secret value. The message says which step and how to do it. |
| 4 | **Production changed, but not completely**: a migration ran or one Worker deployed, and a later step or a smoke check failed (§5.6). |
| 129 | Stopped by SIGHUP (the terminal closed) (§2.6). |
| 130 | Stopped with Ctrl+C (SIGINT), or a confirmation was answered "no". |
| 143 | Stopped by SIGTERM (`kill`, or a tool running ft that gave up on it) (§2.6). |

A signal's code wins over whatever the command had reached: an interrupted deploy exits 130, 143 or 129, and its `DEPLOY INTERRUPTED` block (§5.6) says what changed.

### 2.3 Secrets

Maxence's rule: ft **may** handle secret values, "as long as it's never in the client". So:

- **Production values live in one local file, `.secrets`** (§6), gitignored, owner-readable only (mode 600). `./ft deploy` reads it and sends each Worker its own values.
- **Values go to wrangler on stdin, never as a command-line argument.** Deploy pipes a JSON object to `wrangler deploy --secrets-file /dev/stdin`; `./ft secrets --set` pipes the value to `wrangler secret put NAME`. Arguments show up in `ps`, shell history and `--verbose`; stdin doesn't. No temporary file is written.
- **Never printed, never logged.** Before ft prints any line (its own or wrangler's), it replaces every known value, and each address inside `ICAL_URL`, with `[NAME]`, as the Worker's own logs do. Values come from `.secrets` and `.dev.vars`. Tests plant fake values and check they never appear in the output or in any argument.
- **Never in the client:** nothing under `src/` or `public/` mentions `.secrets` (a test enforces it), the file is outside `public/` (the only directory uploaded as static assets), and the secrets reach the Workers only as Worker secrets.
- **Children get a clean environment:** ft removes every secret name it knows from the environment of the processes it starts, because wrangler lets the process environment override a secrets file. It also sets `WRANGLER_SEND_METRICS=false`.
- **Change detection by keyed hash only.** After each successful deploy of a Worker, ft writes an HMAC-SHA256 of each value it sent (keyed with a random salt kept in the same file) to `.secrets.hashes`, also gitignored and mode 600. It never stores a value. The plan shows each secret as "unchanged", "changed" or "first time through ft", and the hash is what stops a changed `ACCOUNTS_KEY` (§6.2).
- `wrangler secret list` is read for **names** only (`./ft status`, `./ft secrets`); anything else in its output is dropped while parsing.

### 2.4 What ft never does

Every `wrangler`, `npm` and `git` call goes through one module, `scripts/ft/run.mjs`, which only accepts the subcommands ft uses and refuses everything else, even when called with a fake runner in tests. A test checks the allow-list, and that no other module starts a process. Never run, by any command, with any flag:

- `wrangler delete`, `d1 delete`, `secret delete`, `secret bulk`, `r2 bucket delete`, `versions …`, `rollback`;
- `wrangler d1 execute` (arbitrary SQL), `d1 time-travel`;
- `wrangler login` or `logout` (it says when to log in; Maxence runs it);
- `git` anything but `status`, `rev-parse`, `rev-list`, `log` and `check-ignore`;
- `npm` anything but `ci`, `test` and `run typecheck`;
- editing `wrangler.toml`, `wrangler.accounts.toml`, `package.json` or `.dev.vars`. The only files ft writes are `.secrets` (by `./ft secrets`) and `.secrets.hashes` (after a deploy);
- replacing `ACCOUNTS_KEY` once it exists (§6.2);
- deploying without the `deploy` command, or a Worker the command didn't name.

Rollback commands are **printed** when they're the right next step (§5.6), never run.

### 2.5 Confirmations

- `deploy` asks once before its first write: `Deploy? [y/N]`. Only `y` or `yes` continues; anything else (including Enter) stops with exit 130.
- `--yes` answers that question. It never skips a check.
- If standard input isn't a terminal and `--yes` wasn't given, a command that would ask stops instead: "This needs an answer, and there's no terminal to ask. Run it in a terminal, or add --yes." (exit 1). `secrets --set` always needs a terminal, for the hidden prompt.

### 2.6 Stopping: signals, crashes and children

One module, `scripts/ft/lifecycle.mjs`, knows every process ft started and how ft ends. Added after agents in this repository couldn't stop a running `./ft start` and had to leave it running. What was wrong before, found by running it here:

| Before | Effect |
|---|---|
| No SIGHUP handler; children in their own process groups | Closing the terminal killed ft and **left both `wrangler dev`, both their workers and four `workerd` processes running**, holding 8787, 8788, 9229 and 9230. |
| SIGTERM handled as Ctrl+C | Exit 130 instead of 143. |
| `fetch` keep-alive sockets from the readiness check | ft printed "Stopped" and then sat there 5 s more before exiting. |
| The readiness wait wasn't cancelled | A Worker that failed to start (port taken, a config error) was reported in 2 s, then ft hung until the 60 s readiness timeout. |
| `test` and `logs` children in ft's process group, SIGTERM unhandled | `kill <ft>` left `npm test` and vitest running, orphaned. |
| `deploy` had no handler at all | Ctrl+C killed ft and wrangler mid-write with no word about what had been written; SIGTERM left wrangler deploying, orphaned. |
| Uncaught errors and a closed stdout (EPIPE, EIO) | Crashed ft without stopping its children. |
| A Worker killed by a signal | Reported as "exit 128" whatever the signal. |

What it does now:

- **Every child ft starts is in its own process group** (`detached`), so a signal to the group reaches its own children too (wrangler's `workerd`, npm's vitest), and is **tracked** until it exits. When a child's leader exits, anything left in its group is killed. Children never read ft's terminal (stdin is a pipe or closed); `test` and `logs` still write straight to it, colours included. So Ctrl+C reaches ft only, and ft stops the children.
- **SIGINT, SIGTERM and SIGHUP** are handled the same way, with exit codes 130, 143 and 129. `start` and `deploy` handle the signal themselves (§3.2, §5.6). For every other command ft stops each child (SIGINT, then SIGTERM, then SIGKILL, 3 s apart), nothing new starts after the signal (the runner refuses: `Interrupted`), ft prints `Stopped by Ctrl+C.` (or `SIGTERM`, or `SIGHUP (the terminal closed)`), and exits. What a cut-short step would report (a killed `wrangler whoami` reads as "not logged in") isn't printed.
- **A second signal** kills every child's group with SIGKILL and exits at once: `Ctrl+C again, or still stopping: killed everything ft started that was still running.` So does a first signal that hasn't finished stopping after 30 s. Nothing can make ft hang after a signal.
- **An error nothing caught** (an exception or a rejected promise anywhere) prints `ft: internal error (FT_INTERNAL): …`, stops every child and exits 1.
- **When the process exits**, for whatever reason, every child still running gets SIGKILL, and the terminal leaves raw mode if a hidden prompt (§3.5) had it.
- **ft always exits explicitly** when the command is done, after its output is written, so nothing left open (a socket, a prompt) keeps it alive. A closed stdout (EPIPE, EIO) no longer crashes it; output is dropped from then on.
- **SIGKILL to ft itself can't be handled** by any program: its children would keep running. `pkill -f workerd` cleans up after that, and the next `./ft start` names any port still in use.

---

## 3. Commands

| Command | One line |
|---|---|
| `./ft help [command]` | The command list, or one command's help. |
| `./ft install` | Install exact dependencies if needed, set up the local database, and say what else is missing. |
| `./ft start` | Run both Workers locally in one terminal, plus the router on :8780; Ctrl+C stops both. |
| `./ft test` | Tests and typecheck: the same gate `deploy` uses. |
| `./ft status` | What's local, what's deployed, what's missing; read-only. |
| `./ft deploy` | The one flow: checks everything, migrates, deploys both Workers with their secrets, then checks the live site. |
| `./ft secrets` | The local `.secrets` file: list, `--set` one (hidden prompt), `--generate ACCOUNTS_KEY`. |
| `./ft logs <site\|accounts>` | Live logs (`wrangler tail`) for one Worker. |

Flags common to every command: `--help` (same as `./ft help <command>`), `--verbose` (§2.1). Flags are long-form only (`--dry-run`, not `-n`), so a typo is an error rather than a different flag.

### 3.1 `install`

1. **Checks Node:** 20 or later. Older: FAIL `node`, exit 1.
2. **Dependencies:** runs `npm ci` **only when `node_modules` doesn't match `package-lock.json`**: every package the lock file installs on this platform must be present at its locked version (optional packages for other platforms are skipped). This changed from the first draft ("always `npm ci`"), because `npm ci` deletes `node_modules` first, which breaks any dev server running from it and any other checkout that shares it. Output prefixed `npm      | `.
3. **Local database** for `./ft start`: `wrangler d1 migrations apply freetime-accounts-dev --local -c wrangler.accounts.toml --env dev`. Running it again applies nothing new.
4. **Reports, without doing:** Cloudflare login (`warn` if not: only deploy, status, secrets and logs need it); `.dev.vars` (absent is fine; present without `ICAL_URL`, or with the example's value, is a `warn`); `.secrets` (absent is fine; missing values are a `warn`, since only deploy needs them).
5. Ends with `Ready. Next: ./ft start`.

**Exit:** 0 when steps 1–3 pass (warnings don't fail it), 1 otherwise. **Never:** logs in, creates `.dev.vars` or `.secrets`, touches the remote database.

### 3.2 `start`

**Checks first:** Node, `node_modules`, and the ports (8787, 8788, 8780 and inspector ports 9229, 9230) are free. A busy port stops it before anything starts: "Port 8787 is in use." plus "Is another ./ft start or npm run dev running? Stop it, or use --port-offset 10 for a second checkout." (exit 1). ft never picks a different port by itself.

**Does:**

1. Applies local migrations (as `install`, step 3).
2. Starts, each in its own process group:

| Prefix | Command | Address |
|---|---|---|
| `site` | `wrangler dev --env dev --ip 127.0.0.1 --port 8787 --inspector-port 9229 --show-interactive-dev-session=false` (fixture feed) | http://localhost:8787 |
| `accounts` | `wrangler dev -c wrangler.accounts.toml --env dev --ip 127.0.0.1 --port 8788 --inspector-port 9230 …` (emails printed in the terminal) | http://localhost:8788 |
| `router` | ft's local router (§3.2.1) | http://localhost:8780 |

3. **Prefixes every line** of each Worker's output with its name, splitting on new lines so lines never interleave mid-line.
4. Waits until each Worker answers an HTTP request (up to 60 s), then prints:

```text
  Ready.
    http://localhost:8780   both Workers, split by path as in production
    http://localhost:8787   the site only (the account icon goes nowhere here)
    http://localhost:8788   the accounts Worker only
  Ctrl+C stops both.
```

5. **Ctrl+C, SIGTERM or SIGHUP** (§2.6): prints `Ctrl+C: stopping. Ctrl+C again kills everything now.`; sends SIGINT to each Worker's process group, waits up to 3 s, then SIGTERM, then after 3 more seconds SIGKILL; closes the router, dropping any open connection (a browser's keep-alive would otherwise hold it open); prints `Stopped site and accounts.`; exits 130, 143 or 129. Then it checks the ports are free again and, if one isn't, names it with `lsof -i :<port>`. `wrangler dev` stops within a fraction of a second on SIGINT, so this normally takes well under a second. A signal during the local migration stops it, and nothing starts. A second signal kills everything at once.
6. **If one Worker stops on its own, or never answers,** ft stops the other one and the router too and exits 1: "accounts stopped unexpectedly (exit 1). Stopping site too.", then `Last lines from accounts:` and its last 12 lines again (they may have scrolled past, between the other Worker's), or "didn't answer within 60 seconds". A Worker that fails while starting (its port taken, a config error) ends the wait for readiness at once. A Worker killed by a signal shows 128 + its number (137 for SIGKILL). **It never restarts anything.**

**Flags:** `--live` (the site uses the real feed from `.dev.vars`; exit 3 without it), `--only site|accounts` (one Worker, no router), `--no-router`, `--port-offset N` (adds N to all five ports, for a second checkout or worktree running at the same time; added during the build, when the build session found another checkout's dev servers on 8787 and 8788).

**Never:** deploys, uses the remote database, or reads Cloudflare secrets.

#### 3.2.1 The local router (:8780)

In production both Workers answer on one host, split by path; locally they're on two ports, so the account icon on :8787 can't reach :8788. The router fixes that without changing either Worker:

- The accounts paths are read from the route patterns in `wrangler.accounts.toml`, never typed into the script. A trailing `*` matches any suffix, as Cloudflare's route patterns do **(unverified exact semantics; the path-table test records what ft assumes)**. Everything else goes to the site.
- Method, path, headers (**`Host` included**) and body pass through unchanged, and the response's raw headers come back unchanged (several `Set-Cookie` included). It listens on `127.0.0.1` only and keeps no state. A Worker that isn't answering gets a plain-text 502 naming it.
- **Confirmed in the build session:** through :8780, signing up (a POST with `Origin: http://localhost:8780`) passed the accounts Worker's `Origin` check, a POST with another origin got 403, the printed confirmation link pointed at `http://localhost:8780/account/verify?...`, and confirming it set the `__Host-session` cookie and signed in. So `wrangler dev` does keep the incoming `Host` in `request.url`. Tested with curl; a browser's handling of `Secure` cookies on `http://localhost` is **(unverified for Safari)**.

### 3.3 `test`

Runs `npm test` (all three Vitest projects), then `npm run typecheck`, output passed straight through. Both always run. Ends with an `ok`/`FAIL` line for each. `--only site|accounts` runs one Vitest project and skips typecheck. **Exit:** 0 if both pass, 1 otherwise.

### 3.4 `status`

Read-only. Sections:

- **Local:** branch (clean or not, pushed or not), commit, deps, local database migrations.
- **Setup:** `database-id`, `resend-from`, `.secrets` values, DNS for the host, Resend's DKIM record (§9).
- **Cloudflare** (needs login): each Worker's latest deployment, with the commit from its message (`deploy` passes `--message "<sha> <branch>"`) compared with HEAD: "same as HEAD", "n commits behind HEAD", "not in this repository's history" or "deployed without ft"; secret names set on each Worker; whether the database id exists; pending remote migrations.
- **Live:** the smoke checks of §5.5, run once, without retries.

`--offline`: only Local and the file-based Setup checks; no network, no Cloudflare call. **Exit:** 0 nothing to report; 1 something needs attention; 3 a setup step is missing.

### 3.5 `secrets`

| Form | Does |
|---|---|
| `./ft secrets` | Lists each required secret: in `.secrets` or not, set on Cloudflare or not (names only; Cloudflare only when logged in). Exit 3 if a value is missing locally. |
| `./ft secrets --set NAME` | Prints a hint for that secret, reads the value with a **hidden prompt** (needs a terminal), saves it in `.secrets` (creating the file from `.secrets.example` if needed, mode 600). Then, if logged in, asks `Also put NAME on the live <Worker> now? [y/N]` (`--yes` answers) and pipes it to `wrangler secret put NAME` on stdin, so a fix (a new `ICAL_URL`) doesn't wait for a deploy. Refuses `ACCOUNTS_KEY` once it exists. |
| `./ft secrets --generate ACCOUNTS_KEY` | Writes 32 random bytes, base64url (43 characters), into `.secrets` under `[accounts]`. Refuses if a value is already there. Never prints it. It goes up with the next deploy. Only `ACCOUNTS_KEY` can be generated. |

The required list is in `scripts/ft/workers.mjs`: site `ICAL_URL`; accounts `RESEND_API_KEY` and `ACCOUNTS_KEY` (needed from accounts phase 2: AES-GCM key material for iCal addresses in D1; required now so it exists before phase 2 deploys). A test reads `Env` (`src/app.tsx`) and `AccountsEnv` (`src/accounts/app.tsx`) and fails if a string field there isn't a secret or var in that list.

**Never:** prints, logs or deletes a secret; uses `secret bulk`; copies anything from `.dev.vars`.

### 3.6 `logs`

`./ft logs site` or `./ft logs accounts`: `wrangler tail --format pretty` (with `-c wrangler.accounts.toml` for accounts), passed straight through. `--ref REF` adds `--search REF`, `--errors` adds `--status error` (flag names checked against wrangler 4.154.0's help). Needs a login (exit 3 without). Ctrl+C stops it.

### 3.7 `help`

`./ft`, `./ft help` and `./ft --help` print the list (exit 0). `./ft help deploy` and `./ft deploy --help` print one command's help. An unknown command prints "Unknown command: dpeloy. Did you mean deploy?" (closest by edit distance, if within 2) and the list, exit 2. Each command's help has the same parts: what it does, its flags, what it never does, and its exit codes. A test checks every flag is in its command's help.

---

## 4. Shared checks

| Check | How | install | start | status | deploy |
|---|---|---|---|---|---|
| `node` | `process.versions.node` ≥ 20 | ● | ● | | ● |
| `deps` | every package in `package-lock.json` installed at its version | ● | ● | ● | ● |
| `ports` | the five ports free (connect to `127.0.0.1` and `::1`, then try to listen) | | ● | | |
| `dev-vars` | key names in `.dev.vars` | ● | `--live` | | |
| `tree` | `git status --porcelain` is empty (untracked files count) | | | ● | ● |
| `branch` | current branch; pushed or not | | | ● | ● |
| `tests`, `typecheck` | `npm test`, `npm run typecheck` | | | | ● |
| `database-id` | top-level `database_id` isn't all zeros; with a login, `wrangler d1 list --json` has it, named `freetime-accounts` | | | ● | ● |
| `resend-from` | top-level `RESEND_FROM` looks like `name <address@domain>` | | | ● | ● |
| `secrets-file` | `.secrets` has every required value for the Workers being deployed, has no syntax problems, and git ignores it | ● | | ● | ● |
| `secret-rotate` | `ACCOUNTS_KEY` matches the hash of the one last deployed | | | | ● |
| `build` | `wrangler deploy --dry-run --secrets-file /dev/stdin` for each Worker (bundles, validates the config and reads the secrets; uploads nothing) | | | | ● |
| `login` | `wrangler whoami` | warn | | ● | ● |
| `remote-db` | `wrangler d1 migrations list freetime-accounts --remote -c wrangler.accounts.toml` | | | ● | ● |
| `migration-safety` | §5.2 | | | | ● |
| `dns` | the host resolves | | | ● | ● |
| `smoke` | §5.5 | | | ● | after |

**The site's host is read from the route in `wrangler.toml`**, never written in the script. The name lock (`test/name.test.ts`) now also scans `scripts/`, `test/**/*.mjs` and `ft`. The configs are read with narrow, tested readers (a route pattern, `database_id`, `RESEND_FROM`, the Worker name), not a TOML library; the tests run them on the real files.

---

## 5. `deploy`

**One flow that deploys both Workers**, with their secrets. It's the only ft command that changes production code, and it does nothing to production until every check has passed and Maxence has said yes.

### 5.1 Flags

| Flag | Effect |
|---|---|
| `--only site\|accounts` | Deploy one Worker. Its own checks and steps only (`--only site` skips D1, Resend and migrations). Tests, typecheck and **all** smoke checks still run. |
| `--dry-run` | Every check, local and remote, and the plan; then exit 0. Nothing is written. |
| `--yes` | Answers the one confirmation. Never skips a check. Needed when there's no terminal. |
| `--allow-branch` | Deploy from a branch other than `main`. |

**`--skip-tests` and `--force` don't exist.** If Maxence ever must, the raw wrangler commands are in the README's fallback appendix.

### 5.2 Pre-flight

All before anything is written. Any FAIL stops the deploy with exit 1, or 3 if every failure is a setup step. Every failure is printed, not just the first; tests, typecheck and the build are skipped if anything before them failed (they're slow, and pointless on a dirty tree).

**Local:**

1. `node`, `deps` (stop at once if either fails).
2. `tree`: clean. Otherwise: "N uncommitted changes (untracked files count). Deploy only commits: commit or stash them first."
3. `branch`: `main`, or `--allow-branch`. A commit not on its upstream (or a branch with none) is a `warn`, not a stop.
4. `database-id` (not zeros), `resend-from` (accounts only).
5. `secrets-file`: `.secrets` exists, parses, has a value for every required secret of each Worker being deployed (missing: exit 3, with `./ft secrets --set NAME` or `--generate ACCOUNTS_KEY`), and `git check-ignore` confirms it's ignored.
6. `secret-rotate`: if `.secrets.hashes` records an `ACCOUNTS_KEY` and the local one differs, stop (§6.2).
7. `tests`, `typecheck`, then `build` for each Worker (with its secrets on stdin, so a bad value fails here).

**Cloudflare (read-only):**

8. `login`. Not logged in: exit 3.
9. `database-id` (remote half): the id exists and is named `freetime-accounts`.
10. `remote-db`: pending migrations. Each pending file is read; if one contains `DROP TABLE|COLUMN|INDEX|VIEW|TRIGGER`, `DELETE FROM`, `ALTER TABLE … RENAME` or `ALTER TABLE … DROP` (comments ignored; `ON DELETE CASCADE` is fine), `migration-safety` stops it: "removes or renames data. ft only applies migrations that add." with the command to apply it by hand after reading it.
11. `dns`: the host resolves; otherwise exit 3.

`wrangler secret list` isn't needed: deploy sends every required secret with each version.

### 5.3 The plan and the order

```text
  Plan
    1  migrate   freetime-accounts (remote): 0002_profiles.sql
    2  deploy    freetime-accounts  /account*, /u/*, /spaces*, /s/*, /auth/*
         with    RESEND_API_KEY (unchanged), ACCOUNTS_KEY (first time through ft)
    3  deploy    freetime           freetime.mutantcacti.com/*
         with    ICAL_URL (changed)
    4  check     https://freetime.mutantcacti.com (12 checks)
  From main at 5795eac "Accounts phase 1: the accounts Worker, ..."
  Deploy? [y/N]
```

**Order: migrations, then accounts, then the site, then the checks.**

| Option | Chosen? | Why |
|---|---|---|
| Migrations before the accounts code | **yes** | New code expects the new schema; the old code still running for a moment must cope with it, which is why migrations only add. |
| Accounts before the site | **yes** | The site is what visitors use, so it's touched **last, and only if everything before it worked**. The accounts Worker's only dependency on the new site is its stylesheets, so for a moment an account page could look slightly off. |
| Site before accounts | no | If accounts then failed, every visitor would see an account icon leading to a 404. |
| Both at once | no | Two failures at once are harder to read. |

### 5.4 The writes

1. `wrangler d1 migrations apply freetime-accounts --remote -c wrangler.accounts.toml`, with stdin closed so wrangler doesn't ask again (ft already asked) **(unverified that wrangler 4 proceeds without a terminal for remote applies)**. Output prefixed `wrangler | `.
2. `wrangler deploy -c wrangler.accounts.toml --env= --message "<sha> <branch>" --secrets-file /dev/stdin`, with `{"RESEND_API_KEY": …, "ACCOUNTS_KEY": …}` on stdin.
3. `wrangler deploy --env= --message "<sha> <branch>" --secrets-file /dev/stdin`, with `{"ICAL_URL": …}`.

`--secrets-file` uploads the secrets **with the version**, in the same deploy as the code, so the code and its secrets go live together, and no extra version is made per secret (each `wrangler secret put` makes a new version of the deployed code). Wrangler's help says it "applies additively … omitted secrets will not be deleted". `--env=` selects the top-level environment explicitly, which silences wrangler's warning. Checked against wrangler 4.154.0 with `--dry-run`: the secret was read from `/dev/stdin`, listed as `env.ICAL_URL ("(hidden)")`, and the value appeared neither in the output nor in wrangler's log file. A real upload with `/dev/stdin` is **(unverified; on macOS too)**.

After each Worker deploys, ft keeps the version id wrangler prints (`Current Version ID: …`, **(unverified wording)**) and records the secrets' hashes. ft never retries a failed write.

### 5.5 Smoke checks

Read-only requests from `fetch` to the live host (`redirect: "manual"`, user agent `freetime-ft-smoke`). Failing checks are retried every 2 s for up to 30 s **(unverified propagation time)**. They run after every deploy, whichever Workers were deployed.

| # | Request | Expect |
|---|---|---|
| 1 | `GET /` | 200, `text/html`; HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin`, CSP with `frame-ancestors 'none'`, a `Cache-Control`; **no** `Set-Cookie`; the account link |
| 2 | `HEAD /` | 200 |
| 3 | `POST /` | 405 |
| 4 | `GET /free-busy.ics` | 200, `text/calendar`, filename `mutantcacti-busy.ics` |
| 5 | `GET /css/app.css` | 200, `text/css` |
| 6 | `GET /css/calendar.css` | 200, `text/css` |
| 7 | `GET /help` | 200, `text/html` |
| 8 | `GET /account` | 200, `text/html`, the security headers, the signed-out page; **answered by the accounts Worker** |
| 9 | `GET /account/sign-in` | 200 |
| 10 | `GET /account/sign-up` | 200 |
| 11 | `GET /account/ft-missing` | 404 from the accounts Worker |
| 12 | `GET /u/ft-missing` | 404 from the accounts Worker |

**Telling the Workers apart** needs no code change: the accounts Worker's 404 links home to `/account` and its signed-out page links to `/account/sign-in`; the site's 404 links to the calendar. If the site answers `/account`, ft prints that a custom domain on the site takes precedence over routes and should be removed **(unverified precedence)**. A 503 on `/` prints only its code and reference (`FEED_STATUS_404 · ref 7K2Q9M`) and `./ft logs site --ref 7K2Q9M`. A full deploy ends with the README's manual account check (sign up, confirm, reset, sign in).

### 5.6 When something fails part-way

**No automatic rollback.** ft stops at the first failure, says what's live now, and prints the next steps.

| What failed | What's live | ft prints | Exit |
|---|---|---|---|
| A check | Nothing changed | the failing checks; `Not deployed. Nothing was changed.` | 1 or 3 |
| Answered "no" | Nothing changed | `Not deployed.` | 130 |
| The first deploy, with no migration before it | Nothing changed | the wrangler error; "Nothing in production was changed." | 1 |
| Migration | Some migrations may have run **(unverified whether D1 applies each file atomically)** | `DEPLOY INCOMPLETE`, and how to list what was applied | 4 |
| Accounts deploy, after migrations | Migrations applied; both Workers unchanged | `DEPLOY INCOMPLETE` | 4 |
| Site deploy | New accounts Worker, **old site** | `DEPLOY INCOMPLETE`; "Fix the problem, then: ./ft deploy --only site", or `npx wrangler rollback -c wrangler.accounts.toml` (printed, not run) | 4 |
| Smoke checks | Both new | the failing checks; `./ft logs`; a rollback line per deployed Worker (printed, not run) | 4 |

The `DEPLOY INCOMPLETE` block starts and ends with a line of `=` and lists each Worker as "new version …" or "unchanged (the previous version)". Migrations are never rolled back by ft.

**Interrupted** (Ctrl+C, SIGTERM or SIGHUP; exit 130, 143 or 129, §2.6). It's never left unclear what was deployed:

| When | What ft does | ft prints |
|---|---|---|
| During the checks, or at the question | Stops the running check; writes nothing | `Stopped by Ctrl+C before any write. Not deployed. Nothing was changed.` |
| During a write (the migration, or a Worker's deploy) | **Lets that write finish**, then stops before the next: stopping wrangler part-way would leave it unknown whether it went live | `Ctrl+C: finishing freetime-accounts first, then stopping (…). Ctrl+C again stops it now.`, then the `DEPLOY INTERRUPTED` block |
| A second signal during a write | Kills it at once | the block, with that step as `UNKNOWN … stopped part-way: it may or may not have gone live` and `./ft status` to find out |
| During the live checks (read-only) | Stops them at once | the block, with "live checks: not finished" |

The `DEPLOY INTERRUPTED` block lists every step, in order, as `done` (with the new version id, or "applied (they stay)"), `not done` ("unchanged (the previous version)"), `FAILED` or `UNKNOWN`. A Worker whose deploy finished has its secrets' hashes recorded as usual.

---

## 6. The secrets file

### 6.1 `.secrets`

One file, one section per Worker, `NAME=value` lines (the value is the rest of the line; surrounding quotes are removed; `#` starts a comment line):

```ini
[site]
ICAL_URL=https://calendar.google.com/calendar/ical/.../basic.ics https://...

[accounts]
RESEND_API_KEY=re_...
ACCOUNTS_KEY=...
```

- `.secrets.example` (committed, empty values) is the template; `./ft secrets --set` and `--generate` start from it.
- Gitignored with `.secrets` and `.secrets.*` (except `.secrets.example`); a test runs `git check-ignore` on `.secrets`, `.secrets.hashes` and another `.secrets.*` name, and deploy checks it again before reading any value.
- Unknown sections, lines outside a section and lines that aren't `NAME=value` are reported with their line numbers and stop a deploy.
- **Why not `.dev.vars`:** `.dev.vars` is wrangler's file for **local** values, and both Workers' configs share the repository root, so wrangler would load production values into `wrangler dev` too. Keeping production values apart means `./ft start` never sees them.

### 6.2 `ACCOUNTS_KEY`

Encrypted calendar addresses (accounts phase 2) can only be read with the key they were written with. So: `--generate` refuses if a value exists; `--set` refuses it once it's in `.secrets` or has been deployed; and deploy stops (`secret-rotate`) if the local value's hash differs from the one recorded at the last deploy, with "Put the deployed value back in .secrets. Rotating it needs a plan (and code) first." Back it up somewhere safe: if `.secrets` is lost, the key is lost. Without `.secrets.hashes` (a new machine), ft can't tell, and treats it as "first time through ft".

---

## 7. What carries over from Mite Spotter, and what doesn't

Read: `planning.md` on `main` (§ "Sprint 0: Backend", the developer tools and Scheduled Jobs) and on `sprint/0-backend` (the updated plan, which adds Accounts & Authentication, Deployment on Cloudflare, Migrations and Testing & CI), plus that branch's `README.md`, `.env.example`, `deploy/wrangler.toml`, `tests/test_spec.py` and `.github/workflows/test.yml`. There are no `m-` script files on either branch: the commands exist only as a list in the plan.

| Mite Spotter | freetime `ft` |
|---|---|
| `minstall`, `mstart`, `mtest`, `mhelp`, …: one prefix, short verbs | Same verbs, as subcommands of `./ft`. |
| The sprint 0 branch trims the list: "the rest are added when needed, not promised" | Each command earns its place; `madduser`, `mclean` and `mhttps` don't (§8). |
| Integrity check before a snapshot; "if any of these fail, assume there is a bug and manual intervention is required" | Pre-flight before any write; any FAIL stops; no retries, no automatic rollback, no restarts in `start`. |
| Backups verified by restoring them into a sandbox | `wrangler deploy --dry-run` builds both Workers, secrets included, before the real deploy. |
| Digest and heartbeat at the end of every job | The deploy summary and smoke checks, and `./ft status`. (A scheduled heartbeat is `W2M-SPEC.md` phase 3.) |
| `.env.example` with a `REPLACE_URL` placeholder | `.dev.vars.example`, `.secrets.example` and the zeros `database_id`: ft detects placeholders and says what to do. |
| Secrets only in the environment, never committed | Secrets only in the gitignored `.secrets`, sent on stdin (§2.3). |
| Spec-sync tests (`tests/test_spec.py`) | Spec-sync tests check the command table, exit codes and check codes in this file against ft (§11). |
| `uv`, Python, Postgres, Alembic, systemd, a VPS, `cloudflared`, CI coverage | Not relevant: two Workers, D1 and wrangler, deployed from Maxence's machine. |

---

## 8. Commands left out, and why

| Command | Why not |
|---|---|
| `check` | It would be `test` plus half of `status`. |
| `clean` / reset the local database | Deleting `.wrangler/state` throws away local accounts. ft never deletes. |
| `adduser` (`madduser`) | Sign-up works locally with emails printed in the terminal. |
| `https` (`mhttps`) | `http://localhost` is already a secure context for cookies. |
| `migrate` | Migrations are applied by `install`, `start` and `deploy`. |
| `rollback` | A decision, not a routine. ft prints the command when it's the next step. |
| `login` | One wrangler command, run once. |

---

## 9. One-time setup: guided, never done silently

| Step | How ft notices it's missing | What it prints |
|---|---|---|
| Cloudflare login | `wrangler whoami` | "npx wrangler login" |
| Zone on Cloudflare and the proxied `freetime` DNS record | The host doesn't resolve (`dns`) | README, Deploy |
| The site's custom domain removed (the switch to a zone route) | Only after a deploy: `/account` answered by the site (§5.5) | the custom-domain hint |
| D1 database created and its id pasted | Top-level `database_id` is all zeros (`status` prints the existing database's id and the line to paste, when it can) | "npx wrangler d1 create freetime-accounts", then the line |
| Id points at the wrong database | Not in `wrangler d1 list`, or another name | both values |
| Resend sending domain verified | ft can't ask Resend; `status` looks for `resend._domainkey.<domain>` TXT **(unverified record name)**, a `warn` only. The real proof is the manual email check | README, Deploy |
| Secret values | `.secrets` (§6) | `./ft secrets --set NAME`, `--generate ACCOUNTS_KEY` |
| `.dev.vars` for `--live` | §3.1 | "Copy .dev.vars.example to .dev.vars …" |

**The first switch from custom domain to zone route:** if the site was never deployed, add the record, then `./ft deploy`. If it's live on a custom domain: `./ft deploy` (the site keeps answering on its custom domain, and the smoke check reports `/account` answered by the site: exit 4, expected this once); then in the dashboard remove the custom domain and at once add the record **(unverified how long the gap is)**; then `./ft status`.

---

## 10. Check and failure codes

| Code | Meaning |
|---|---|
| `node` | Node is older than 20 |
| `deps` | `node_modules` doesn't match the lock file |
| `local-db` | The local database's migrations couldn't be applied or listed |
| `ports` | A local port is in use |
| `dev-vars` | `.dev.vars` missing or still the example (only for `--live`) |
| `tree` | Uncommitted or untracked changes |
| `branch` | Not on `main` without `--allow-branch`; or not pushed (a warning) |
| `commit` | The commit being looked at (`status`, information only) |
| `tests`, `typecheck` | The gate failed |
| `build` | `wrangler deploy --dry-run` failed |
| `secrets-file` | `.secrets` missing, incomplete, malformed, or not ignored by git |
| `secret-rotate` | `ACCOUNTS_KEY` differs from the one deployed |
| `secrets` | Secret names on Cloudflare (`status`, `secrets`) |
| `migration-safety` | A pending migration removes or renames data |
| `login` | Not logged in to Cloudflare |
| `database-id` | Placeholder, unknown or wrong `database_id` |
| `resend-from`, `resend-dns` | `RESEND_FROM` not set; no DKIM record found |
| `remote-db` | Pending remote migrations, or the list couldn't be read |
| `dns` | The host doesn't resolve |
| `smoke` | A live check failed (each failing check is printed as `smoke <number>`, from §5.5) |
| `FT_INTERNAL` | A bug in ft |

---

## 11. Testing the script

Tests for ft run in Node, in a third Vitest project, `scripts` (`test/scripts/*.test.mjs`), next to `site` and `accounts`, so `npm test` runs everything. Every command gets its runner, clock, `fetch`, DNS, port checks and prompts as parameters, so tests give it fakes: a runner that records every call (stdin included) and returns canned output, captured from wrangler 4.154.0 where possible (`test/scripts/fixtures/`). **No test runs the real wrangler or touches the network.** Tests that need a repository use a throwaway copy of the configs and migrations in a temp directory, never the real `.secrets`.

- **Arguments and help:** every command and flag; unknown ones exit 2; every flag is in its help; did-you-mean.
- **Spec sync:** §3's command table, §2.2's exit codes and §10's codes match ft.
- **PRINTED OUTPUT:** every message in `messages.mjs` has a marker; no other module prints.
- **Config readers** on the real files; the Worker names; the required secrets vs `Env` and `AccountsEnv`; the router's path table.
- **Allow-list:** each forbidden command is refused by the real and the guarded runner; only `run.mjs` imports `node:child_process`; children's environment has no secrets.
- **Secrets:** gitignored (real `git check-ignore`); never mentioned in `src/` or `public/`; parsing and editing keep comments; `--generate` makes 32 bytes, mode 600, never printed, refuses to replace; `--set` sends the value on stdin only; `ACCOUNTS_KEY` is never replaced; hashes never contain values; redaction.
- **Parsers:** `whoami` (logged out: captured; logged in: **unverified wording**), `migrations list` (captured), `secret list` (a planted value is dropped), `d1 list`, `deployments list`, the deploy output.
- **Migration safety:** each unsafe statement stops; additive ones and the repository's own migrations pass.
- **Deploy flows:** `--dry-run` makes no write; `--only site` makes no D1 or accounts call; each pre-flight failure stops before any write with its exit code; the writes happen in order with each Worker's secrets as JSON on stdin; a failure at each write gives its row of §5.6; no secret value appears in any output or argument.
- **Smoke:** healthy responses pass; each missing header, a cookie, the wrong Worker and a 503's reference; retries end on a fake clock.
- **Start:** fake children: prefixed lines, SIGINT → SIGTERM → SIGKILL, SIGTERM and SIGHUP give 143 and 129, one stopping stops the other and shows its last lines, a Worker failing while starting ends the readiness wait at once, one never answering stops both, a signal during the local migration starts nothing, the router closes with a keep-alive connection open and frees its port, busy ports stop before anything starts, `--port-offset`, `--live` without `.dev.vars`.
- **Lifecycle** (§2.6): each signal stops every child's group and exits with its code; a child ignoring SIGINT and SIGTERM gets SIGKILL and nothing hangs; a second signal kills everything and exits at once (and only once); a command handling the signal is left to do its own stopping; the 30 s force; an uncaught error stops the children and exits 1; a child's group is swept when its leader exits; process exit SIGKILLs what's left. With **real processes** (a stub shell script in place of wrangler, in a temp directory: no wrangler, no network): SIGTERM stops a child and the grandchild it started, also when both ignore SIGINT and SIGTERM. `./ft test` stopped by a signal runs nothing more and says so.
- **Deploy interrupted:** during the checks nothing is written or reported as failed; at the question; during the accounts deploy it finishes that write, never starts the site's, and lists each step; during the migration by SIGTERM (143); a second signal marks the running write `UNKNOWN`; during the live checks (129). The router with two real local HTTP servers: method, path, body, `Host`, `Origin` and several `Set-Cookie` pass through; a dead upstream gives a 502.

**Run for real in the build session:** `./ft help`, `./ft install` (deps matched, so no `npm ci`), `./ft test`, `./ft start` (busy ports reported while another checkout's dev servers were running; then `--port-offset 100`: both Workers and the router started, the router checks of §3.2.1 passed, Ctrl+C stopped everything and freed the ports), `./ft status --offline`, and `./ft deploy --dry-run` up to its first checks (it stops on the placeholder `database_id`, no `.secrets` and no login, as it should).

**Stopping, run for real** (§2.6), each time checking afterwards that no `wrangler` or `workerd` process was left (`pgrep -f`) and that 8780, 8787, 8788, 9229 and 9230 could be bound again. `./ft start` in the background, then: SIGTERM (exit 143, gone in under 0.5 s), SIGINT (130), SIGHUP (129; before, everything was left running), two SIGINTs (130), Ctrl+C typed into a real terminal (through `script`; 130), `pkill -f "port 8788"` (exit 1, "accounts stopped unexpectedly (exit 143)" and its last lines), SIGKILL to the accounts wrangler only (exit 1, "exit 137"), and port 8788 taken just after ft's port check (wrangler's "Address already in use" shown, exit 1 after 3 s; before, 64 s). `./ft test` stopped by SIGTERM and by SIGINT: 143 and 130, no npm or vitest left. `./ft deploy --dry-run --allow-branch` stopped by SIGTERM during its checks: 143, "Stopped by SIGTERM before any write". Zombie `workerd` entries (`<defunct>`: dead, holding no port) can show for a second or two while this container's init reaps them.

---

## 12. Decisions

Anything not checked against current documentation is marked **(unverified)**.

| Chosen | Alternatives | Why | Would change my mind |
|---|---|---|---|
| `./ft` with subcommands | `deploy`, `run`, separate `m`-style commands | §1.1; Maxence agreed. | — |
| A Node script (`.mjs`, JSDoc types), standard library only, behind a 5-line `sh` shim | A POSIX shell script; TypeScript | Processes, prefixed lines, signals, an HTTP router, JSON and `fetch` are simple in Node. Node 20 can't run `.ts` without a dependency. Not typechecked by `tsc` (that would need `@types/node`); the tests cover it instead. | Node gaining stable TypeScript at the project's minimum version. |
| Wrangler from `node_modules/.bin`, never `npx` | `npx wrangler` | The pinned version, always. | — |
| `npm ci` only when `node_modules` doesn't match | Always `npm ci` | `npm ci` deletes `node_modules` first, breaking running dev servers and shared checkouts. | — |
| Production secrets in one gitignored `.secrets`, a section per Worker | `.dev.vars` per Worker; one file per Worker; prefixed names | One file is easy to back up; sections keep each Worker's values apart; `.dev.vars` would leak production values into local dev (§6.1). | — |
| Secrets sent with each deploy (`--secrets-file /dev/stdin`), every time | `wrangler secret put` per secret, only when changed | Code and secrets go live together; no extra versions; nothing on disk but `.secrets`; stdin, never arguments. Sending all of them each time is free and corrects drift. | A real upload rejecting `/dev/stdin` (then a mode-600 temp file, deleted at once). |
| Keyed hashes of deployed values in `.secrets.hashes` | No change detection; storing values | The plan says what changes; `ACCOUNTS_KEY` can't be rotated by accident. | — |
| `ACCOUNTS_KEY` required from now on | Required only from phase 2 | It must exist before phase 2 deploys, and generating it is one command. | — |
| Deploy order: migrations, accounts, site, checks | Site first; parallel | §5.3 | — |
| No automatic rollback; exit 4 and printed next steps | Roll back on smoke failure | Nothing self-heals; a guessed rollback is a second unreviewed change. | — |
| No `--skip-tests`, no `--force` | Escape hatches | The gate exists to stop those deploys. | Tests becoming slow. |
| Only additive migrations through ft; destructive ones by hand | A typed confirmation | Removing data deserves a human reading the SQL at a terminal. | — |
| Local router on :8780 | Make :8787 the router; change the Workers | Matches production routing with no change to either Worker; confirmed working. | — |
| Smoke checks tell the Workers apart by content | A response header | No code change to either Worker. | Content checks proving flaky. |
| `main` only, unless `--allow-branch` | Any branch; `main` only, no flag | Deploying a branch before merging is real (accounts phase 1), but should be a choice. | — |
| Not pushed: a warning | Stop | Maxence deploys from their machine and may push after. | — |
| `deploy:accounts` removed | Keep as an alias | Two deploy paths, one without checks. | — |
| `--port-offset` | Fixed ports only | Two checkouts or worktrees at once (found while building). | — |

---

## 13. Open items

All settled. Maxence's answers to the first draft, and how the rest were settled:

1. **Name:** `./ft` (Maxence).
2. **Secrets:** ft handles values, never in the client (Maxence); `.secrets` and §2.3, §6.
3. **Branches:** `main`, or `--allow-branch` (the spec's recommendation).
4. **Unpushed commits:** a warning (recommendation).
5. **Router:** port 8780, listed first in the Ready block (recommendation; confirmed working).
6. **Types for the script:** no `@types/node`; JSDoc for readers, tests for checking (recommendation: no new dependency).
7. **Migration safety:** the list in §5.2; destructive migrations only by hand (recommendation).
8. **`deploy:accounts`:** removed (recommendation).

New questions go here. Until then, choose the simplest option that keeps production unchanged on failure, and note it in §12.

---

## 14. Definition of done (per phase)

- **Phase 1 (done):** `./ft`, `npm run ft`, `help`, `install` and `test` as §3; exit codes as §2.2; PRINTED OUTPUT markers on every string; the `scripts` Vitest project; the name lock covers `scripts/`; README "Run it locally" leads with `./ft`.
- **Phase 2 (done):** `start` and the router as §3.2, run in the build session.
- **Phase 3 (built):** `deploy`, `status`, `secrets` and `logs` as §3–§6, tested through the fake runner and `--dry-run`; README Deploy rewritten around `./ft`, with the raw commands as a fallback appendix; `deploy:accounts` removed. **Still to do, by Maxence:** run `./ft deploy --dry-run`, then one real `./ft deploy`, and confirm the (unverified) wrangler behaviour in §5.4 (secrets from `/dev/stdin`, a remote migration without a terminal, the version id line, the logged-in `whoami` and `deployments list --json` shapes).
