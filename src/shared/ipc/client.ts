import type {
  AgentEvent,
  AgentProviderInfo,
  AgentReconfigResult,
  AgentSelectionSubmitRequest,
  AgentSetThinkingResult,
  AgentSubmitRequest,
  AgentSubmitResult,
  AgentThinkingLevel,
  SetModelRequest,
  SetProviderRequest,
  SetThinkingLevelRequest,
} from "./agent.js";
import {
  AGENT_ABORT_CHANNEL,
  AGENT_EVENTS_CHANNEL,
  AGENT_NEW_CHAT_CHANNEL,
  AGENT_PROVIDER_CHANNEL,
  AGENT_SET_MODEL_CHANNEL,
  AGENT_SET_PROVIDER_CHANNEL,
  AGENT_SET_THINKING_CHANNEL,
  AGENT_SUBMIT_CHANNEL,
  AGENT_SUBMIT_SELECTION_CHANNEL,
  FS_LIST_CHILDREN_CHANNEL,
  FS_READ_FILE_CHANNEL,
  FS_ROOT_CHANNEL,
  GIT_STATUS_CHANNEL,
  LANG_COMPLETION_CHANNEL,
  LANG_DEFINITION_CHANNEL,
  LANG_RENAME_CHANNEL,
  TERMINAL_ABORT_CHANNEL,
  TERMINAL_EVENTS_CHANNEL,
  TERMINAL_RUN_CHANNEL,
  VDOC_CHANGED_CHANNEL,
  VDOC_CREATE_CHANNEL,
  VDOC_DELETE_CHANNEL,
  VDOC_LIST_CHANNEL,
  VDOC_READ_CHANNEL,
  VDOC_UPDATE_CHANNEL,
} from "./channels.js";
import type {
  ListChildrenRequest,
  ListChildrenResult,
  ReadFileRequest,
  ReadFileResult,
  RootResult,
} from "./fs.js";
import type { GitStatusResult } from "./git.js";
import type {
  CompletionRequest,
  CompletionResult,
  DefinitionRequest,
  DefinitionResult,
  RenameRequest,
  RenameResult,
} from "./lang.js";
import type {
  TerminalEvent,
  TerminalRunRequest,
  TerminalRunResult,
} from "./terminal.js";
import type {
  VDocChange,
  VDocCreateRequest,
  VDocCreateResult,
  VDocDeleteResult,
  VDocListResult,
  VDocName,
  VDocReadResult,
  VDocUpdateRequest,
  VDocUpdateResult,
} from "./vdoc.js";

/**
 * The transport seam. The real adapter is preload's ipcRenderer bridge
 * (invoke + push events); the test adapter is an in-memory fake.
 * Channel-name strings and payload assembly live here and nowhere else
 * on the renderer side — both sides of the wire share the same
 * constants and types, so contract wiring drift is a compile error.
 */
export type Invoke = (channel: string, request: unknown) => Promise<unknown>;

/** Subscribe to a push channel; returns the unsubscribe function. */
export type Subscribe = (
  channel: string,
  listener: (payload: unknown) => void,
) => () => void;

export type ClientTransport = {
  invoke: Invoke;
  subscribe: Subscribe;
};

/** The only door the renderer uses to reach the main process. */
export interface OttercodeClient {
  fs: {
    root(): Promise<RootResult>;
    listChildren(path: string): Promise<ListChildrenResult>;
    readFile(path: string): Promise<ReadFileResult>;
  };
  git: {
    status(): Promise<GitStatusResult>;
  };
  lang: {
    /** Where the symbol at a position is defined. */
    definition(request: DefinitionRequest): Promise<DefinitionResult>;
    /** Compute a workspace-wide rename's edits (never writes disk). */
    rename(request: RenameRequest): Promise<RenameResult>;
    /** Completion candidates at a position. */
    completion(request: CompletionRequest): Promise<CompletionResult>;
  };
  terminal: {
    /** Run one command. Fire-and-forget — outcome arrives on events. */
    run(command: string): Promise<TerminalRunResult>;
    /** Kill the running command (no-op when idle). */
    abort(): Promise<void>;
    /** Subscribe to the terminal event stream. Returns unsubscribe. */
    onEvent(handler: (event: TerminalEvent) => void): () => void;
  };
  agent: {
    submit(request: AgentSubmitRequest): Promise<AgentSubmitResult>;
    /** Submit a focused turn: message + one selection, nothing else
     * attaches (see AgentSelectionSubmitRequest). */
    submitSelection(
      request: AgentSelectionSubmitRequest,
    ): Promise<AgentSubmitResult>;
    abort(): Promise<void>;
    /** Subscribe to the agent event stream. Returns unsubscribe. */
    onEvent(handler: (event: AgentEvent) => void): () => void;
    provider(): Promise<AgentProviderInfo>;
    setProvider(provider: string): Promise<AgentReconfigResult>;
    setModel(model: string): Promise<AgentReconfigResult>;
    /** Set the thinking level live — the session is NOT replaced. */
    setThinking(level: AgentThinkingLevel): Promise<AgentSetThinkingResult>;
    /** Replace the session with a fresh one (same provider + model).
     * The response — not events — is the reset signal for consumers. */
    newChat(): Promise<AgentReconfigResult>;
  };
  vdoc: {
    /** All docs with their current versions. Cannot fail. */
    list(): Promise<VDocListResult>;
    /** Create a doc with content from birth (no empty genesis). */
    create(name: VDocName, content: string): Promise<VDocCreateResult>;
    /** One doc's whole content and the version a later update must
     * name. */
    read(name: VDocName): Promise<VDocReadResult>;
    /** Replace content; expectedVersion guards against clobbering. */
    update(
      name: VDocName,
      content: string,
      expectedVersion: number,
    ): Promise<VDocUpdateResult>;
    /** Delete a doc (user-initiated; the agent toolset has no
     * delete). */
    delete(name: VDocName): Promise<VDocDeleteResult>;
    /** Subscribe to the change stream. Returns unsubscribe. */
    onChange(handler: (change: VDocChange) => void): () => void;
  };
}

