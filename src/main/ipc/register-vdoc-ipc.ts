import { ipcMain } from "electron";
import {
  VDOC_CREATE_CHANNEL,
  VDOC_DELETE_CHANNEL,
  VDOC_LIST_CHANNEL,
  VDOC_READ_CHANNEL,
  VDOC_UPDATE_CHANNEL,
} from "../../shared/ipc/channels.js";
import type {
  VDocCreateRequest,
  VDocCreateResult,
  VDocDeleteRequest,
  VDocDeleteResult,
  VDocListResult,
  VDocReadRequest,
  VDocReadResult,
  VDocUpdateRequest,
  VDocUpdateResult,
} from "../../shared/ipc/vdoc.js";
import type { VDocStore } from "../vdocs/vdoc-store.js";

/**
 * IPC glue: maps contract channels to VDocStore calls. No business
 * logic — if a handler grows beyond a mechanical mapping, that logic
 * belongs in a service. Each handler re-shapes the store's result
 * union into the wire's inlined arms; nothing else moves.
 *
 * The user/agent origin split lives HERE by design: every renderer
 * write is a user write (the agent writes through its in-process
 * tool, never the wire), so "user" is hardcoded — provenance cannot
 * be forged from the renderer.
 */
export function registerVdocIpc(store: VDocStore): void {
  ipcMain.handle(
    VDOC_LIST_CHANNEL,
    (): VDocListResult => ({
      docs: store.list(),
    }),
  );

  ipcMain.handle(
    VDOC_CREATE_CHANNEL,
    (_event, request: VDocCreateRequest): VDocCreateResult => {
      const result = store.create(request.name, request.content, "user");
      return result.ok ? { ok: true, doc: result.value } : result;
    },
  );

  ipcMain.handle(
    VDOC_READ_CHANNEL,
    (_event, request: VDocReadRequest): VDocReadResult => {
      const result = store.read(request.name);
      return result.ok
        ? {
            ok: true,
            content: result.value.content,
            version: result.value.version,
          }
        : result;
    },
  );

  ipcMain.handle(
    VDOC_UPDATE_CHANNEL,
    (_event, request: VDocUpdateRequest): VDocUpdateResult => {
      const result = store.write(
        request.name,
        request.content,
        request.expectedVersion,
        "user",
      );
      return result.ok ? { ok: true, doc: result.value } : result;
    },
  );

  ipcMain.handle(
    VDOC_DELETE_CHANNEL,
    (_event, request: VDocDeleteRequest): VDocDeleteResult => {
      const result = store.delete(request.name);
      return result.ok ? { ok: true } : result;
    },
  );
}
