import type {
  AgentEvent,
  AgentSubmitRequest,
  AgentSubmitResult,
} from "../../shared/ipc/agent.js";
import type { AgentProvider, AgentSession } from "./provider.js";

/** Pushes agent events out of main: webContents.send in production, a
 * recording fake in tests. */
export type AgentEventSink = (event: AgentEvent) => void;

/**
 * Owns the agent session: creation, submission (message-only in v1 —
 * prompt composition grows when attachments land), event forwarding,
 * and abort. One session for the app's lifetime in v1. Created via the
 * async factory — session creation is async by nature (models load,
 * processes spawn).
 */
export class AgentService {
  private readonly session: AgentSession;

  private constructor(session: AgentSession, _sink: AgentEventSink) {
    this.session = session;
  }

  static async create(
    root: string,
    provider: AgentProvider,
    sink: AgentEventSink,
  ): Promise<AgentService> {
    const session = await provider.createSession({ root });
    const service = new AgentService(session, sink);
    session.onEvent(sink); // forward everything, verbatim
    return service;
  }

  async submit(request: AgentSubmitRequest): Promise<AgentSubmitResult> {
    // v1 prompt composition: the identity. Attachments (diffs,
    // comments) grow here — product logic, provider-agnostic.
    this.session.send(request.message);
    return { ok: true };
  }

  abort(): void {
    this.session.abort();
  }
}
