import {
  type AgentSessionEvent,
  createAgentSession,
} from "@earendil-works/pi-coding-agent";
import type { AgentEvent } from "../../../shared/ipc/agent.js";
import type { AgentProvider } from "../provider.js";

/**
 * The pi adapter: in-process SDK. This file is the pi fence — pi events
 * are translated to contract events here, and pi upgrades touch only
 * here. Real-boundary code, unverified at unit level (like
 * real-workspace-fs): verified by running the app, later by E2E.
 *
 * Mapping: turn_start/turn_end → the turn bracket; message_update's
 * text_delta events → append-only assistant deltas; tool_execution_* →
 * tool-start/end (toolCallId is the opaque pairing token). agent_start/
 * agent_end and every other native event are dropped — the contract
 * promises turn brackets, not run brackets.
 */
export const piProvider: AgentProvider = {
  async createSession({ root }) {
    const { session } = await createAgentSession({ cwd: root });

    let handler: ((event: AgentEvent) => void) | undefined;

    session.subscribe((piEvent) => {
      const mapped = mapPiEvent(piEvent);
      if (mapped !== undefined) {
        handler?.(mapped);
      }
    });

    return {
      send(prompt) {
        // Fire-and-forget per the seam: the outcome arrives as events.
        // prompt() rejects on provider-level failures — surfaced as an
        // error event, which terminates the turn per the contract.
        void session.prompt(prompt).catch((error: unknown) => {
          handler?.({ type: "error", message: errorMessage(error) });
        });
      },
      abort() {
        void session.abort();
      },
      onEvent(h) {
        handler = h;
      },
      dispose() {
        session.dispose();
      },
    };
  },
};

function mapPiEvent(event: AgentSessionEvent): AgentEvent | undefined {
  switch (event.type) {
    case "turn_start":
      return { type: "turn-start" };
    case "turn_end":
      return { type: "turn-end" };
    case "tool_execution_start":
      return {
        type: "tool-start",
        id: event.toolCallId,
        name: event.toolName,
      };
    case "tool_execution_end":
      return { type: "tool-end", id: event.toolCallId };
    case "message_update":
      if (event.assistantMessageEvent.type === "text_delta") {
        return {
          type: "assistant-delta",
          text: event.assistantMessageEvent.delta,
        };
      }
      return undefined;
    default:
      return undefined;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
