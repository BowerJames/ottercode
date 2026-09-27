import { describe, expect, it } from "vitest";
import type {
  GitRunner,
  GitRunOutcome,
} from "../../../src/main/workspace/git-status.js";
import { readGitStatus } from "../../../src/main/workspace/git-status.js";

/**
 * Permanent suite. Consumers: register-git-ipc's delegation and the
 * GitBar's render (branch shown / bar hidden). The outcomes below are
 * the contract's discrimination — which git facts become a branch
 * name, which become "no branch", and which become failures.
 */

/** A runner that always returns one outcome, recording its calls. */
function fakeRunner(outcome: GitRunOutcome): {
  run: GitRunner;
  calls: Array<{ cwd: string; args: readonly string[] }>;
} {
  const calls: Array<{ cwd: string; args: readonly string[] }> = [];
  return {
    calls,
    async run(cwd, args) {
      calls.push({ cwd, args });
      return outcome;
    },
  };
}

const NOT_A_REPO = {
  code: 128,
  stdout: "",
  stderr:
    "fatal: not a git repository (or any of the parent directories): .git",
};

describe("readGitStatus", () => {
  it("names the branch for a repository", async () => {
    const { run, calls } = fakeRunner({
      code: 0,
      stdout: "feature/thinking\n",
      stderr: "",
    });

    const result = await readGitStatus("/ws", run);

    expect(result).toEqual({ ok: true, branch: "feature/thinking" });
    // The read is anchored to the workspace root — the interface's
    // promise — not to any particular git invocation.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.cwd).toBe("/ws");
  });

  it("reports no branch for a detached HEAD (empty output)", async () => {
    const { run } = fakeRunner({ code: 0, stdout: "", stderr: "" });

    const result = await readGitStatus("/ws", run);

    expect(result).toEqual({ ok: true, branch: null });
  });

  it("treats 'not a git repository' as a normal no-branch state, not an error", async () => {
    const { run } = fakeRunner(NOT_A_REPO);

    const result = await readGitStatus("/ws", run);

    expect(result).toEqual({ ok: true, branch: null });
  });

  it("maps a failed spawn (no git binary) to a failed read", async () => {
    const run: GitRunner = async () => {
      throw Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" });
    };

    const result = await readGitStatus("/ws", run);

    // Failure shape only, not the code: the store collapses every
    // failure to a hidden bar — the code distinction has no consumer
    // (unlike fs codes, which the editor's error surface branches on).
    expect(result.ok).toBe(false);
  });

  it("maps any other git failure to a failed read", async () => {
    const { run } = fakeRunner({
      code: 128,
      stdout: "",
      stderr: "fatal: detected dubious ownership in repository",
    });

    const result = await readGitStatus("/ws", run);

    expect(result.ok).toBe(false);
  });
});
