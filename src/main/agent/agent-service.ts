import type {
  AgentEvent,
  AgentModelInfo,
  AgentProviderInfo,
  AgentReconfigResult,
  AgentSubmitRequest,
  AgentSubmitResult,
} from "../../shared/ipc/agent.js";
import { composePrompt } from "./compose-prompt.js";
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
 * Owns the agent session(s): creation, submission (message plus the
 * user's in-editor edits, composed into a prompt by compose-prompt),
 * event forwarding, abort, and provider swapping. Swapping creates the new session FIRST
 * (a failed switch leaves the old one running), then cancels the old —
 * an in-flight turn ends without a terminator event (see AgentEvent).
 */
export class AgentService {
  private readonly root: string;
  private readonly providers: AgentProviders;
  private readonly sink: AgentEventSink;
  private activeName: string;
  private activeModel: string;
  private session: AgentSession;

  private constructor(
    root: string,
    providers: AgentProviders,
    initial: string,
    session: AgentSession,
    model: string,
    sink: AgentEventSink,
  ) {
    this.root = root;
    this.providers = providers;
    this.activeName = initial;
    this.activeModel = model;
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
    const { session, model } = await provider.createSession({
      root,
      requestPermission: autoAllow,
    });
    const service = new AgentService(
      root,
      providers,
      initial,
      session,
      model,
      sink,
    );
    session.onEvent(sink); // forward everything, verbatim
    return service;
  }

  async submit(request: AgentSubmitRequest): Promise<AgentSubmitResult> {
    // Prompt composition (message + editor edits -> prompt text) lives
    // behind the compose-prompt seam; this stays a mechanical delegator.
    this.session.send(composePrompt(request));
    return { ok: true };
  }

  abort(): void {
    this.session.abort();
  }

  private readonly modelCache = new Map<string, readonly AgentModelInfo[]>();

  async getProviderInfo(): Promise<AgentProviderInfo> {
    const provider = this.providers[this.activeName];
    if (provider === undefined) {
      throw new Error(`unknown provider: ${this.activeName}`);
    }
    let models = this.modelCache.get(this.activeName);
    if (models === undefined) {
      models = (await provider.listModels?.()) ?? [];
      this.modelCache.set(this.activeName, models);
    }
    return {
      provider: this.activeName,
      available: Object.keys(this.providers),
      model: this.activeModel,
      models: [...models],
    };
  }

  async setProvider(name: string): Promise<AgentReconfigResult> {
    if (name === this.activeName) {
      return { ok: true };
    }
    return this.swapSession(name, undefined);
  }

  async setModel(model: string): Promise<AgentReconfigResult> {
    return this.swapSession(this.activeName, model);
  }

  /** The one swap path (the landmine lives exactly once): create the
   * new session FIRST — a failed reconfiguration leaves the old one
   * running — then cancel the old. An in-flight turn ends WITHOUT a
   * terminator event (see the AgentEvent bracket clause). */
  private async swapSession(
    providerName: string,
    model: string | undefined,
  ): Promise<AgentReconfigResult> {
    const provider = this.providers[providerName];
    if (provider === undefined) {
      return { ok: false, error: { code: "unavailable" } };
    }
    let next: AgentSession;
    let nextModel: string;
    try {
      const created = await provider.createSession({
        root: this.root,
        model,
        requestPermission: autoAllow,
      });
      next = created.session;
      nextModel = created.model;
    } catch {
      return { ok: false, error: { code: "unavailable" } };
    }
    this.session.dispose();
    this.session = next;
    this.activeName = providerName;
    this.activeModel = nextModel;
    this.session.onEvent(this.sink);
    this.modelCache.delete(providerName); // refetch on next info call
    return { ok: true };
  }
}
