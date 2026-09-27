/**
 * IPC channel names, declared once. The renderer's typed client and the
 * main-process handlers both import these constants, so a mismatched
 * channel name is a compile error rather than a runtime mystery.
 */

/** Request/response: the workspace root the file tree starts from. */
export const FS_ROOT_CHANNEL = "fs:root";

/** Request/response: the direct children of one directory. */
export const FS_LIST_CHILDREN_CHANNEL = "fs:listChildren";

/** Request/response: the text content of one file. */
export const FS_READ_FILE_CHANNEL = "fs:readFile";

/** Request/response: the workspace's git state. */
export const GIT_STATUS_CHANNEL = "git:status";

/** Request/response: run one command in the workspace terminal. */
export const TERMINAL_RUN_CHANNEL = "terminal:run";

/** Request/response: kill the running terminal command. */
export const TERMINAL_ABORT_CHANNEL = "terminal:abort";

/** Push: the terminal's event stream (main -> renderer). */
export const TERMINAL_EVENTS_CHANNEL = "terminal:events";

/** Request/response: submit a turn to the coding agent. */
export const AGENT_SUBMIT_CHANNEL = "agent:submit";

/** Request/response: submit a focused turn about one editor
 * selection — never carries edits or terminal runs (see
 * AgentSelectionSubmitRequest). */
export const AGENT_SUBMIT_SELECTION_CHANNEL = "agent:submitSelection";

/** Request/response: cancel the agent's current turn. */
export const AGENT_ABORT_CHANNEL = "agent:abort";

/** Push: the agent's event stream (main -> renderer). */
export const AGENT_EVENTS_CHANNEL = "agent:events";

/** Request/response: the active agent provider and options. */
export const AGENT_PROVIDER_CHANNEL = "agent:provider";

/** Request/response: swap the agent provider (new session). */
export const AGENT_SET_PROVIDER_CHANNEL = "agent:setProvider";

/** Request/response: change the agent model (new session). */
export const AGENT_SET_MODEL_CHANNEL = "agent:setModel";

/** Request/response: change the agent's thinking level (live — the
 * session is NOT replaced; see AgentSetThinkingResult). */
export const AGENT_SET_THINKING_CHANNEL = "agent:setThinking";

/** Request/response: start a new chat — a fresh session with the
 * current provider and model. */
export const AGENT_NEW_CHAT_CHANNEL = "agent:newChat";
