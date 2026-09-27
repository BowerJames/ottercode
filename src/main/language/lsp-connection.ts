/**
 * The transport seam under the LSP engine: a message-passing
 * connection, deliberately free of stream, framing, and process
 * concerns so the engine logic is testable against a scripted fake.
 * Two adapters make it real: the stdio child-process adapter
 * (real-lsp-connection) and the test fake. Messages are already
 * JSON-parsed objects in both directions — framing is the adapter's
 * problem, never the engine's.
 */

import type { EngineCommand } from "./language-engine.js";

export interface LspConnection {
  /** Send one JSON-RPC message (request or notification). */
  send(message: unknown): void;
  /** Register the sole consumer of server→client messages. */
  onMessage(handler: (message: unknown) => void): void;
  /** The connection dropped (process exit, pipe error). Fires once. */
  onClose(handler: () => void): void;
  /** Tear down the underlying process/streams. */
  dispose(): void;
}

/** Creates a live connection to a server command in a workspace root. */
export type LspConnectionFactory = (
  command: EngineCommand,
  root: string,
) => LspConnection;
