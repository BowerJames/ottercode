/**
 * The stdio LSP engine: the fat adapter that turns one live language
 * server into a LanguageEngine. Everything server-shaped lives here
 * and nowhere else — the initialize handshake, document sync with
 * content-hash dedup (repeat queries never re-send unchanged
 * documents), request-id correlation, URI conversion, and the
 * normalization of every server-native shape (Location, LocationLink,
 * WorkspaceEdit, CompletionItemKind) into contract shapes.
 *
 * Failure vocabulary: process-level trouble is EngineUnavailableError
 * ("crashed"); a server that answered with an error is
 * EngineRefusedError; emptiness is null / []. Timeouts are NOT here —
 * the service owns them, because a timed-out server is a pool-level
 * decision (dispose and cool down), not an engine-level one.
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  LangCompletionItem,
  LangCompletionKind,
  LangFileEdit,
  LangLocation,
  LangPosition,
} from "../../shared/ipc/lang.js";
import { languageIdOf } from "../../shared/lang/languages.js";
import { offsetFromPosition } from "../../shared/lang/position.js";
import {
  EngineRefusedError,
  EngineUnavailableError,
  type LanguageEngine,
} from "./language-engine.js";
import type { LspConnection } from "./lsp-connection.js";

export type LspEngineDeps = {
  /** Workspace root — the server's rootUri and working directory. */
  root: string;
  connection: LspConnection;
  /** Disk reads for rename bases of documents with no overlay. */
  readFile: (path: string) => Promise<string>;
};

type PendingEntry = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

/** Server-native shapes this adapter understands. Structural on
 * purpose — the server's full typings are not our contract. */
type LspLocation = { uri: string; range: { start: LangPosition } };
type LspLocationLink = {
  targetUri: string;
  targetRange?: { start: LangPosition };
  targetSelectionRange?: { start: LangPosition };
};
type LspTextEdit = {
  range: { start: LangPosition; end: LangPosition };
  newText: string;
};
type LspCompletionItem = {
  label: string;
  kind?: number;
  detail?: string;
  insertText?: string;
  textEdit?: { newText?: string };
};

/** LSP CompletionItemKind → the contract's seven kinds. Unknown or
 * absent kinds land on "text" — never an error. */
const COMPLETION_KINDS: Record<number, LangCompletionKind> = {
  1: "text", // Text
  2: "function", // Method
  3: "function", // Function
  4: "function", // Constructor
  5: "property", // Field
  6: "variable", // Variable
  7: "type", // Class
  8: "type", // Interface
  9: "module", // Module
  10: "property", // Property
  11: "text", // Unit
  12: "variable", // Value
  13: "type", // Enum
  14: "keyword", // Keyword
  15: "text", // Snippet
  16: "text", // Color
  17: "module", // File
  18: "text", // Reference
  19: "module", // Folder
  20: "variable", // EnumMember
  21: "variable", // Constant
  22: "type", // Struct
  23: "property", // Event
  24: "keyword", // Operator
  25: "type", // TypeParameter
};

/** Policy: completions above this count are truncated. Unpinned. */
const COMPLETION_ITEM_CAP = 500;

