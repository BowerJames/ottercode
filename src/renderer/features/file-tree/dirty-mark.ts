import type { FileEntry } from "../../../shared/ipc/fs";

/**
 * The tree's marking decision, pure path math: a file row is marked
 * iff its path is dirty; a directory row is marked iff some dirty path
 * lies strictly beneath it (prefix ending on a separator boundary —
 * `/ws/a` is not a parent of `/ws/ab`). Takes no tree state on
 * purpose: a collapsed, never-expanded directory is marked identically
 * to an open one — no childrenByDir lookups, no forcing loads. Both
 * separators count, so Windows-shaped trees mark the same as POSIX.
 */
export function isMarked(
  kind: FileEntry["kind"],
  path: string,
  dirty: ReadonlySet<string>,
): boolean {
  if (kind === "file") return dirty.has(path);
  const base =
    path.endsWith("/") || path.endsWith("\\") ? path.slice(0, -1) : path;
  for (const dirtyPath of dirty) {
    if (isBeneath(base, dirtyPath)) return true;
  }
  return false;
}

/** True iff `candidate` sits strictly inside `dir` (a descendant, not
 * the dir itself), on a separator boundary. */
function isBeneath(dir: string, candidate: string): boolean {
  if (candidate.length <= dir.length) return false;
  if (!candidate.startsWith(dir)) return false;
  const separator = candidate.charAt(dir.length);
  const rest = candidate.slice(dir.length + 1);
  return (separator === "/" || separator === "\\") && rest.length > 0;
}
