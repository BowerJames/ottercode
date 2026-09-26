/**
 * IPC channel names, declared once. The renderer's typed client and the
 * main-process handlers both import these constants, so a mismatched
 * channel name is a compile error rather than a runtime mystery.
 */

/** Request/response: the workspace root the file tree starts from. */
export const FS_ROOT_CHANNEL = "fs:root";

/** Request/response: the direct children of one directory. */
export const FS_LIST_CHILDREN_CHANNEL = "fs:listChildren";
