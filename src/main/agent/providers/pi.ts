import {
  type AgentSessionEvent,
  createAgentSession,
  ModelRuntime,
  type AgentSession as PiSession,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentEvent,
  AgentModelInfo,
  AgentThinkingLevel,
} from "../../../shared/ipc/agent.js";
import type {
  AgentCustomTool,
  AgentProvider,
  AgentSession,
  AgentSessionOptions,
  CreatedAgentSession,
} from "../provider.js";

/**
 * The pi adapter: in-process SDK. This file is the pi fence — pi events
 * and model machinery are translated to contract shapes here, and pi
 * upgrades touch only here. Real-boundary code, unverified at unit
 * level (like real-workspace-fs): verified by running the app, later
 * by E2E.
 *
 * Models: a shared ModelRuntime enumerates the AUTHED models
 * (getAvailable — exactly the legitimate switch targets) and resolves
 * the requested id to a Model object; enumeration and session share
 * one runtime so they cannot disagree.
 *
 * Event mapping: turn_start/turn_end → the turn bracket;
 * message_update's text_delta events → append-only assistant deltas;
 * tool_execution_* → tool-start/end (toolCallId is the opaque pairing
 * token). Everything else is dropped.
 */

let runtimePromise: Promise<ModelRuntime> | undefined;

const runtime = (): Promise<ModelRuntime> =>
  (runtimePromise ??= ModelRuntime.create());

/** Resolves a model id against the AUTHED set — the legitimate switch
 * targets, and nothing else. */
const findModel = async (rt: ModelRuntime, id: string) =>
  (await rt.getAvailable()).find((m) => m.id === id);

/** The full thinking-level vocabulary, lowest to highest. */
const ALL_THINKING_LEVELS: readonly AgentThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** Mirrors pi-ai's getSupportedThinkingLevels (a transitive dependency
 * we deliberately don't import): "off" is always available on
 * non-reasoning models; a thinkingLevelMap entry of null drops that
 * level; xhigh/max need an explicit entry; every other level defaults
 * to supported. */
function supportedThinkingLevels(model: {
  reasoning: boolean;
  thinkingLevelMap?: Record<string, string | null | undefined>;
}): AgentThinkingLevel[] {
  if (!model.reasoning) return ["off"];
  return ALL_THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}

export const piProvider: AgentProvider = {
  async createSession({
    root,
    model,
    tools,
  }: AgentSessionOptions): Promise<CreatedAgentSession> {
    const rt = await runtime();
    const resolved =
      model !== undefined ? await findModel(rt, model) : undefined;
    if (model !== undefined && resolved === undefined) {
      throw new Error(`model unavailable: ${model}`);
    }
    const { session } = await createAgentSession({
      cwd: root,
      ...(resolved !== undefined ? { model: resolved } : {}),
      modelRuntime: rt,
      ...(tools !== undefined && tools.length > 0
        ? { customTools: tools.map(toPiTool) }
        : {}),
    });
    return {
      session: wrapPiSession(session),
      model: session.model?.id ?? resolved?.id ?? "pi-default",
      thinkingLevel: session.thinkingLevel,
    };
  },

  async listModels(): Promise<readonly AgentModelInfo[]> {
    const rt = await runtime();
    const models = await rt.getAvailable();
    return models.map((m) => ({
      id: m.id,
      label: m.name,
      thinkingLevels: supportedThinkingLevels(m),
    }));
  },
};

/** Maps a contract tool onto pi's ToolDefinition. Two native
 *  conventions differ from the seam's, both absorbed here:
 * - Failure: the seam reports errors as values; pi's convention is a
 *   thrown Error (pi turns it into a failed tool result, so the
 *   model still reads the recovery prose).
 * - Execution: custom tools share mutable in-process state (the vdoc
 *   store), and pi may run one message's tool calls in parallel —
 *   sequential keeps read/write composes race-free. */
function toPiTool(tool: AgentCustomTool): ToolDefinition {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    ...(tool.promptSnippet !== undefined
      ? { promptSnippet: tool.promptSnippet }
      : {}),
    parameters: tool.inputSchema,
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const result = await tool.execute(params);
      if (result.isError) {
        throw new Error(result.output);
      }
      return {
        content: [{ type: "text", text: result.output }],
        details: undefined,
      };
    },
  };
}

function wrapPiSession(session: PiSession): AgentSession {
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
    setThinkingLevel(level) {
      // Live on the running session — no replacement, and the level
      // was validated against the model's levels by the service.
      session.setThinkingLevel(level);
    },
    onEvent(h) {
      handler = h;
    },
    dispose() {
      session.dispose();
    },
  };
}

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
