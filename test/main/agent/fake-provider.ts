import type {
  AgentProvider,
  AgentSession,
} from "../../../src/main/agent/provider.js";
import type { AgentEvent } from "../../../src/shared/ipc/agent.js";

/**
 * In-memory double for the provider seam. Implements exactly the seam
 * contract and nothing more: records what the service does (roots,
 * models, prompts, aborts, disposes) and lets tests feed events back
 * through the subscription. The moment it grows an `if` that isn't in
 * the seam's doc comment, it's drifting.
 */
export function createFakeProvider(options: { rejectModel?: string } = {}): {
  provider: AgentProvider;
  createdRoots: string[];
  requestedModels: Array<string | undefined>;
  sentPrompts: string[];
  aborts: number;
  disposes: number;
  emit(event: AgentEvent): void;
} {
  const createdRoots: string[] = [];
  const requestedModels: Array<string | undefined> = [];
  const sentPrompts: string[] = [];
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
  };

  const provider: AgentProvider = {
    async createSession({ root, model }) {
      if (model !== undefined && model === options.rejectModel) {
        throw new Error(`model unavailable: ${model}`);
      }
      createdRoots.push(root);
      requestedModels.push(model);
      return { session, model: model ?? "fake-default" };
    },

    async listModels() {
      return [
        { id: "fake-default", label: "Fake Default" },
        { id: "fake-2", label: "Fake Two" },
      ];
    },
  };

  return {
    provider,
    createdRoots,
    requestedModels,
    sentPrompts,
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
