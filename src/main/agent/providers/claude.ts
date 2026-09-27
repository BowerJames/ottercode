import {
  createSdkMcpServer,
  type PermissionResult,
  query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { AgentEvent, AgentModelInfo } from "../../../shared/ipc/agent.js";
import type {
  AgentCustomTool,
  AgentPermissionDecision,
  AgentPermissionRequest,
  AgentProvider,
  AgentSessionOptions,
  AgentSession as ContractSession,
  CreatedAgentSession,
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
 * Custom tools: the seam's AgentCustomTool set is served by ONE
 * in-process MCP server (createSdkMcpServer — handlers run in this
 * process against the same stores the IPC glue serves; spike-verified:
 * tool calls flow over a plain non-streaming query()). alwaysLoad
 * keeps the tools out of the CLI's ToolSearch deferral. Names: the CLI
 * surfaces MCP tools as mcp__<server>__<name>; emitFrom restores the
 * contract name on the way out. Schemas: the seam's TypeBox objects
 * convert to the SDK's Zod raw shapes — flat string/number/boolean
 * properties only; anything richer throws at session creation (fail
 * closed, loudly, rather than silently degrading what the model sees).
 * Errors stay values across the seam: isError maps to MCP's native
 * flag (contrast the pi adapter, which throws).
 *
 * Mapping: turn-start is synthesized (Claude has none); assistant text
 * blocks and tool_use blocks arrive one per SDK assistant message;
 * tool_result blocks close their tool-start; the result message's
 * subtype decides turn-end vs error.
 * Models: a streaming-input bootstrap query (a spawn that never sends
 * a message — no model call, no cost beyond CLI startup) reads the
 * init message's resolved model and the CLI's supportedModels() list.
 * Falls back to the CLI's stable aliases if the bootstrap fails; an
 * EXPLICIT model choice that fails the bootstrap is an error (fail
 * closed — illegitimate models must throw, per the seam).
 */
let modelListCache: readonly AgentModelInfo[] | undefined;

export const claudeProvider: AgentProvider = {
  async createSession({
    root,
    model,
    requestPermission,
    tools,
  }: AgentSessionOptions): Promise<CreatedAgentSession> {
    const boot = await claudeBootstrap(root, model).catch((error: unknown) => {
      if (model !== undefined) throw error;
      return null;
    });
    if (boot !== null) {
      modelListCache = boot.models;
    }
    const resolvedModel = boot?.model ?? model ?? "claude-default";
    // One in-process server per session, reused across turns: handlers
    // close over the seam's tools; the CLI process is per-turn but the
    // server object (and the stores it touches) lives here.
    const toolServer =
      tools !== undefined && tools.length > 0 ? toMcpServer(tools) : undefined;

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
            model,
            permissionMode: "default",
            ...(requestPermission !== undefined
              ? { canUseTool: makeCanUseTool(requestPermission) }
              : {}),
            ...(toolServer !== undefined
              ? { mcpServers: { [TOOL_SERVER_NAME]: toolServer } }
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
      session: {
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
      } satisfies ContractSession,
      model: resolvedModel,
      thinkingLevel: "off", // no thinking control to resolve or report
    };
  },

  async listModels(): Promise<readonly AgentModelInfo[]> {
    if (modelListCache !== undefined) return modelListCache;
    const boot = await claudeBootstrap(process.cwd(), undefined);
    modelListCache = boot.models;
    return modelListCache;
  },
};

/** Fallback when the bootstrap fails and no model was requested: the
 * CLI's stable aliases (legitimate switch targets per the SDK). */
const ALIAS_MODELS: readonly AgentModelInfo[] = [
  { id: "sonnet", label: "Sonnet (alias)", thinkingLevels: [] },
  { id: "opus", label: "Opus (alias)", thinkingLevels: [] },
  { id: "haiku", label: "Haiku (alias)", thinkingLevels: [] },
];

/** Spawns a streaming-input query that never sends a message: the CLI
 * emits system/init (carrying the resolved model), answers control
 * requests (supportedModels), and is torn down without any model
 * call. Control methods require streaming input — hence the gate. */
async function claudeBootstrap(
  root: string,
  model: string | undefined,
): Promise<{ model: string; models: readonly AgentModelInfo[] }> {
  const controller = new AbortController();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // biome-ignore lint/correctness/useYield: deliberately yield-free — the generator's only job is to hold the stream open until released.
  async function* heldOpenInput(): AsyncGenerator<SDKUserMessage> {
    await gate; // never yields — holds the session at "awaiting input"
  }
  try {
    const stream = query({
      prompt: heldOpenInput(),
      options: {
        cwd: root,
        ...(model !== undefined ? { model } : {}),
        abortController: controller,
      },
    });
    const first = await stream.next();
    const init = first.done ? undefined : first.value;
    let initModel: string | undefined;
    if (
      init !== undefined &&
      init.type === "system" &&
      init.subtype === "init"
    ) {
      initModel = init.model;
    }
    const supported = await stream.supportedModels();
    return {
      model: initModel ?? model ?? "claude-default",
      models: supported.map((m) => ({
        id: m.value,
        label: m.displayName,
        thinkingLevels: [], // the CLI exposes no thinking enumeration
      })),
    };
  } catch (error) {
    if (model === undefined) {
      return { model: "claude-default", models: ALIAS_MODELS };
    }
    throw error;
  } finally {
    release();
    controller.abort();
  }
}

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
            // The contract name, not the CLI's mcp__<server>__ prefix —
            // the seam's naming clause, restored at the fence.
            handler({
              type: "tool-start",
              id: block.id,
              name: contractToolName(block.name),
            });
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

/** The custom-tool server's name — also the mcp__ prefix stripped
 *  from tool names on the way out (see contractToolName). */
const TOOL_SERVER_NAME = "ottercode";

const MCP_TOOL_PREFIX = `mcp__${TOOL_SERVER_NAME}__`;

function contractToolName(name: string): string {
  return name.startsWith(MCP_TOOL_PREFIX)
    ? name.slice(MCP_TOOL_PREFIX.length)
    : name;
}

/** Maps the seam's tool set onto one in-process MCP server. */
function toMcpServer(tools: readonly AgentCustomTool[]) {
  return createSdkMcpServer({
    name: TOOL_SERVER_NAME,
    version: "1.0.0",
    // Spike finding: without this the CLI defers MCP tools behind its
    // ToolSearch indirection — an extra round trip before the agent
    // even sees the design docs exist.
    alwaysLoad: true,
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: zodShape(tool.inputSchema),
      handler: async (args: unknown) => {
        const result = await tool.execute(args);
        return {
          content: [{ type: "text" as const, text: result.output }],
          ...(result.isError === true ? { isError: true } : {}),
        };
      },
    })),
  });
}

/** TypeBox object schema → Zod raw shape, the supported subset: flat
 *  properties of string/number/boolean, optional unless required. A
 *  schema outside the subset throws — session creation fails loudly
 *  instead of silently widening what the model may send. */
function zodShape(schema: unknown): Record<string, z.ZodType> {
  const object = schema as {
    properties?: Record<string, { type?: string }>;
    required?: string[];
  } | null;
  if (object === null || object.properties === undefined) {
    throw new Error(
      "unsupported custom-tool schema: expected a flat object schema",
    );
  }
  const required = new Set(object.required ?? []);
  const shape: Record<string, z.ZodType> = {};
  for (const [key, property] of Object.entries(object.properties)) {
    let type: z.ZodType;
    switch (property.type) {
      case "string":
        type = z.string();
        break;
      case "number":
        type = z.number();
        break;
      case "boolean":
        type = z.boolean();
        break;
      default:
        throw new Error(
          `unsupported custom-tool schema property: ${key} (${String(property.type)})`,
        );
    }
    shape[key] = required.has(key) ? type : type.optional();
  }
  return shape;
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
