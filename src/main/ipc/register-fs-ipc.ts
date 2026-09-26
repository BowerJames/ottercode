import { ipcMain } from "electron";
import {
  FS_LIST_CHILDREN_CHANNEL,
  FS_READ_FILE_CHANNEL,
  FS_ROOT_CHANNEL,
} from "../../shared/ipc/channels.js";
import type {
  ListChildrenRequest,
  ListChildrenResult,
  ReadFileRequest,
  ReadFileResult,
  RootResult,
} from "../../shared/ipc/fs.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";

/**
 * IPC glue: maps contract channels to WorkspaceService calls. No business
 * logic — if a handler grows beyond a mechanical mapping, that logic
 * belongs in a service.
 */
export function registerFsIpc(service: WorkspaceService): void {
  ipcMain.handle(
    FS_ROOT_CHANNEL,
    (): RootResult => ({ root: service.getRoot() }),
  );

  ipcMain.handle(
    FS_LIST_CHILDREN_CHANNEL,
    (_event, request: ListChildrenRequest): Promise<ListChildrenResult> =>
      service.listChildren(request.path),
  );

  ipcMain.handle(
    FS_READ_FILE_CHANNEL,
    (_event, request: ReadFileRequest): Promise<ReadFileResult> =>
      service.readFile(request.path),
  );
}
