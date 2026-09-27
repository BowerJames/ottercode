import { ipcMain } from "electron";
import { GIT_STATUS_CHANNEL } from "../../shared/ipc/channels.js";
import type { GitStatusResult } from "../../shared/ipc/git.js";

/**
 * IPC glue: maps the contract channel to a git-status read. No
 * business logic — the caller binds root and runner (readGitStatus);
 * if this handler grows beyond a mechanical mapping, the logic
 * belongs in workspace/.
 */
export function registerGitIpc(status: () => Promise<GitStatusResult>): void {
  ipcMain.handle(GIT_STATUS_CHANNEL, (): Promise<GitStatusResult> => status());
}
