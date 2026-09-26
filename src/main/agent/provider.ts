import type { AgentEvent } from "../../shared/ipc/agent.js";

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
 */

/** One conversation with one provider. */
export type AgentSession = {
  send(prompt: string): void;
  abort(): void;
  onEvent(handler: (event: AgentEvent) => void): void;
  dispose(): void;
};

export type AgentProvider = {
  /** Async by nature: providers load models (pi) or spawn processes
   * (Claude Code) before a session exists. */
  createSession(options: { root: string }): Promise<AgentSession>;
};
