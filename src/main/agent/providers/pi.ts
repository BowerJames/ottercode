import {
  type AgentSessionEvent,
  createAgentSession,
  ModelRuntime,
  type AgentSession as PiSession,
} from "@earendil-works/pi-coding-agent";
import type { AgentEvent, AgentModelInfo } from "../../../shared/ipc/agent.js";
import type {
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

export const piProvider: AgentProvider = {
  async createSession({
    root,
    model,
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
    });
    return {
      session: wrapPiSession(session),
      model: session.model?.id ?? resolved?.id ?? "pi-default",
    };
  },

  async listModels(): Promise<readonly AgentModelInfo[]> {
    const rt = await runtime();
    const models = await rt.getAvailable();
    return models.map((m) => ({ id: m.id, label: m.name }));
  },
};

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