export function createClient(transport: ClientTransport): OttercodeClient {
  const { invoke, subscribe } = transport;
  return {
    fs: {
      root() {
        // The cast is the one crossing of Electron's untyped wire: safe
        // because the glue handler is compiled against the same types.
        return invoke(FS_ROOT_CHANNEL, {}) as Promise<RootResult>;
      },
      listChildren(path: string) {
        // Typed construction: a malformed request is a compile error.
        const request: ListChildrenRequest = { path };
        return invoke(
          FS_LIST_CHILDREN_CHANNEL,
          request,
        ) as Promise<ListChildrenResult>;
      },
      readFile(path: string) {
        const request: ReadFileRequest = { path };
        return invoke(FS_READ_FILE_CHANNEL, request) as Promise<ReadFileResult>;
      },
    },
    git: {
      status() {
        return invoke(GIT_STATUS_CHANNEL, {}) as Promise<GitStatusResult>;
      },
    },
    lang: {
      definition(request: DefinitionRequest) {
        return invoke(
          LANG_DEFINITION_CHANNEL,
          request,
        ) as Promise<DefinitionResult>;
      },
      rename(request: RenameRequest) {
        return invoke(LANG_RENAME_CHANNEL, request) as Promise<RenameResult>;
      },
      completion(request: CompletionRequest) {
        return invoke(
          LANG_COMPLETION_CHANNEL,
          request,
        ) as Promise<CompletionResult>;
      },
    },
    terminal: {
      run(command: string) {
        const request: TerminalRunRequest = { command };
        return invoke(
          TERMINAL_RUN_CHANNEL,
          request,
        ) as Promise<TerminalRunResult>;
      },
      abort() {
        return invoke(TERMINAL_ABORT_CHANNEL, {}) as Promise<void>;
      },
      onEvent(handler) {
        return subscribe(TERMINAL_EVENTS_CHANNEL, (payload) =>
          handler(payload as TerminalEvent),
        );
      },
    },
    agent: {
      submit(request: AgentSubmitRequest) {
        return invoke(
          AGENT_SUBMIT_CHANNEL,
          request,
        ) as Promise<AgentSubmitResult>;
      },
      submitSelection(request: AgentSelectionSubmitRequest) {
        return invoke(
          AGENT_SUBMIT_SELECTION_CHANNEL,
          request,
        ) as Promise<AgentSubmitResult>;
      },
      abort() {
        return invoke(AGENT_ABORT_CHANNEL, {}) as Promise<void>;
      },
      onEvent(handler) {
        return subscribe(AGENT_EVENTS_CHANNEL, (payload) =>
          handler(payload as AgentEvent),
        );
      },
      provider() {
        return invoke(AGENT_PROVIDER_CHANNEL, {}) as Promise<AgentProviderInfo>;
      },
      setProvider(provider: string) {
        const request: SetProviderRequest = { provider };
        return invoke(
          AGENT_SET_PROVIDER_CHANNEL,
          request,
        ) as Promise<AgentReconfigResult>;
      },
      setModel(model: string) {
        const request: SetModelRequest = { model };
        return invoke(
          AGENT_SET_MODEL_CHANNEL,
          request,
        ) as Promise<AgentReconfigResult>;
      },
      setThinking(level: AgentThinkingLevel) {
        const request: SetThinkingLevelRequest = { level };
        return invoke(
          AGENT_SET_THINKING_CHANNEL,
          request,
        ) as Promise<AgentSetThinkingResult>;
      },
      newChat() {
        return invoke(
          AGENT_NEW_CHAT_CHANNEL,
          {},
        ) as Promise<AgentReconfigResult>;
      },
    },
    vdoc: {
      list() {
        return invoke(VDOC_LIST_CHANNEL, {}) as Promise<VDocListResult>;
      },
      create(name: VDocName, content: string) {
        const request: VDocCreateRequest = { name, content };
        return invoke(
          VDOC_CREATE_CHANNEL,
          request,
        ) as Promise<VDocCreateResult>;
      },
      read(name: VDocName) {
        return invoke(VDOC_READ_CHANNEL, { name }) as Promise<VDocReadResult>;
      },
      update(name: VDocName, content: string, expectedVersion: number) {
        const request: VDocUpdateRequest = { name, content, expectedVersion };
        return invoke(
          VDOC_UPDATE_CHANNEL,
          request,
        ) as Promise<VDocUpdateResult>;
      },
      delete(name: VDocName) {
        return invoke(VDOC_DELETE_CHANNEL, {
          name,
        }) as Promise<VDocDeleteResult>;
      },
      onChange(handler) {
        return subscribe(VDOC_CHANGED_CHANNEL, (payload) =>
          handler(payload as VDocChange),
        );
      },
    },
  };
}
