/**
 * The fs domain of the IPC contract. These types are contract-owned:
 * payloads crossing the process boundary are these shapes, never raw
 * Node or pi types.
 */

/** A single node in the workspace file tree. */
export type FileEntry = {
  /** Display name — the basename, e.g. "package.json". */
  name: string;
  /** Absolute, normalized path. This is the node's identity. */
  path: string;
  /** Directories are expandable; files are inert leaves (for now). */
  kind: "file" | "directory";
};

/** Request for FS_LIST_CHILDREN_CHANNEL. */
export type ListChildrenRequest = {
  /** Absolute path of the directory to list. */
  path: string;
};

/** Response for FS_ROOT_CHANNEL: where the tree starts. */
export type RootResult = {
  /** Absolute workspace root path. v1: process.cwd(). */
  root: string;
};

/**
 * Failure modes of a directory listing. Deliberately part of the payload,
 * not thrown: Electron's invoke mangles thrown errors, and consumers need
 * to discriminate outcomes.
 */
export type FsListError =
  /** Path doesn't exist — e.g. deleted since it was rendered. */
  | { code: "not-found" }
  /** Path exists but is a file. */
  | { code: "not-a-directory" }
  | { code: "permission-denied" }
  | { code: "unknown" };

/** Response for FS_LIST_CHILDREN_CHANNEL. */
export type ListChildrenResult =
  | {
      ok: true;
      /**
       * Direct children of the listed directory, sorted for display
       * convenience (directories first, then files, case-insensitive).
       * The sort is policy, not obligation: it may change and is
       * deliberately not pinned by tests.
       */
      entries: FileEntry[];
    }
  | { ok: false; error: FsListError };
