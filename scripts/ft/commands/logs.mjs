// ./ft logs <site|accounts> (DEV-SPEC.md §3.6)
import { M } from "../messages.mjs";
import { whoami } from "../remote.mjs";
import { WORKERS } from "../workers.mjs";

/** @param {"site" | "accounts"} w @param {{ ref?: string, errors?: boolean }} o */
export function tailArgs(w, { ref, errors } = {}) {
  return ["tail", ...WORKERS[w].configArgs, "--format", "pretty", ...(ref ? ["--search", ref] : []), ...(errors ? ["--status", "error"] : [])];
}

/** @param {import("../cli.mjs").Ctx} ctx */
export async function run({ out, runner, flags, positionals }) {
  const w = /** @type {"site" | "accounts"} */ (positionals[0]);
  const who = await whoami(runner);
  if (!who.loggedIn) {
    out.check("fail", "login", who.loggedIn === false ? M.login.out : M.login.unknown, [M.login.howTo]);
    return 3;
  }
  out.text(M.logs.starting(WORKERS[w].name));
  return runner.interactive("wrangler", tailArgs(w, { ref: flags.ref, errors: flags.errors }));
}
