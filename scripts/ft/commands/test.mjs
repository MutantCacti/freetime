// ./ft test (DEV-SPEC.md §3.3): the same gate deploy uses.
import { depsState } from "../checks.mjs";
import { M } from "../messages.mjs";

/** @param {import("../cli.mjs").Ctx} ctx */
export async function run({ out, runner, flags, root }) {
  if (!depsState(root).ok) {
    out.check("fail", "deps", M.common.needInstall);
    return 1;
  }
  const only = flags.only;
  const tests = await runner.interactive("npm", only ? ["test", "--", "--project", only] : ["test"]);
  const typecheck = only ? null : await runner.interactive("npm", ["run", "typecheck"]);
  out.text("");
  out.check(tests === 0 ? "ok" : "fail", "tests", tests === 0 ? M.test.passed(only) : M.test.failed);
  if (typecheck === null) out.check("skip", "typecheck", M.test.typecheckSkipped);
  else out.check(typecheck === 0 ? "ok" : "fail", "typecheck", typecheck === 0 ? M.test.typecheckPassed : M.test.typecheckFailed);
  return tests === 0 && (typecheck ?? 0) === 0 ? 0 : 1;
}
