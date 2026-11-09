// ./ft: freetime's developer command (DEV-SPEC.md). Run through the ./ft shim
// or `npm run ft -- <command>`. Node's standard library only.
import { promises as dns } from "node:dns";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { main } from "./ft/cli.mjs";
import { HANDLED_SIGNALS, createLifecycle } from "./ft/lifecycle.mjs";
import { childEnv, createRunner } from "./ft/run.mjs";
import { allSecretNames } from "./ft/workers.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @param {string} host @param {number} port */
function canConnect(host, port) {
  return new Promise((done) => {
    const s = net.connect({ host, port });
    s.setTimeout(500);
    s.once("connect", () => (s.destroy(), done(true)));
    s.once("timeout", () => (s.destroy(), done(false)));
    s.once("error", () => done(false));
  });
}

/** @param {number} port */
function canListen(port) {
  return new Promise((done) => {
    const srv = net.createServer();
    srv.once("error", () => done(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => done(true)));
  });
}

// Output: a closed terminal or pipe (EPIPE, EIO) must not crash ft and orphan its
// children. Once stdout is gone, writes are dropped; SIGHUP or the reader's exit stops ft.
let stdoutGone = false;
process.stdout.on("error", () => void (stdoutGone = true));
/** @param {string} s */
const write = (s) => {
  if (stdoutGone) return;
  try {
    process.stdout.write(s);
  } catch {
    stdoutGone = true;
  }
};

const verbose = process.argv.includes("--verbose");

// The one lifecycle (DEV-SPEC.md §2.6): every child ft starts is tracked here, and
// every way ft can end (a signal, an error nothing caught, the process exiting)
// stops them first.
const life = createLifecycle({
  kill: (pid, sig) => process.kill(pid, sig),
  exit: (code) => {
    restoreTerminal();
    process.exitCode = code;
    // Let what's printed reach the terminal or pipe first, but never wait on a stuck reader.
    if (stdoutGone) process.exit(code);
    process.stdout.write("", () => process.exit(code));
    setTimeout(() => process.exit(code), 1_000).unref();
  },
  say: (s) => write(`${s}\n`),
  sleep,
  later: (fn, ms) => void setTimeout(fn, ms).unref(),
});
for (const sig of HANDLED_SIGNALS) process.on(sig, () => life.signal(sig));
process.on("uncaughtException", (e) => void life.crash(e, verbose));
process.on("unhandledRejection", (e) => void life.crash(e, verbose));
process.on("exit", () => {
  life.onExit();
  restoreTerminal();
});

/** A hidden prompt leaves the terminal in raw mode if ft stops during it. */
function restoreTerminal() {
  try {
    if (process.stdin.isTTY && process.stdin.isRaw) process.stdin.setRawMode(false);
  } catch {
    // No terminal any more.
  }
}

/** @param {string} question */
function ask(question) {
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => (rl.close(), done(answer)));
    rl.on("SIGINT", () => (rl.close(), process.stdout.write("\n"), done("")));
  });
}

/** Reads one line without echoing it. Null on Ctrl+C. @param {string} prompt */
function readHidden(prompt) {
  return new Promise((done) => {
    const stdin = process.stdin;
    process.stdout.write(prompt);
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    /** @param {string | null} result */
    const finish = (result) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stdout.write("\n");
      done(result);
    };
    /** @param {string} chunk */
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return finish(value);
        if (ch === "\u0003") return finish(null);
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

const code = await main(process.argv.slice(2), {
  root,
  write,
  color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
  runner: createRunner({ root, env: childEnv(process.env, allSecretNames()), track: life.track }),
  nodeVersion: process.versions.node,
  stdinIsTTY: Boolean(process.stdin.isTTY),
  ask,
  readHidden,
  fetch: globalThis.fetch,
  sleep,
  now: () => Date.now(),
  async resolves(host, type) {
    try {
      if (type === "TXT") return (await dns.resolveTxt(host)).length > 0;
      await dns.lookup(host);
      return true;
    } catch {
      return false;
    }
  },
  async portBusy(port) {
    if ((await canConnect("127.0.0.1", port)) || (await canConnect("::1", port))) return true;
    return !(await canListen(port));
  },
  async waitHttp(port, timeoutMs, signal) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end && !signal?.aborted) {
      try {
        await fetch(`http://127.0.0.1:${port}/`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(2_000)]) : AbortSignal.timeout(2_000) });
        return true;
      } catch {
        await sleep(300);
      }
    }
    return false;
  },
  onInterrupt: life.onInterrupt,
  interrupted: life.interrupted,
  stopChildren: life.stopAll,
});
// Always an explicit exit: nothing left open (a socket, a timer, a prompt) keeps ft
// running after the command is done, and anything still running is stopped first.
await life.end(code);
