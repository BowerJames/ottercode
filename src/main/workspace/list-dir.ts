/**
 * The fs seam. Everything WorkspaceService knows about the disk is this
 * one function type. Two adapters satisfy it — the real one wrapping
 * node:fs (production) and the in-memory fake (tests) — which is what
 * makes this a real seam rather than a hypothetical one.
 */

/** One child of a directory, as far as the workspace cares. */
export type DirChild = {
  name: string;
  kind: "file" | "directory";
};

/**
 * Lists the direct children of a directory.
 *
 * Adapter contract:
 * - Returns every direct child of `dirPath`. Order is unspecified —
 *   the service owns presentation order.
 * - Throws an Error carrying a Node-style string `code` on failure:
 *   "ENOENT" (path doesn't exist), "ENOTDIR" (path is a file),
 *   "EACCES" (no permission), and any other code the platform yields.
 * - kind is "directory" iff the entry is a directory; everything else
 *   (including symlinks, which are NOT followed) reads as "file".
 */
export type ListDir = (dirPath: string) => Promise<DirChild[]>;
