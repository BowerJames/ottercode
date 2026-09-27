/**
 * The language-intelligence domain of the IPC contract: the three
 * queries behind go-to-definition, rename, and autocomplete. Payloads
 * are contract-owned — never server-native (LSP) shapes; adapters
 * normalize at the seam in main.
 *
 * One clause shapes every request: **the document's whole current
 * content rides along.** Editor buffers are unsaved (the agent flow is
 * the only disk writer), so disk cannot answer for the active
 * document. Whole-document payloads keep the traffic coarse; the
 * tiering is policy — completion carries the active document only
 * (frequent, light), while rename additionally carries every OTHER
 * open document's content (`openDocuments`), because its edits must be
 * computed against what the user sees, not what disk holds.
 */

import type { LangPosition } from "../lang/position.js";

export type { LangPosition } from "../lang/position.js";

/** Failure modes, discriminated by code (same convention as fs). */
export type LangErrorCode =
  /** No language server exists for this file's language (unknown
   * type, or no server binary found). Features degrade silently. */
  | "no-server"
  /** Nothing referenceable at the position. */
  | "no-symbol"
  /** A symbol was found but the server refused renaming it. */
  | "not-renameable"
  /** The server crashed, timed out, or broke the protocol. */
  | "server-error"
  | "unknown";

export type LangError = { code: LangErrorCode; message?: string };

/** Request for LANG_DEFINITION_CHANNEL. */
export type DefinitionRequest = {
  /** Absolute path of the active document. */
  path: string;
  /** Its whole current content. */
  content: string;
  position: LangPosition;
};

/** A definition target: a file plus a point in it. A point, not a
 * range — the renderer selects the word around it locally. */
export type LangLocation = {
  path: string;
  position: LangPosition;
};

export type DefinitionResult =
  | { ok: true; location: LangLocation }
  | { ok: false; error: LangError };

/** Request for LANG_RENAME_CHANNEL. */
export type RenameRequest = {
  /** The document holding the symbol. */
  path: string;
  /** Its whole current content. */
  content: string;
  position: LangPosition;
  /** The replacement name. */
  newName: string;
  /** Whole current content of every OTHER open document, so edits
   * are computed against in-memory text rather than stale disk. */
  openDocuments: { path: string; content: string }[];
};

/**
 * One file rewritten by a rename: both sides of the edit, verbatim —
 * deliberately shape-identical to AgentFileEdit. Rename output is
 * attachment-shaped: the renderer applies these to working copies,
 * where they become the dirty set the next agent turn attaches
 * (collectEdits). No rename path ever writes disk directly.
 */
export type LangFileEdit = {
  path: string;
  /** The content the edit was computed against (disk, or the open
   * document's in-memory text when one exists). */
  original: string;
  /** The renamed content. */
  edited: string;
};

export type RenameResult =
  | { ok: true; edits: LangFileEdit[] }
  | { ok: false; error: LangError };

/** Request for LANG_COMPLETION_CHANNEL. */
export type CompletionRequest = {
  path: string;
  content: string;
  position: LangPosition;
};

/** Kinds normalized from the server's finer taxonomy at the adapter —
 * the contract never carries server-native enumerations. */
export type LangCompletionKind =
  | "variable"
  | "function"
  | "type"
  | "property"
  | "module"
  | "keyword"
  | "text";

export type LangCompletionItem = {
  /** Display and filter text. */
  label: string;
  /** The text to insert — the server's insertText/textEdit folded
   * into one string by the adapter. */
  apply: string;
  kind: LangCompletionKind;
  /** Type signature or similar context, when the server offers it. */
  detail?: string;
};

export type CompletionResult =
  | { ok: true; items: LangCompletionItem[] }
  | { ok: false; error: LangError };
