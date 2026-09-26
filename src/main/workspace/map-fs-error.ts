import type { FsError } from "../../shared/ipc/fs.js";

/**
 * Maps a seam error (Node-style: carries a string `code`) to the
 * contract's error value. Total: any input yields a value — the service
 * relies on that totality to keep its "failures come back as values"
 * promise.
 */
export function mapFsError(error: unknown): FsError {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (typeof code === "string") {
      return codeToError(code);
    }
  }
  return { code: "unknown" };
}

function codeToError(code: string): FsError {
  switch (code) {
    case "ENOENT":
      return { code: "not-found" };
    case "ENOTDIR":
      return { code: "not-a-directory" };
    case "EISDIR":
      return { code: "is-a-directory" };
    case "EACCES":
      return { code: "permission-denied" };
    default:
      return { code: "unknown" };
  }
}
