import {
  type PermissionResult,
  query,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "../../../shared/ipc/agent.js";
import type {
  AgentPermissionDecision,
  AgentPermissionRequest,
  AgentProvider,
  AgentSessionOptions,
} from "../provider.js";

/**
 * The Claude Code adapter: the official agent SDK spawning the claude
 * CLI. This file is the Claude fence — SDK messages are translated to
 * contract events here, and SDK upgrades touch only here. Real-boundary
 * code, unverified at unit level (like providers/pi.ts): verified by
 * running the app against a logged-in CLI, later by E2E.
 *
 * Posture: process-per-turn — each send runs one query(); the session
 * id from the init message continues the conversation via resume. An
 * aborted turn forfeits that turn's persistence; the next send starts
 * from the last persisted turn. Permission posture: default mode with
 * canUseTool routed to the seam's requestPermission — the service's
 * policy (currently auto-allow) answers. Root-safe: the root block is
 * specific to bypassPermissions.
 *
 * Mapping: turn-start is synthesized (Claude has none); assistant text
 * blocks and tool_use blocks arrive one per SDK assistant message;
 * tool_result blocks close their tool-start; the result message's
 * subtype decides turn-end vs error.
 */
export const claudeProvider: AgentProvider = {
  async createSession({ root, requestPermission }: AgentSessionOptions) {
    let handler: ((event: AgentEvent) => void) | undefined;
    let sessionId: string | undefined;
    let controller: AbortController | undefined;
    let busy = false; // sends during an active turn are ignored (seam clause)

    const runTurn = async (prompt: string): Promise<void> => {
      handler?.({ type: "turn-start" });
      controller = new AbortController();
      let resultSubtype: string | undefined;
      try {
        const stream = query({
          prompt,
          options: {
            cwd: root,
            permissionMode: "default",
            ...(requestPermission !== undefined
              ? { canUseTool: makeCanUseTool(requestPermission) }
              : {}),
            resume: sessionId,
            abortController: controller,
          },
        });
        for await (const message of stream) {
          if (message.type === "system" && message.subtype === "init") {
            sessionId = message.session_id;
          }
          resultSubtype = emitFrom(message, handler, resultSubtype);
        }
        if (resultSubtype === undefined || resultSubtype === "success") {
          handler?.({ type: "turn-end" });
        } else {
          handler?.({ type: "error", message: `turn ended: ${resultSubtype}` });
        }
      } catch (error) {
        // An aborted turn is a normal end: partial text stands.
        if (controller.signal.aborted) {
          handler?.({ type: "turn-end" });
        } else {
          handler?.({ type: "error", message: errorMessage(error) });
        }
      } finally {
        controller = undefined;
      }
    };

    return {
      send(prompt) {
        if (busy) return;
        busy = true;
        void runTurn(prompt).finally(() => {
          busy = false;
        });
      },
      abort() {
        controller?.abort();
      },
      onEvent(h) {
        handler = h;
      },
      dispose() {
        controller?.abort(); // cancels any in-flight turn; process exits
      },
    };
  },
};

/** Emits contract events for one SDK message; returns the running
 * result subtype (set when the result message arrives). */
function emitFrom(
  message: SDKMessage,
  handler: ((event: AgentEvent) => void) | undefined,
  resultSubtype: string | undefined,
): string | undefined {
  if (handler === undefined) return resultSubtype;
  switch (message.type) {
    case "assistant": {
      const content = message.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text") {
            handler({ type: "assistant-delta", text: block.text });
          } else if (block.type === "tool_use") {
            handler({ type: "tool-start", id: block.id, name: block.name });
          }
        }
      }
      break;
    }
    case "user": {
      const content = message.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (typeof block === "object" && block.type === "tool_result") {
            handler({ type: "tool-end", id: block.tool_use_id });
          }
        }
      }
      break;
    }
    case "result":
      return message.subtype;
    default:
      break;
  }
  return resultSubtype;
}

/** Bridges the seam's permission callback to the SDK's canUseTool.
 * A throwing policy is a deny — fail closed, per the SDK's no-park
 * deadline. */
function makeCanUseTool(
  requestPermission: (
    request: AgentPermissionRequest,
  ) => Promise<AgentPermissionDecision>,
) {
  return async (
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<PermissionResult> => {
    try {
      const decision = await requestPermission({ toolName, input });
      if (decision.behavior === "allow") {
        return { behavior: "allow", updatedInput: input };
      }
      return { behavior: "deny", message: decision.message };
    } catch (error) {
      return { behavior: "deny", message: errorMessage(error) };
    }
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
