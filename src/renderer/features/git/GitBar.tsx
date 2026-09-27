import { useEffect } from "react";
import { useGit } from "./use-git";

/**
 * The workspace's git footer, docked to the left pane's bottom.
 * Bootstraps itself on mount (load) and renders the current branch —
 * or nothing at all: no repo, detached HEAD, and a failed read all
 * hide the bar (branch null collapses to no UI, by design).
 */
export function GitBar() {
  const branch = useGit((s) => s.branch);
  const load = useGit((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  if (branch === null || branch === undefined) return null;

  return (
    <footer className="sidebar-git" title={`git branch: ${branch}`}>
      <span aria-hidden>⎇</span> {branch}
    </footer>
  );
}
