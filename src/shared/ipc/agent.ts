/**
 * The agent domain of the IPC contract: the submission channel
 * (renderer -> main) and the event stream (main -> renderer push).
 * Event shapes are contract-owned — never provider-native (pi or
 * Claude Code) shapes.
 */

/**
 * One user-edited file riding along on a turn: both sides of the
 * edit, verbatim. Semantic payload by design — the wire never carries
 * a rendered prompt or a pre-computed diff; prompt format is main's
 * policy (compose-prompt), so format experiments move nothing here.
 */
export type AgentFileEdit = {
  /** Absolute path of the edited file. */
  path: string;
  /** Disk content at load time (the diff base). */
  original: string;
  /** The user's current in-memory version. */
  edited: string;
};

/**
 * Request for AGENT_SUBMIT_CHANNEL. `edits` are the dirty working
 * copies at submit time (empty when none). Repeat sends repeat the
 * edits — they read as current state, not new deltas.
 */
export type AgentSubmitRequest = {
  /** The user's message for this turn. */
  message: string;
  edits: AgentFileEdit[];
};

/**
 * Response for AGENT_SUBMIT_CHANNEL. Fire-and-forget semantics: the
 * turn's outcome arrives as events on AGENT_EVENTS_CHANNEL.
 */
export type AgentSubmitResult = { ok: true };

/** Response for AGENT_PROVIDER_CHANNEL: the active provider plus the
 * picker's options, and the active model plus its options (adapter-
 * enumerated — only models that provider can actually switch to). */
export type AgentModelInfo = {
  id: string;
  label: string;
};

export type AgentProviderInfo = {
  provider: string;
  available: string[];
  /** The model actually in effect (resolved by the adapter at session
   * creation — the concrete default when none was chosen). */
  model: string;
  models: AgentModelInfo[];
};

/** Request for AGENT_SET_PROVIDER_CHANNEL. */
export type SetProviderRequest = {
  provider: string;
};

/** Response for AGENT_SET_PROVIDER_CHANNEL, AGENT_SET_MODEL_CHANNEL,
 * and AGENT_NEW_CHAT_CHANNEL — all three replace the session. */
export type AgentReconfigResult =
  | { ok: true }
  | { ok: false; error: { code: "unavailable" } };

/** Request for AGENT_SET_MODEL_CHANNEL. Changing the model starts a
 * new session (uniform with provider swaps). */
export type SetModelRequest = {
  model: string;
};

/**
 * One event in the agent's stream. Clauses:
 * - every turn is bracketed: turn-start … (turn-end | error).
 *   Brackets hold within a session's lifetime — swapping providers
 *   cancels an in-flight turn WITHOUT a terminator; consumers reset
 *   via the swap response, not events.
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
