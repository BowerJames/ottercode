import type { GitStatusResult } from "../../shared/ipc/git.js";

/**
 * The git seam. Everything git-status interpretation knows about git
 * is this runner; adapters satisfy it. Two adapters — the real one
 * spawning `git` (real-git-runner) and the in-memory fake (tests) —
 * make this a real seam.
 *
 * Adapter contract:
 * - Runs `git` with `args` in `cwd` and resolves its outcome —
 *   including non-zero exits (git reports "not a repository" and the
 *   like through exit codes, so they are results, not errors).
 * - Throws only when git could not be run at all (binary missing,
 *   spawn failure) — the service maps that to "unavailable".
 */
export type GitRunOutcome = {
  code: number;
  stdout: string;
  stderr: string;
};

export type GitRunner = (
  cwd: string,
  args: readonly string[],
) => Promise<GitRunOutcome>;

/**
 * Reads the workspace's branch: `git branch --show-current` at the
 * root, interpreted. Exit 0 names the branch (empty output = detached
 * HEAD → no branch to name); git's "not a git repository" failure is
 * a normal state (branch: null), not an error — a workspace without a
 * repo renders no branch, same as a detached one.
 */
export async function readGitStatus(
  root: string,
  run: GitRunner,
): Promise<GitStatusResult> {
  try {
    const outcome = await run(root, ["branch", "--show-current"]);
    if (outcome.code === 0) {
      return { ok: true, branch: outcome.stdout.trim() || null };
    }
    if (outcome.code === 128 && /not a git repository/i.test(outcome.stderr)) {
      return { ok: true, branch: null };
    }
    return { ok: false, error: { code: "unknown" } };
  } catch {
    return { ok: false, error: { code: "unavailable" } };
  }
}
