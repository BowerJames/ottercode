import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitRunner } from "./git-status.js";

/**
 * The production adapter for the GitRunner seam: the only place git
 * gets spawned. execFile rejects on non-zero exits with the outcome
 * attached (numeric code, captured stdout/stderr) — those are turned
 * back into results; anything else (ENOENT — no git binary, spawn
 * failure) propagates as the seam's "couldn't run git" throw. Real-
 * boundary code, verified by running the app, not by unit tests.
 */
const execFileAsync = promisify(execFile);

export const realGitRunner: GitRunner = async (cwd, args) => {
  try {
    const { stdout, stderr } = await execFileAsync("git", [...args], {
      cwd,
      encoding: "utf8",
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const outcome = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    if (typeof outcome.code === "number") {
      return {
        code: outcome.code,
        stdout: outcome.stdout ?? "",
        stderr: outcome.stderr ?? "",
      };
    }
    throw error; // git never ran — binary missing or spawn failure
  }
};
