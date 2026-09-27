import type {
  AgentEvent,
  AgentModelInfo,
  AgentProviderInfo,
  AgentReconfigResult,
  AgentSelectionSubmitRequest,
  AgentSetThinkingResult,
  AgentSubmitRequest,
  AgentSubmitResult,
  AgentThinkingLevel,
} from "../../shared/ipc/agent.js";
import { composePrompt, composeSelectionPrompt } from "./compose-prompt.js";
import type {
  AgentCustomTool,
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
 * event forwarding, abort, and session replacement — provider swaps,
 * model changes, and new chats all flow through the same swap path.
 * Swapping creates the new session FIRST (a failed switch leaves the
 * old one running), then cancels the old — an in-flight turn ends
 * without a terminator event (see AgentEvent). The thinking level is
 * the exception to replacement: it changes live on the session, and
 * swaps try to carry it across (dropped when the new model doesn't
 * offer it).
 */
export class AgentService {
  private readonly root: string;
  private readonly providers: AgentProviders;
  private readonly sink: AgentEventSink;
  private activeName: string;
  private activeModel: string;
  private activeThinking: AgentThinkingLevel;
  private readonly tools: readonly AgentCustomTool[];
  private session: AgentSession;

  private constructor(
    root: string,
    providers: AgentProviders,
    initial: string,
    session: AgentSession,
    model: string,
    thinkingLevel: AgentThinkingLevel,
    tools: readonly AgentCustomTool[],
    sink: AgentEventSink,
  ) {
    this.root = root;
    this.providers = providers;
    this.activeName = initial;
    this.activeModel = model;
    this.activeThinking = thinkingLevel;
    this.tools = tools;
    this.session = session;
    this.sink = sink;
  }

  static async create(
    root: string,
    providers: AgentProviders,
    initial: string,
    sink: AgentEventSink,
    tools: readonly AgentCustomTool[] = [],
  ): Promise<AgentService> {
    const provider = providers[initial];
    if (provider === undefined) {
      throw new Error(`unknown provider: ${initial}`);
    }
    const { session, model, thinkingLevel } = await provider.createSession({
      root,
      requestPermission: autoAllow,
      tools,
    });
    const service = new AgentService(
      root,
      providers,
      initial,
      session,
      model,
      thinkingLevel,
      tools,
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

  /** The focused-turn twin of submit: same mechanical delegation, the
   * selection-format entry of the compose-prompt seam. Same session,
   * same event stream — a selection turn is still a turn. */
  async submitSelection(
    request: AgentSelectionSubmitRequest,
  ): Promise<AgentSubmitResult> {
    this.session.send(composeSelectionPrompt(request));
    return { ok: true };
  }

  abort(): void {
    this.session.abort();
  }

  private readonly modelCache = new Map<string, readonly AgentModelInfo[]>();

  /** The provider's models, lazily fetched and cached. Throws when the
   * provider is unknown or enumeration fails — callers that can
   * degrade catch and fall back. */
  private async modelsFor(name: string): Promise<readonly AgentModelInfo[]> {
    const provider = this.providers[name];
    if (provider === undefined) {
      throw new Error(`unknown provider: ${name}`);
    }
    let models = this.modelCache.get(name);
    if (models === undefined) {
      models = (await provider.listModels?.()) ?? [];
      this.modelCache.set(name, models);
    }
    return models;
  }

  async getProviderInfo(): Promise<AgentProviderInfo> {
    const models = [...(await this.modelsFor(this.activeName))];
    const levels =
      models.find((m) => m.id === this.activeModel)?.thinkingLevels ?? [];
    // The picker renders only a real choice: ≥2 offered levels AND a
    // session that can actually change them.
    const thinking =
      this.session.setThinkingLevel !== undefined && levels.length > 1
        ? { level: this.activeThinking, levels: [...levels] }
        : null;
    return {
      provider: this.activeName,
      available: Object.keys(this.providers),
      model: this.activeModel,
      models,
      thinking,
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

  /** Sets the thinking level on the LIVE session — no replacement, so
   * the transcript and any in-flight turn stand. Validated against
   * the active model's levels BEFORE the session is touched, so ok
   * means the requested level took effect exactly as requested. */
  async setThinkingLevel(
    level: AgentThinkingLevel,
  ): Promise<AgentSetThinkingResult> {
    const setOnSession = this.session.setThinkingLevel;
    if (setOnSession === undefined) {
      return { ok: false, error: { code: "unsupported" } };
    }
    const levels = await this.modelsFor(this.activeName).catch(() => []);
    const offered =
      levels.find((m) => m.id === this.activeModel)?.thinkingLevels ?? [];
    if (!offered.includes(level)) {
      return { ok: false, error: { code: "unsupported" } };
    }
    setOnSession.call(this.session, level);
    this.activeThinking = level;
    return { ok: true };
  }

  /** Starts a new chat: a fresh session from the SAME provider with
   * the SAME active model — pickers' state stays valid, so callers
   * need no info refetch. Mid-turn, the in-flight turn is cancelled
   * without a terminator (swap clause): callers reset on this
   * response, not on events. */
  async newChat(): Promise<AgentReconfigResult> {
    return this.swapSession(this.activeName, this.activeModel);
  }

  /** The one replacement path (the landmine lives exactly once):
   * session replacement — provider swap, model change, or new chat.
   * Create the new session FIRST — a failed reconfiguration leaves
   * the old one running — then cancel the old. An in-flight turn
   * ends WITHOUT a terminator event (see the AgentEvent bracket
   * clause). The user's thinking level rides across when the new
   * session's model offers it (set live on the fresh session); a
   * model that doesn't offer it falls back to the provider's default. */
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
    let nextThinking: AgentThinkingLevel;
    try {
      const created = await provider.createSession({
        root: this.root,
        model,
        requestPermission: autoAllow,
        tools: this.tools,
      });
      next = created.session;
      nextModel = created.model;
      nextThinking = created.thinkingLevel;
    } catch {
      return { ok: false, error: { code: "unavailable" } };
    }
    this.session.dispose();
    this.session = next;
    this.activeName = providerName;
    this.activeModel = nextModel;
    this.activeThinking = await this.reconcileThinking(
      next,
      providerName,
      nextModel,
      nextThinking,
    );
    this.session.onEvent(this.sink);
    this.modelCache.delete(providerName); // refetch on next info call
    return { ok: true };
  }

  /** Carries the user's thinking level across a swap: when the fresh
   * session came up at a different level, supports live changes, and
   * the resolved model offers the old level, set it; otherwise the
   * fresh session's resolved default stands. Model enumeration
   * failing degrades to the default — never fails the swap. */
  private async reconcileThinking(
    session: AgentSession,
    providerName: string,
    resolvedModel: string,
    resolvedLevel: AgentThinkingLevel,
  ): Promise<AgentThinkingLevel> {
    if (resolvedLevel === this.activeThinking) return resolvedLevel;
    const setOnSession = session.setThinkingLevel;
    if (setOnSession === undefined) return resolvedLevel;
    const models = await this.modelsFor(providerName).catch(() => []);
    const offered =
      models.find((m) => m.id === resolvedModel)?.thinkingLevels ?? [];
    if (!offered.includes(this.activeThinking)) return resolvedLevel;
    setOnSession.call(session, this.activeThinking);
    return this.activeThinking;
  }
}
