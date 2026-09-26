/**
 * The fs seam. Everything WorkspaceService knows about the disk is this
 * small interface; adapters satisfy it. Two adapters exist — the real
 * one wrapping node:fs (production) and the in-memory fake (tests) —
 * which is what makes this a real seam rather than a hypothetical one.
 */

/** One child of a directory, as far as the workspace cares. */
export type DirChild = {
  name: string;
  kind: "file" | "directory";
};

/**
 * Adapter contract:
 * - listDir returns every direct child of `dirPath`. Order is
 *   unspecified — the service owns presentation order.
 * - readFile returns the file's text, decoded as UTF-8, VERBATIM — no
 *   truncation, no normalization of line endings or unicode. The decode
 *   is adapter-owned; downstream (the agent flow) depends on the buffer
 *   matching the disk bytes.
 * - Both throw Errors carrying Node-style string `code`s on failure:
 *   ENOENT, ENOTDIR (listing a file), EISDIR (reading a directory),
 *   EACCES, and any other code the platform yields.
 * - kind is "directory" iff the entry is a directory; everything else
 *   (including symlinks, which are NOT followed) reads as "file".
 */
export type WorkspaceFs = {
  listDir(dirPath: string): Promise<DirChild[]>;
  readFile(filePath: string): Promise<string>;
};
