/**
 * The agent domain of the IPC contract: the submission channel
 * (renderer -> main) and the event stream (main -> renderer push).
 * Event shapes are contract-owned — never provider-native (pi or
 * Claude Code) shapes.
 */

/**
 * Request for AGENT_SUBMIT_CHANNEL. Wrapped for growth: attachments
 * (diffs, comments) join as fields later without reshaping.
 */
export type AgentSubmitRequest = {
  /** The user's message for this turn. */
  message: string;
};

/**
 * Response for AGENT_SUBMIT_CHANNEL. Fire-and-forget semantics: the
 * turn's outcome arrives as events on AGENT_EVENTS_CHANNEL.
 */
export type AgentSubmitResult = { ok: true };

/**
 * One event in the agent's stream. Clauses:
 * - every turn is bracketed: turn-start … (turn-end | error).
 * - assistant-delta text is APPEND-ONLY; granularity is
 *   provider-dependent (token-fine or message-sized).
 * - tool ids are provider-opaque pairing tokens: a tool-start id is
 *   eventually followed by a tool-end with the same id.
 * - error terminates the turn it occurs in.
 */
export type AgentEvent =
  | { type: "turn-start" }
  | { type: "assistant-delta"; text: string }
  | { type: "tool-start"; id: string; name: string }
  | { type: "tool-end"; id: string }
  | { type: "turn-end" }
  | { type: "error"; message: string };
