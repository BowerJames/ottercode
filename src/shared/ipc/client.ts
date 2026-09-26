import {
  FS_LIST_CHILDREN_CHANNEL,
  FS_READ_FILE_CHANNEL,
  FS_ROOT_CHANNEL,
} from "./channels.js";
import type {
  ListChildrenRequest,
  ListChildrenResult,
  ReadFileRequest,
  ReadFileResult,
  RootResult,
} from "./fs.js";

/**
 * The transport seam. The real adapter is preload's ipcRenderer bridge;
 * the test adapter is an in-memory fake. Channel-name strings and payload
 * assembly live here and nowhere else on the renderer side — both sides
 * of the wire share the same constants and types, so contract wiring
 * drift is a compile error, not a runtime failure.
 */
export type Invoke = (channel: string, request: unknown) => Promise<unknown>;

/** The only door the renderer uses to reach the main process. */
export interface OttercodeClient {
  fs: {
    root(): Promise<RootResult>;
    listChildren(path: string): Promise<ListChildrenResult>;
    readFile(path: string): Promise<ReadFileResult>;
  };
}

export function createClient(invoke: Invoke): OttercodeClient {
  return {
    fs: {
      root() {
        // The cast is the one crossing of Electron's untyped wire: safe
        // because the glue handler is compiled against the same types.
        return invoke(FS_ROOT_CHANNEL, {}) as Promise<RootResult>;
      },
      listChildren(path: string) {
        // Typed construction: a malformed request is a compile error.
        const request: ListChildrenRequest = { path };
        return invoke(
          FS_LIST_CHILDREN_CHANNEL,
          request,
        ) as Promise<ListChildrenResult>;
      },
      readFile(path: string) {
        const request: ReadFileRequest = { path };
        return invoke(FS_READ_FILE_CHANNEL, request) as Promise<ReadFileResult>;
      },
    },
  };
}
