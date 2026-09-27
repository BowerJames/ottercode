import { ipcMain } from "electron";
import {
  TERMINAL_ABORT_CHANNEL,
  TERMINAL_RUN_CHANNEL,
} from "../../shared/ipc/channels.js";
import type {
  TerminalRunRequest,
  TerminalRunResult,
} from "../../shared/ipc/terminal.js";
import type { TerminalService } from "../terminal/terminal-service.js";

/**
 * IPC glue: maps contract channels to TerminalService calls. No
 * business logic — if a handler grows beyond a mechanical mapping,
 * the logic belongs in a service.
 */
export function registerTerminalIpc(service: TerminalService): void {
  ipcMain.handle(
    TERMINAL_RUN_CHANNEL,
    (_event, request: TerminalRunRequest): Promise<TerminalRunResult> =>
      service.run(request.command),
  );

  ipcMain.handle(TERMINAL_ABORT_CHANNEL, (): void => service.abort());
}
