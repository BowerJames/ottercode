/**
 * The language-intelligence module's public face: routing,
 * degradation, and recovery. This class owns the IPC contract's error
 * vocabulary — classification and resolver misses become "no-server",
 * engine crashes and timeouts become "server-error" (with a cooldown
 * so a dead server isn't respawned per keystroke), refusals map per
 * query — and it assembles rename overlays from the request's open
 * documents. Everything server-shaped stays below the engine seam.
 */

import type {
  CompletionResult,
  DefinitionResult,
  LangError,
  RenameRequest,
  RenameResult,
} from "../../shared/ipc/lang.js";
import { type LanguageId, languageIdOf } from "../../shared/lang/languages.js";
import {
  type EngineFactory,
  EngineRefusedError,
  EngineUnavailableError,
  type LanguageEngine,
} from "./language-engine.js";
import type { ServerResolver } from "./server-resolver.js";

/** Per-query timeout budgets (ms). Policy, tunable. */
export type LangTimeouts = {
  definition: number;
  rename: number;
  completion: number;
};

const DEFAULT_TIMEOUTS: LangTimeouts = {
  definition: 10_000,
  rename: 20_000,
  completion: 1_500,
};

/** Marker: the query budget expired. Never crosses the seam. */
class TimeoutFlag extends Error {}

type Attempt<T> =
  | { outcome: "value"; value: T }
  | { outcome: "error"; error: LangError }
  | { outcome: "refused"; refusal: EngineRefusedError };

export class LanguageService {
  private readonly resolver: ServerResolver;
  private readonly createEngine: EngineFactory;
  private readonly now: () => number;
  private readonly cooldownMs: number;
  private readonly timeouts: LangTimeouts;
  private readonly pool = new Map<LanguageId, LanguageEngine>();
  /** Languages whose last attempt failed, and when they may retry. */
  private readonly failures = new Map<
    LanguageId,
    { code: LangError["code"]; at: number }
  >();

  constructor(deps: {
    resolver: ServerResolver;
    createEngine: EngineFactory;
    now?: () => number;
    cooldownMs?: number;
    timeouts?: Partial<LangTimeouts>;
  }) {
    this.resolver = deps.resolver;
    this.createEngine = deps.createEngine;
    this.now = deps.now ?? Date.now;
    this.cooldownMs = deps.cooldownMs ?? 60_000;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...deps.timeouts };
  }

  async definition(
    path: string,
    content: string,
    position: Parameters<LanguageEngine["definition"]>[2],
  ): Promise<DefinitionResult> {
    const attempt = await this.query(path, this.timeouts.definition, (engine) =>
      engine.definition(path, content, position),
    );
    switch (attempt.outcome) {
      case "value":
        return attempt.value === null
          ? { ok: false, error: { code: "no-symbol" } }
          : { ok: true, location: attempt.value };
      case "error":
        return { ok: false, error: attempt.error };
      case "refused":
        return { ok: false, error: { code: "no-symbol" } };
    }
  }

  async rename(request: RenameRequest): Promise<RenameResult> {
    // The overlay carries every OTHER open document; the active one
    // rides `content` (see the contract's tiering clause).
    const overlay = new Map<string, string>();
    for (const doc of request.openDocuments) {
      if (doc.path !== request.path) overlay.set(doc.path, doc.content);
    }
    const attempt = await this.query(
      request.path,
      this.timeouts.rename,
      (engine) =>
        engine.rename(
          request.path,
          request.content,
          request.position,
          request.newName,
          overlay,
        ),
    );
    switch (attempt.outcome) {
      case "value":
        return attempt.value === null
          ? { ok: false, error: { code: "no-symbol" } }
          : { ok: true, edits: attempt.value };
      case "error":
        return { ok: false, error: attempt.error };
      case "refused":
        return {
          ok: false,
          error: { code: "not-renameable", message: attempt.refusal.message },
        };
    }
  }

  async completion(
    path: string,
    content: string,
    position: Parameters<LanguageEngine["completions"]>[2],
  ): Promise<CompletionResult> {
    const attempt = await this.query(path, this.timeouts.completion, (engine) =>
      engine.completions(path, content, position),
    );
    switch (attempt.outcome) {
      case "value":
        return { ok: true, items: attempt.value };
      case "error":
        return { ok: false, error: attempt.error };
      case "refused":
        // A server that offers nothing is an answer, not a failure:
        // completion degrades to silence, never to an error banner.
        return { ok: true, items: [] };
    }
  }

  /** The shared query pipeline: classify → engine (with cooldowns) →
   * run under the budget → normalize the failure vocabulary. */
  private async query<T>(
    path: string,
    timeoutMs: number,
    run: (engine: LanguageEngine) => Promise<T>,
  ): Promise<Attempt<T>> {
    const language = languageIdOf(path);
    if (language === null)
      return { outcome: "error", error: { code: "no-server" } };

    const engine = this.engineFor(language);
    if ("error" in engine) return { outcome: "error", error: engine.error };

    try {
      const value = await this.withBudget(
        run(engine.instance),
        timeoutMs,
        () => {
          this.retire(language, engine.instance, "server-error");
        },
      );
      return { outcome: "value", value };
    } catch (error) {
      if (error instanceof TimeoutFlag) {
        return { outcome: "error", error: { code: "server-error" } };
      }
      if (error instanceof EngineUnavailableError) {
        const code: LangError["code"] =
          error.reason === "spawn" ? "no-server" : "server-error";
        this.retire(language, engine.instance, code);
        return { outcome: "error", error: { code } };
      }
      if (error instanceof EngineRefusedError) {
        return { outcome: "refused", refusal: error };
      }
      return { outcome: "error", error: { code: "unknown" } };
    }
  }

  /** Pooled engine for a language, honouring the failure cooldown.
   * Creation is synchronous (the factory spawns lazily), so
   * concurrent first queries share one engine instead of racing. */
  private engineFor(
    language: LanguageId,
  ): { instance: LanguageEngine } | { error: LangError } {
    const failure = this.failures.get(language);
    if (failure !== undefined) {
      if (this.now() - failure.at < this.cooldownMs) {
        return { error: { code: failure.code } };
      }
      this.failures.delete(language);
    }
    const pooled = this.pool.get(language);
    if (pooled !== undefined) return { instance: pooled };

    const command = this.resolver.resolve(language);
    if (command === null) return { error: { code: "no-server" } };
    try {
      const instance = this.createEngine(language, command);
      this.pool.set(language, instance);
      return { instance };
    } catch (error) {
      if (error instanceof EngineUnavailableError) {
        const code: LangError["code"] =
          error.reason === "spawn" ? "no-server" : "server-error";
        this.failures.set(language, { code, at: this.now() });
        return { error: { code } };
      }
      throw error;
    }
  }

  /** Disposes a failed engine, frees its pool slot, and starts (or
   * restarts) its cooldown window. */
  private retire(
    language: LanguageId,
    engine: LanguageEngine,
    code: LangError["code"],
  ): void {
    if (this.pool.get(language) === engine) this.pool.delete(language);
    this.failures.set(language, { code, at: this.now() });
    engine.dispose();
  }

  /** Rejects with TimeoutFlag when the budget expires; onTimeout has
   * already retired the engine by then. */
  private withBudget<T>(
    promise: Promise<T>,
    ms: number,
    onTimeout: () => void,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        onTimeout();
        reject(new TimeoutFlag());
      }, ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }
}
