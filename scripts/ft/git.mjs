// Read-only git facts: branch, commit, clean or not, pushed or not.

/**
 * @param {import("./run.mjs").Runner} runner
 */
export async function gitInfo(runner) {
  const status = await runner.capture("git", ["status", "--porcelain"]);
  const branch = await runner.capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  const head = await runner.capture("git", ["log", "-1", "--format=%h%x09%s"]);
  const upstream = await runner.capture("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  let ahead = null;
  if (upstream.code === 0) {
    const count = await runner.capture("git", ["rev-list", "--count", "@{u}..HEAD"]);
    if (count.code === 0) ahead = Number(count.stdout.trim());
  }
  const [sha = "", subject = ""] = head.stdout.trim().split("\t");
  return {
    ok: status.code === 0 && branch.code === 0 && head.code === 0,
    clean: status.code === 0 && status.stdout.trim() === "",
    changed: status.stdout.split("\n").filter(Boolean).length,
    branch: branch.stdout.trim(),
    sha,
    subject,
    upstream: upstream.code === 0 ? upstream.stdout.trim() : null,
    ahead,
  };
}

/** How many commits `sha` is behind HEAD, or null if it isn't in this history. */
/** @param {import("./run.mjs").Runner} runner @param {string} sha */
export async function commitsBehind(runner, sha) {
  const r = await runner.capture("git", ["rev-list", "--count", `${sha}..HEAD`]);
  return r.code === 0 ? Number(r.stdout.trim()) : null;
}

/** Whether git ignores a path (it must, for `.secrets`). */
/** @param {import("./run.mjs").Runner} runner @param {string} path */
export async function isIgnored(runner, path) {
  const r = await runner.capture("git", ["check-ignore", "-q", path]);
  return r.code === 0;
}