export function createLspEngine(deps: LspEngineDeps): LanguageEngine {
  const { connection, readFile } = deps;
  const rootUri = pathToFileURL(deps.root).href;

  let nextId = 1;
  let dead = false;
  let ready: Promise<void> | null = null;
  const pending = new Map<number, PendingEntry>();
  const openDocs = new Map<string, { text: string; version: number }>();

  connection.onMessage((message) => {
    const { id, method, result, error } = message as {
      id?: number;
      method?: string;
      result?: unknown;
      error?: { message: string };
    };
    if (method !== undefined && id !== undefined) {
      // A server→client request (workspace/configuration and kin).
      // v1 answers method-not-found: never leave a server hanging.
      connection.send({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: "method not found" },
      });
      return;
    }
    if (id === undefined) return; // notification (publishDiagnostics…)
    const entry = pending.get(id);
    if (entry === undefined) return; // stale reply to a disposed query
    pending.delete(id);
    if (error !== undefined)
      entry.reject(new EngineRefusedError(error.message));
    else entry.resolve(result ?? null);
  });

  connection.onClose(() => {
    dead = true;
    for (const entry of pending.values()) {
      entry.reject(new EngineUnavailableError("crashed"));
    }
    pending.clear();
  });

  /** One request/response round trip. */
  function request(method: string, params: unknown): Promise<unknown> {
    if (dead) return Promise.reject(new EngineUnavailableError("crashed"));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { method, resolve, reject });
      connection.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  /** The initialize handshake, once per connection; a failed handshake
   * clears the memo so the next query retries it. */
  const ensureReady = (): Promise<void> => {
    if (ready === null) {
      ready = (async () => {
        await request("initialize", {
          processId: null,
          rootUri,
          capabilities: {},
        });
        connection.send({ jsonrpc: "2.0", method: "initialized", params: {} });
      })().catch((error: unknown) => {
        ready = null;
        throw error;
      });
    }
    return ready;
  };

  /** didOpen/didChange only when the content hash (= the text itself)
   * moved — repeat queries never re-send unchanged documents. */
  async function syncDoc(path: string, content: string): Promise<void> {
    const uri = pathToFileURL(path).href;
    const open = openDocs.get(uri);
    if (open === undefined) {
      openDocs.set(uri, { text: content, version: 1 });
      connection.send({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: {
          textDocument: {
            uri,
            languageId: languageIdOf(path) ?? "plaintext",
            version: 1,
            text: content,
          },
        },
      });
    } else if (open.text !== content) {
      openDocs.set(uri, { text: content, version: open.version + 1 });
      connection.send({
        jsonrpc: "2.0",
        method: "textDocument/didChange",
        params: {
          textDocument: { uri, version: open.version + 1 },
          contentChanges: [{ text: content }],
        },
      });
    }
  }

  function firstLocationTarget(
    result: unknown,
  ): { uri: string; start: LangPosition } | null {
    if (result === null || !Array.isArray(result) || result.length === 0) {
      return null;
    }
    const first = result[0] as LspLocation | LspLocationLink;
    if ("uri" in first) {
      return { uri: first.uri, start: first.range.start };
    }
    return {
      uri: first.targetUri,
      start: (first.targetSelectionRange ?? first.targetRange)?.start ?? {
        line: 0,
        character: 0,
      },
    };
  }

  /** Collects a WorkspaceEdit's ranged edits by path. File
   * create/rename/delete operations (rare on rename) are skipped:
   * v1 renames only ever rewrite existing documents. */
  function collectRenameEdits(
    result: { changes?: Record<string, LspTextEdit[]> } & {
      documentChanges?: Array<{
        textDocument?: { uri: string };
        edits?: LspTextEdit[];
      }>;
    },
  ): Map<string, LspTextEdit[]> {
    const byPath = new Map<string, LspTextEdit[]>();
    for (const [uri, edits] of Object.entries(result.changes ?? {})) {
      byPath.set(fileURLToPath(uri), edits);
    }
    for (const change of result.documentChanges ?? []) {
      const uri = change.textDocument?.uri;
      if (uri === undefined || change.edits === undefined) continue;
      byPath.set(fileURLToPath(uri), change.edits);
    }
    return byPath;
  }

  /** Applies ranged edits to a base, descending by position so
   * earlier offsets stay valid while later splices land. */
  function applyTextEdits(base: string, edits: LspTextEdit[]): string {
    const splices = edits
      .map((edit) => ({
        from: offsetFromPosition(base, edit.range.start),
        to: offsetFromPosition(base, edit.range.end),
        text: edit.newText,
      }))
      .sort((a, b) => b.from - a.from);
    let out = base;
    for (const { from, to, text } of splices) {
      out = out.slice(0, from) + text + out.slice(to);
    }
    return out;
  }

  return {
    async definition(path, content, position) {
      await ensureReady();
      await syncDoc(path, content);
      const target = firstLocationTarget(
        await request("textDocument/definition", {
          textDocument: { uri: pathToFileURL(path).href },
          position,
        }),
      );
      if (target === null) return null;
      const location: LangLocation = {
        path: fileURLToPath(target.uri),
        position: target.start,
      };
      return location;
    },

    async rename(path, content, position, newName, overlay) {
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(newName)) {
        // ASCII-identifier policy, conservative across languages.
        throw new EngineRefusedError("not a valid identifier");
      }
      await ensureReady();
      await syncDoc(path, content);
      for (const [overlayPath, overlayText] of overlay) {
        // Overlay docs are synced so the server computes against the
        // user's in-memory text, exactly like the active document.
        await syncDoc(overlayPath, overlayText);
      }
      const result = (await request("textDocument/rename", {
        textDocument: { uri: pathToFileURL(path).href },
        position,
        newName,
      })) as {
        changes?: Record<string, LspTextEdit[]>;
        documentChanges?: Array<{
          textDocument?: { uri: string };
          edits?: LspTextEdit[];
        }>;
      } | null;
      if (result === null) return null;
      const byPath = collectRenameEdits(result);
      const edits: LangFileEdit[] = [];
      for (const editPath of [...byPath.keys()].sort()) {
        const base = overlay.get(editPath) ?? (await readFile(editPath)); // disk is the fallback base
        edits.push({
          path: editPath,
          original: base,
          edited: applyTextEdits(base, byPath.get(editPath) ?? []),
        });
      }
      return edits;
    },

    async completions(path, content, position) {
      await ensureReady();
      await syncDoc(path, content);
      const result = (await request("textDocument/completion", {
        textDocument: { uri: pathToFileURL(path).href },
        position,
      })) as LspCompletionItem[] | { items?: LspCompletionItem[] } | null;
      const items = Array.isArray(result) ? result : (result?.items ?? []);
      return items.slice(0, COMPLETION_ITEM_CAP).map(
        (item): LangCompletionItem => ({
          label: item.label,
          apply: item.textEdit?.newText ?? item.insertText ?? item.label,
          kind:
            item.kind !== undefined
              ? (COMPLETION_KINDS[item.kind] ?? "text")
              : "text",
          detail: item.detail,
        }),
      );
    },

    dispose() {
      dead = true;
      for (const entry of pending.values()) {
        entry.reject(new EngineUnavailableError("crashed"));
      }
      pending.clear();
      connection.dispose();
    },
  };
}
