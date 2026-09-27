import type { TSchema } from "typebox";
import type {
  AgentEvent,
  AgentModelInfo,
  AgentThinkingLevel,
} from "../../shared/ipc/agent.js";

/**
 * The provider seam. Everything the agent service knows about coding
 * agents is this interface. Three adapters: pi (in-process SDK,
 * production), Claude Code (subprocess speaking stream-JSON, later),
 * and the in-memory fake (tests) — which is what makes this a real
 * seam from day one.
 *
 * Adapter contract:
 * - The turn bracket is the adapter's obligation: every turn is
 *   bracketed turn-start … (turn-end | error). Synthesis allowed —
 *   providers with no native "turn started" signal must emit one.
 * - send is fire-and-forget; events, not return values, carry the
 *   outcome. Providers may queue or ignore a send during an active
 *   turn — v1 disables the composer instead of relying on either.
 * - abort cancels the current turn; partial assistant text stands, and
 *   turn-end still follows.
 * - Tool ids are provider-opaque pairing tokens.
 * - Process model (in-process SDK vs subprocess) is invisible above
 *   this seam; dispose ends everything.
 * - Models: listModels enumerates ONLY models this provider can
 *   legitimately switch to (authed/configured — adapter-enumerated,
 *   never hardcoded in the UI), each with the thinking levels it
 *   supports. createSession resolves and reports the model actually
 *   in effect (the concrete default when none was chosen); an
 *   illegitimate model must throw.
 * - Thinking: sessions that support live reasoning control expose
 *   setThinkingLevel (optional capability — absent means the provider
 *   offers no thinking control, and the UI hides the picker). It
 *   never replaces the session: the transcript stands. Levels are
 *   provider-clamped in practice, but the service validates against
 *   the model's thinkingLevels first, so a validated level takes
 *   effect exactly as requested.
 */

/** One conversation with one provider. */
export type AgentSession = {
  send(prompt: string): void;
  abort(): void;
  onEvent(handler: (event: AgentEvent) => void): void;
  dispose(): void;
  /** Optional capability: set the thinking level on the LIVE session
   *   (no replacement, no transcript reset). */
  setThinkingLevel?(level: AgentThinkingLevel): void;
};

/** A permission question from the provider: may this tool run with
 * these arguments? */
export type AgentPermissionRequest = {
  toolName: string;
  input: unknown;
};

/** The answer. Deny carries a message the agent sees. */
export type AgentPermissionDecision =
  | { behavior: "allow" }
  | { behavior: "deny"; message: string };

export type AgentSessionOptions = {
  root: string;
  /** The model to use. Absent = the provider's default. Must be one
   * of listModels()'s ids; anything else throws. */
  model?: string;
  /**
   * Optional capability: providers that support permission gating
   * (Claude Code) call this before a gated tool executes; the turn
   * blocks until it answers. Absent means the provider runs ungated
   * (pi). There is no park deadline — the answerer must always
   * answer (the service owns abort/swap denial when the card UI
   * lands; until then its policy answers instantly).
   */
  requestPermission?: (
    request: AgentPermissionRequest,
  ) => Promise<AgentPermissionDecision>;
  /** Model-callable tools to register on the session (see
   *  AgentCustomTool). The service passes the same set to every
   *  session it creates, so replacements keep them. Adapters omit
   *  their native tool machinery entirely when the set is empty —
   *  no handshakes for nothing. */
  tools?: readonly AgentCustomTool[];
};

/** A created session plus the model actually in effect. */
export type CreatedAgentSession = {
  session: AgentSession;
  /** The concrete model id (resolved default when none requested). */
  model: string;
  /** The thinking level actually in effect (resolved default when
   * none requested — the adapter's default, not a contract one). */
  thinkingLevel: AgentThinkingLevel;
};

/**
 * A model-callable tool, defined once against the module it serves
 * (e.g. vdoc-tools) and satisfied by every adapter: pi (customTools),
 * Claude Code (an in-process MCP server), and the test fake — which
 * is what makes this a real seam from day one.
 *
 * Contract facts every adapter honors:
 * - `name` is the CONTRACT name — the one events carry and callers
 *   see. Providers with native naming (Claude's mcp__<server>__x)
 *   map to it going in and restore it coming out.
 * - `description` is model-facing: it IS the interface the model
 *   learns. It must teach what the tool is for and its key
 *   constraints; the model never sees the implementation.
 * - `inputSchema` is a TypeBox schema (TypeBox emits JSON Schema, so
 *   one definition serves every adapter; the Claude fence converts
 *   to its Zod raw shapes). typebox is pinned to pi's exact version
 *   in package.json so one copy serves both.
 * - Errors are values, never throws: adapters signal failure per
 *   their native convention (pi: a thrown Error becomes its failed
 *   tool result; Claude: MCP's isError flag), with `output` as the
 *   model-facing recovery text.
 */
export type AgentCustomTool = {
  name: string;
  description: string;
  inputSchema: TSchema;
  /** One-liner for system-prompt tool listings, where the adapter
   *   supports one (pi's promptSnippet). */
  promptSnippet?: string;
  execute(input: unknown): Promise<AgentCustomToolResult>;
};

export type AgentCustomToolResult = {
  /** Text returned to the model — on failure, recovery prose
   *  (what to do instead), not a bare code. */
  output: string;
  /** A failed call. The turn continues; the model reads `output` and
   *  recovers — self-describing errors are the tool's job. */
  isError?: boolean;
};

export type AgentProvider = {
  /** Async by nature: providers load models (pi) or spawn processes
   * (Claude Code) before a session exists. */
  createSession(options: AgentSessionOptions): Promise<CreatedAgentSession>;
  /** Legitimate, switchable models for THIS provider. Absent or empty
   * means the provider offers no model choice. */
  listModels?(): Promise<readonly AgentModelInfo[]>;
};
