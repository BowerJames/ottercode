import type { OttercodeClient } from "../../../shared/ipc/client";
import type { LangError } from "../../../shared/ipc/lang";
import { positionFromOffset } from "../../../shared/lang/position";
import type { UseEditorStore } from "./store";

/**
 * The renderer's language-intelligence composition: joins a client
 * slice (the lang channels) to the editor store, and owns the
 * request-assembly policies the contract documents — rename carries
 * every OTHER open document's current content, and a document that
 * drifted since the rename prompt opened never sends (stale edits
 * would be computed against text the user no longer sees).
 *
 * Pure data in, store actions out — no CodeMirror types here, so the
 * policies are testable without a DOM. The view glue (keymaps, click
 * handlers, the prompt) lives in definition.ts / rename.ts /
 * completion.ts and stays thin on purpose.
 */

export type LanguageIntelDeps = {
  lang: Pick<OttercodeClient["lang"], "definition" | "rename" | "completion">;
  editor: UseEditorStore;
};

export type RenameOutcome =
  | { kind: "applied" }
  | { kind: "stale" }
  | { kind: "failed"; message: string };

export function createLanguageIntel({ lang, editor }: LanguageIntelDeps) {
  return {
    async definition(path: string, content: string, offset: number) {
      return lang.definition({
        path,
        content,
        position: positionFromOffset(content, offset),
      });
    },

    async completion(path: string, content: string, offset: number) {
      const result = await lang.completion({
        path,
        content,
        position: positionFromOffset(content, offset),
      });
      // Degradation is silence: no-server and server-error alike
      // offer nothing rather than interrupting typing.
      return result.ok ? result.items : [];
    },

    async rename(
      path: string,
      content: string,
      offset: number,
      newName: string,
      contentAtPromptOpen: string,
    ): Promise<RenameOutcome> {
      if (content !== contentAtPromptOpen) {
        return { kind: "stale" };
      }
      const openDocuments = Object.entries(editor.getState().workingCopies)
        .filter(([openPath]) => openPath !== path)
        // Key-sorted for a deterministic wire — the same policy as
        // collectEdits; the set of overrides is what matters, not order.
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([openPath, copy]) => ({ path: openPath, content: copy.content }));
      const result = await lang.rename({
        path,
        content,
        position: positionFromOffset(content, offset),
        newName,
        openDocuments,
      });
      if (!result.ok) {
        return { kind: "failed", message: renameErrorMessage(result.error) };
      }
      // In-memory only: the edits become the dirty set the next agent
      // turn attaches (see the contract's LangFileEdit clause).
      editor.getState().applyRenameEdits(result.edits);
      return { kind: "applied" };
    },
  };
}

export type LanguageIntel = ReturnType<typeof createLanguageIntel>;

/** Failure-code → human text. Presentation, deliberately unpinned. */
function renameErrorMessage(error: LangError): string {
  switch (error.code) {
    case "no-server":
      return "no language server found for this file";
    case "not-renameable":
      return error.message ?? "this symbol can't be renamed";
    default:
      return "rename failed";
  }
}
