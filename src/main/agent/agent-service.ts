import type {
  AgentEvent,
  AgentProviderInfo,
  AgentSubmitRequest,
  AgentSubmitResult,
  SetProviderResult,
} from "../../shared/ipc/agent.js";
import type {
  AgentPermissionDecision,
  AgentProvider,
  AgentSession,
} from "./provider.js";

/** Pushes agent events out of main: webContents.send in production, a
 * recording fake in tests. */
export type AgentEventSink = (event: AgentEvent) => void;

/** The registered providers, by name. */
export type AgentProviders = Readonly<Record<string, AgentProvider>>;

/**
 * v1 permission policy: auto-allow. Product ruling — the agent is the
 * designated workspace writer, at parity with pi (which runs ungated).
 * The approval-card UI lands here later as a policy swap: round-trip
 * to the renderer instead of answering instantly. The deny arm stays
 * in the decision type so that swap needs nothing below it.
 */
const autoAllow = async (): Promise<AgentPermissionDecision> => ({
  behavior: "allow",
});

/**
 * Owns the agent session(s): creation, submission (message-only in v1 —
 * prompt composition grows when attachments land), event forwarding,
 * abort, and provider swapping. Swapping creates the new session FIRST
 * (a failed switch leaves the old one running), then cancels the old —
 * an in-flight turn ends without a terminator event (see AgentEvent).
 */
export class AgentService {
  private readonly root: string;
  private readonly providers: AgentProviders;
  private readonly sink: AgentEventSink;
  private activeName: string;
  private session: AgentSession;

  private constructor(
    root: string,
    providers: AgentProviders,
    initial: string,
    session: AgentSession,
    sink: AgentEventSink,
  ) {
    this.root = root;
    this.providers = providers;
    this.activeName = initial;
    this.session = session;
    this.sink = sink;
  }

  static async create(
    root: string,
    providers: AgentProviders,
    initial: string,
    sink: AgentEventSink,
  ): Promise<AgentService> {
    const provider = providers[initial];
    if (provider === undefined) {
      throw new Error(`unknown provider: ${initial}`);
    }
    const session = await provider.createSession({
      root,
      requestPermission: autoAllow,
    });
    const service = new AgentService(root, providers, initial, session, sink);
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

  getProvider(): AgentProviderInfo {
    return {
      provider: this.activeName,
      available: Object.keys(this.providers),
    };
  }

  async setProvider(name: string): Promise<SetProviderResult> {
    if (name === this.activeName) {
      return { ok: true };
    }
    const provider = this.providers[name];
    if (provider === undefined) {
      return { ok: false, error: { code: "unavailable" } };
    }
    // Create FIRST: a failed switch must leave the old session (and
    // its in-flight turn) untouched.
    let next: AgentSession;
    try {
      next = await provider.createSession({
        root: this.root,
        requestPermission: autoAllow,
      });
    } catch {
      return { ok: false, error: { code: "unavailable" } };
    }
    // Then cancel: dispose ends any in-flight turn WITHOUT a
    // terminator event — consumers reset via this swap's response
    // (see the AgentEvent bracket clause).
    this.session.dispose();
    this.session = next;
    this.activeName = name;
    this.session.onEvent(this.sink);
    return { ok: true };
  }
}
