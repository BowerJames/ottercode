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
 * One user-run terminal command riding along on a turn: the command
 * and its recorded outcome. Semantic payload by design — the wire
 * never carries rendered prompt text; formatting is main's policy
 * (compose-prompt). `output` is the run's tail under the shared
 * truncation policy (see shared/terminal/truncate) — each run
 * truncates individually, so one runaway command can't crowd out
 * the rest. The truncation specifics are policy, deliberately
 * unpinned by tests.
 */
export type AgentTerminalRun = {
  /** The command line as the user typed it. */
  command: string;
  /** Sanitized combined stdout+stderr, tail-kept when truncated. */
  output: string;
  /** The process exit code; null = died by signal. */
  exitCode: number | null;
  /** True iff the user aborted the run. */
  cancelled: boolean;
  /** True iff `output` is a truncated tail of the full stream. */
  truncated: boolean;
};

/**
 * Request for AGENT_SUBMIT_CHANNEL. `edits` are the dirty working
 * copies at submit time and `terminalRuns` the commands recorded
 * since the last accepted turn (the renderer drains its buffer on
 * ok — runs are events, told once, unlike edits which re-send as
 * current state). Both are empty when none.
 */
export type AgentSubmitRequest = {
  /** The user's message for this turn. May be empty — the turn then
   * rides on `edits` and/or `terminalRuns` alone (attachments make
   * a valid turn); a request empty in all three is never made. */
  message: string;
  edits: AgentFileEdit[];
  terminalRuns: AgentTerminalRun[];
};

/**
 * One editor selection riding on a focused turn: the file and the
 * highlighted text, verbatim. Semantic payload by design — the same
 * clause as AgentFileEdit: the wire never carries rendered prompt
 * text; formatting is main's policy (compose-prompt).
 */
export type AgentSelection = {
  /** Absolute path of the file the text was selected in. */
  path: string;
  /** The selected text, verbatim. */
  text: string;
};

/**
 * Request for AGENT_SUBMIT_SELECTION_CHANNEL. A focused turn: the
 * user's message about ONE selection. The exclusivity is structural —
 * this type has no fields for file edits or terminal runs, and a
 * selection turn never carries them (unlike AgentSubmitRequest, whose
 * attachments are the composer's gather).
 */
export type AgentSelectionSubmitRequest = {
  /** The user's message for this turn. May be empty — the selection
   * alone is a valid "look at this" turn. */
  message: string;
  selection: AgentSelection;
};

/**
 * Response for AGENT_SUBMIT_CHANNEL and AGENT_SUBMIT_SELECTION_CHANNEL
 * (same fire-and-forget shape for both turn kinds — one result serves
 * two channels, as AgentReconfigResult serves three). The turn's
 * outcome arrives as events on AGENT_EVENTS_CHANNEL.
 */
export type AgentSubmitResult = { ok: true };

/** Response for AGENT_PROVIDER_CHANNEL: the active provider plus the
 * picker's options, and the active model plus its options (adapter-
 * enumerated — only models that provider can actually switch to). */
export type AgentModelInfo = {
  id: string;
  label: string;
  /** Thinking levels this model supports — adapter-enumerated, never
   * hardcoded in the UI. ["off"] when the model cannot reason at
   * all; empty when the provider cannot enumerate levels (the
   * thinking picker stays hidden). */
  thinkingLevels: readonly AgentThinkingLevel[];
};

/** The thinking-level vocabulary the contract speaks. pi's levels
 * are the lingua franca; other providers (Claude Code) adapt or
 * abstain — see AgentModelInfo.thinkingLevels. */
export type AgentThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

/** Thinking control for the active model, as the picker needs it:
 * the level in effect plus the levels the active model offers. */
export type AgentThinkingInfo = {
  /** The level actually in effect (adapter-resolved default when
   * none was chosen — pi's default, not a contract default). */
  level: AgentThinkingLevel;
  levels: readonly AgentThinkingLevel[];
};

export type AgentProviderInfo = {
  provider: string;
  available: string[];
  /** The model actually in effect (resolved by the adapter at session
   * creation — the concrete default when none was chosen). */
  model: string;
  models: AgentModelInfo[];
  /** The thinking picker's state, or null when there is no meaningful
   * choice — the active model offers fewer than two levels, or the
   * session has no thinking control at all. Null hides the picker. */
  thinking: AgentThinkingInfo | null;
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

/** Request for AGENT_SET_THINKING_CHANNEL. Setting the level is LIVE:
 * the session keeps running and the transcript stands — unlike
 * provider/model changes, no swap happens. */
export type SetThinkingLevelRequest = {
  level: AgentThinkingLevel;
};

/** Response for AGENT_SET_THINKING_CHANNEL. ok means the requested
 * level is now in effect exactly as requested (validation happened
 * before the session was touched); unsupported covers both a session
 * with no thinking control and a level the active model doesn't
 * offer. */
export type AgentSetThinkingResult =
  | { ok: true }
  | { ok: false; error: { code: "unsupported" } };

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
