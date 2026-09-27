import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { OttercodeClient } from "../../../shared/ipc/client";

/** The slice of the client the git feature depends on. */
export type GitStatusClient = Pick<OttercodeClient["git"], "status">;

export type GitState = {
  /**
   * The workspace's branch. Undefined until the first read lands
   * (loading); null when there is no branch to show — not a repo,
   * detached HEAD, or the read failed. The bar renders the string
   * and hides on null.
   */
  branch: string | null | undefined;
  /** Fetches the branch once; the bar calls it on mount. The promise
   * settles only after the store reflects the outcome. */
  load(): Promise<void>;
};

export type UseGitStore = UseBoundStore<StoreApi<GitState>>;

/**
 * Builds the git store over an injected client slice. Failure is not
 * state worth distinguishing — every failure mode hides the bar, so
 * it collapses to branch: null.
 */
export function createGitStore(git: GitStatusClient): UseGitStore {
  return create<GitState>()((set) => ({
    branch: undefined,

    async load() {
      const result = await git.status();
      set({ branch: result.ok ? result.branch : null });
    },
  }));
}
