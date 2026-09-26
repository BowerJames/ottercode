import type {
  AgentProvider,
  AgentSession,
} from "../../../src/main/agent/provider.js";
import type { AgentEvent } from "../../../src/shared/ipc/agent.js";

/**
 * In-memory double for the provider seam. Implements exactly the seam
 * contract and nothing more: records what the service does (roots,
 * prompts, aborts) and lets tests feed events back through the
 * subscription. The moment it grows an `if` that isn't in the seam's
 * doc comment, it's drifting.
 */
export function createFakeProvider(): {
  provider: AgentProvider;
  createdRoots: string[];
  sentPrompts: string[];
  aborts: number;
  emit(event: AgentEvent): void;
} {
  const createdRoots: string[] = [];
  const sentPrompts: string[] = [];
  let aborts = 0;
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
      handler = undefined;
    },
  };

  const provider: AgentProvider = {
    async createSession({ root }) {
      createdRoots.push(root);
      return session;
    },
  };

  return {
    provider,
    createdRoots,
    sentPrompts,
    get aborts() {
      return aborts;
    },
    emit(event) {
      handler?.(event);
    },
  };
}
