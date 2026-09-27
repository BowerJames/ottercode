/**
 * The git domain of the IPC contract: the workspace's repository
 * state. Payloads are contract-owned — never raw git output beyond
 * the fields extracted from it.
 */

/** Response for GIT_STATUS_CHANNEL. */
export type GitStatusResult =
  | {
      ok: true;
      /**
       * The current branch name. Null when there is no branch to
       * name — the workspace is not a git repository, or HEAD is
       * detached. Consumers render the branch and hide otherwise.
       */
      branch: string | null;
    }
  | {
      ok: false;
      error: {
        /** git is not installed or could not be spawned; or it ran
         * but failed in a way that names no branch. */
        code: "unavailable" | "unknown";
      };
    };
