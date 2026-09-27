import type {
  AgentCustomTool,
  AgentProvider,
  AgentSession,
} from "../../../src/main/agent/provider.js";
import type {
  AgentEvent,
  AgentThinkingLevel,
} from "../../../src/shared/ipc/agent.js";

/**
 * In-memory double for the provider seam. Implements exactly the seam
 * contract and nothing more: records what the service does (roots,
 * models, tools, prompts, aborts, disposes, thinking levels) and lets
 * tests feed events back through the subscription. The moment it
 * grows an `if` that isn't in the seam's doc comment, it's drifting.
 */
export function createFakeProvider(
  options: { rejectModel?: string; noThinkingControl?: boolean } = {},
): {
  provider: AgentProvider;
  createdRoots: string[];
  requestedModels: Array<string | undefined>;
  /** The custom tools each createSession received, one entry per
   * session the service has created (the swap path re-sends them). */
  receivedTools: Array<readonly AgentCustomTool[]>;
  sentPrompts: string[];
  /** Every setThinkingLevel call, across all sessions the service has
   * created (the reconcile path calls on the fresh one). */
  setLevels: AgentThinkingLevel[];
  aborts: number;
  disposes: number;
  emit(event: AgentEvent): void;
} {
  const createdRoots: string[] = [];
  const requestedModels: Array<string | undefined> = [];
  const receivedTools: Array<readonly AgentCustomTool[]> = [];
  const sentPrompts: string[] = [];
  const setLevels: AgentThinkingLevel[] = [];
  let aborts = 0;
  let disposes = 0;
  let handler: ((event: AgentEvent) => void) | undefined;

  const session: AgentSession = {
    send(prompt) {
      sentPrompts.push(prompt);
    },
    abort() {
      aborts += 1;
    },
    onEvent(h) {
      handler = h;
    },
    dispose() {
      disposes += 1;
      handler = undefined; // a disposed session emits nothing further
    },
    ...(options.noThinkingControl
      ? {}
      : {
          setThinkingLevel(level: AgentThinkingLevel) {
            setLevels.push(level);
          },
        }),
  };

  const provider: AgentProvider = {
    async createSession({ root, model, tools }) {
      if (model !== undefined && model === options.rejectModel) {
        throw new Error(`model unavailable: ${model}`);
      }
      createdRoots.push(root);
      requestedModels.push(model);
      receivedTools.push(tools ?? []);
      return { session, model: model ?? "fake-default", thinkingLevel: "off" };
    },

    async listModels() {
      return [
        {
          id: "fake-default",
          label: "Fake Default",
          thinkingLevels: ["off", "low", "medium", "high"],
        },
        { id: "fake-2", label: "Fake Two", thinkingLevels: ["off", "high"] },
        { id: "fake-plain", label: "Fake Plain", thinkingLevels: [] },
      ];
    },
  };

  return {
    provider,
    createdRoots,
    requestedModels,
    receivedTools,
    sentPrompts,
    setLevels,
    get aborts() {
      return aborts;
    },
    get disposes() {
      return disposes;
    },
    emit(event) {
      handler?.(event);
    },
  };
}

/** A provider whose session creation always fails (e.g. missing CLI). */
export function createFailingProvider(): AgentProvider {
  return {
    async createSession() {
      throw new Error("provider unavailable");
    },
  };
}
