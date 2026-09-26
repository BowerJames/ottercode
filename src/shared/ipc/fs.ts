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
 * Failure modes of file operations. Deliberately part of the payload,
 * not thrown: Electron's invoke mangles thrown errors, and consumers
 * need to discriminate outcomes. One union for all fs channels — the
 * error surface treats codes uniformly, and the service's mapper feeds
 * every channel.
 */
export type FsErrorCode =
  /** Path doesn't exist — e.g. deleted since it was rendered. */
  | "not-found"
  /** Path exists but is a file (directory listing). */
  | "not-a-directory"
  /** Path is a directory (file read). */
  | "is-a-directory"
  | "permission-denied"
  /** Read content is not text (NUL within the first 8k characters). */
  | "binary"
  /** Read content exceeds the cap (policy; see WorkspaceService). */
  | "too-large"
  | "unknown";

export type FsError = { code: FsErrorCode };

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
  | { ok: false; error: FsError };

/** Request for FS_READ_FILE_CHANNEL. */
export type ReadFileRequest = {
  /** Absolute path of the file to read. */
  path: string;
};

/** Response for FS_READ_FILE_CHANNEL. */
export type ReadFileResult =
  | {
      ok: true;
      /**
       * The file's text, decoded as UTF-8 by the adapter and passed
       * through verbatim — no truncation, no normalization. The decode
       * is adapter-owned; the service owns not touching it.
       */
      content: string;
    }
  | { ok: false; error: FsError };
