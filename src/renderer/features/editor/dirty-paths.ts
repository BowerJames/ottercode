import type { WorkingCopy } from "./store";

/**
 * The dirty predicate's named home for UI consumers: which working
 * copies have diverged from their load-time snapshot, by path, sorted
 * (deterministic — the file tree's shallow-equality subscription
 * depends on the order being stable across notifications, so editing
 * an already-dirty file causes no re-render). Divergence, not history:
 * a copy edited back to identical content is clean. The chat feature's
 * collect-edits is the sibling consumer of the same predicate on the
 * attachment seam; neither imports the other — both stay replaceable.
 */
export function dirtyPaths(
  workingCopies: Record<string, WorkingCopy>,
): string[] {
  return Object.entries(workingCopies)
    .filter(([, copy]) => copy.content !== copy.original)
    .map(([path]) => path)
    .sort();
}
