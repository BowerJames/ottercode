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

/** Request/response: submit a turn to the coding agent. */
export const AGENT_SUBMIT_CHANNEL = "agent:submit";

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
