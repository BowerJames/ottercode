import { ipcMain } from "electron";
import type {
  AgentProviderInfo,
  AgentReconfigResult,
  AgentSelectionSubmitRequest,
  AgentSetThinkingResult,
  AgentSubmitRequest,
  AgentSubmitResult,
  SetModelRequest,
  SetProviderRequest,
  SetThinkingLevelRequest,
} from "../../shared/ipc/agent.js";
import {
  AGENT_ABORT_CHANNEL,
  AGENT_NEW_CHAT_CHANNEL,
  AGENT_PROVIDER_CHANNEL,
  AGENT_SET_MODEL_CHANNEL,
  AGENT_SET_PROVIDER_CHANNEL,
  AGENT_SET_THINKING_CHANNEL,
  AGENT_SUBMIT_CHANNEL,
  AGENT_SUBMIT_SELECTION_CHANNEL,
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

  ipcMain.handle(
    AGENT_SUBMIT_SELECTION_CHANNEL,
    (
      _event,
      request: AgentSelectionSubmitRequest,
    ): Promise<AgentSubmitResult> => service.submitSelection(request),
  );

  ipcMain.handle(AGENT_ABORT_CHANNEL, (): void => service.abort());

  ipcMain.handle(
    AGENT_PROVIDER_CHANNEL,
    (): Promise<AgentProviderInfo> => service.getProviderInfo(),
  );

  ipcMain.handle(
    AGENT_SET_PROVIDER_CHANNEL,
    (_event, request: SetProviderRequest): Promise<AgentReconfigResult> =>
      service.setProvider(request.provider),
  );

  ipcMain.handle(
    AGENT_SET_MODEL_CHANNEL,
    (_event, request: SetModelRequest): Promise<AgentReconfigResult> =>
      service.setModel(request.model),
  );

  ipcMain.handle(
    AGENT_SET_THINKING_CHANNEL,
    (
      _event,
      request: SetThinkingLevelRequest,
    ): Promise<AgentSetThinkingResult> =>
      service.setThinkingLevel(request.level),
  );

  ipcMain.handle(
    AGENT_NEW_CHAT_CHANNEL,
    (): Promise<AgentReconfigResult> => service.newChat(),
  );
}
