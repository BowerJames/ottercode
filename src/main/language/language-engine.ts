/**
 * The engine seam: one interface every language-server adapter
 * satisfies, and the two failure vocabularies that cross it. The
 * service above this seam owns routing, degradation, and cooldowns;
 * the adapter below owns everything server-shaped (handshake,
 * document sync, wire quirks). Two adapters make the seam real: the
 * stdio LSP engine and the scripted fakes in the service tests.
 */

import type {
  LangCompletionItem,
  LangFileEdit,
  LangLocation,
  LangPosition,
} from "../../shared/ipc/lang.js";
import type { LanguageId } from "../../shared/lang/languages.js";

/**
 * In-memory overrides for documents whose renderer-side text differs
 * from disk (any open, unsaved buffer). Rename consumes one so its
 * edits are computed against what the user sees.
 */
export type DocOverlay = ReadonlyMap<string, string>;

/** Why an engine cannot serve a request at all — process-level, not
 * query-level. Query-level emptiness is `null`, never an error. */
export type EngineUnavailableReason =
  /** The server binary could not be started. */
  | "spawn"
  /** The server process died, or the connection dropped. */
  | "crashed"
  /** The server never answered within its budget. */
  | "timeout";

export class EngineUnavailableError extends Error {
  constructor(readonly reason: EngineUnavailableReason) {
    super(`language engine unavailable: ${reason}`);
    this.name = "EngineUnavailableError";
  }
}

/**
 * The server was asked and refused — an LSP error response (e.g.
 * renaming a keyword), or a newName that is not a valid identifier.
 * The refusal message is server text for the UI, not a contract
 * clause; codes are normalized above the seam.
 */
export class EngineRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineRefusedError";
  }
}

export interface LanguageEngine {
  /** Where the symbol at the position is defined; null when nothing
   * referenceable sits there. */
  definition(
    path: string,
    content: string,
    position: LangPosition,
  ): Promise<LangLocation | null>;
  /** The workspace-wide edit set for a rename; null when the symbol
   * cannot be found or renamed. `overlay` carries the current content
   * of OTHER open documents (see DocOverlay). */
  rename(
    path: string,
    content: string,
    position: LangPosition,
    newName: string,
    overlay: DocOverlay,
  ): Promise<LangFileEdit[] | null>;
  /** Completion candidates; empty when the server offers none.
   * (Empty is a valid answer — never an error.) */
  completions(
    path: string,
    content: string,
    position: LangPosition,
  ): Promise<LangCompletionItem[]>;
  /** Kill the server and release the connection. Idempotent. */
  dispose(): void;
}

/** A resolved command line for a language server. */
export type EngineCommand = { command: string; args: string[] };

/** Creates an engine for an already-resolved command. Synchronous by
 * design: the service's pool is built synchronously, so concurrent
 * first requests share one engine instead of racing spawns. */
export type EngineFactory = (
  language: LanguageId,
  command: EngineCommand,
) => LanguageEngine;
