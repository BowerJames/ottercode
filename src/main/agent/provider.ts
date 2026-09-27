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

export type AgentProvider = {
  /** Async by nature: providers load models (pi) or spawn processes
   * (Claude Code) before a session exists. */
  createSession(options: AgentSessionOptions): Promise<CreatedAgentSession>;
  /** Legitimate, switchable models for THIS provider. Absent or empty
   * means the provider offers no model choice. */
  listModels?(): Promise<readonly AgentModelInfo[]>;
};
