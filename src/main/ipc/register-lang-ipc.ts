import { ipcMain } from "electron";
import {
  LANG_COMPLETION_CHANNEL,
  LANG_DEFINITION_CHANNEL,
  LANG_RENAME_CHANNEL,
} from "../../shared/ipc/channels.js";
import type {
  CompletionRequest,
  CompletionResult,
  DefinitionRequest,
  DefinitionResult,
  RenameRequest,
  RenameResult,
} from "../../shared/ipc/lang.js";
import type { LanguageService } from "../language/language-service.js";

/**
 * IPC glue: maps contract channels to LanguageService calls. No
 * business logic — if a handler grows beyond a mechanical mapping,
 * that logic belongs in the service.
 */
export function registerLangIpc(service: LanguageService): void {
  ipcMain.handle(
    LANG_DEFINITION_CHANNEL,
    (_event, request: DefinitionRequest): Promise<DefinitionResult> =>
      service.definition(request.path, request.content, request.position),
  );

  ipcMain.handle(
    LANG_RENAME_CHANNEL,
    (_event, request: RenameRequest): Promise<RenameResult> =>
      service.rename(request),
  );

  ipcMain.handle(
    LANG_COMPLETION_CHANNEL,
    (_event, request: CompletionRequest): Promise<CompletionResult> =>
      service.completion(request.path, request.content, request.position),
  );
}
