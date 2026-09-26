import { ipcMain } from "electron";
import type {
  AgentSubmitRequest,
  AgentSubmitResult,
} from "../../shared/ipc/agent.js";
import {
  AGENT_ABORT_CHANNEL,
  AGENT_SUBMIT_CHANNEL,
} from "../../shared/ipc/channels.js";
import type { AgentService } from "../agent/agent-service.js";

/**
 * IPC glue: maps contract channels to AgentService calls. No business
 * logic — if a handler grows beyond a mechanical mapping, the logic
 * belongs in a service.
 */
export function registerAgentIpc(service: AgentService): void {
  ipcMain.handle(
    AGENT_SUBMIT_CHANNEL,
    (_event, request: AgentSubmitRequest): Promise<AgentSubmitResult> =>
      service.submit(request),
  );

  ipcMain.handle(AGENT_ABORT_CHANNEL, (): void => service.abort());
}
