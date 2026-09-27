import { describe, expect, it } from "vitest";
import {
  type EngineFactory,
  EngineRefusedError,
  EngineUnavailableError,
} from "../../../src/main/language/language-engine.js";
import { LanguageService } from "../../../src/main/language/language-service.js";
import type { ServerResolver } from "../../../src/main/language/server-resolver.js";
import { FakeLanguageEngine } from "./fake-language-engine.js";

/**
 * Permanent suite. The service IS the IPC contract's backend — every
 * mapping pinned here (no-server degradation, cooldown windows,
 * timeout disposal, refusal codes) is a promise the renderer's UX
 * consumes. The engine and resolver are fakes; nothing here touches a
 * process, the filesystem, or a clock.
 */

const TS_COMMAND = { command: "typescript-language-server", args: ["--stdio"] };

function makeService(
  options: {
    resolve?: ServerResolver["resolve"];
    /** Pre-built engine(s) the factory hands out, in order. */
    engines?: FakeLanguageEngine[];
    createEngine?: EngineFactory;
    cooldownMs?: number;
    timeouts?: { definition: number; rename: number; completion: number };
  } = {},
) {
  const created: FakeLanguageEngine[] = [];
  let next = 0;
  let clock = 1_000;
  const fallbackFactory: EngineFactory = () => {
    const engine = options.engines?.[next++] ?? new FakeLanguageEngine();
    created.push(engine);
    return engine;
  };
  const service = new LanguageService({
    resolver: { resolve: options.resolve ?? (() => TS_COMMAND) },
    createEngine: options.createEngine ?? fallbackFactory,
    now: () => clock,
    cooldownMs: options.cooldownMs ?? 60_000,
    timeouts: options.timeouts,
  });
  return {
    service,
    /** Every engine the factory created (or reused from options). */
    created,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("LanguageService — routing & degradation", () => {
  it("refuses unclassified files without consulting the resolver", async () => {
    let resolverCalls = 0;
    const { service, created } = makeService({
      resolve: () => {
        resolverCalls++;
        return TS_COMMAND;
      },
    });

    const result = await service.definition("/ws/notes.txt", "plain", {
      line: 0,
      character: 0,
    });

    expect(result).toEqual({ ok: false, error: { code: "no-server" } });
    expect(resolverCalls).toBe(0);
    expect(created).toHaveLength(0);
  });

  it("refuses with no-server when no binary resolves", async () => {
    const { service, created } = makeService({ resolve: () => null });

    const result = await service.definition("/ws/a.ts", "x", {
      line: 0,
      character: 0,
    });

    expect(result).toEqual({ ok: false, error: { code: "no-server" } });
    expect(created).toHaveLength(0);
  });

  it("pools one engine per language across queries", async () => {
    const { service, created } = makeService();
    await service.definition("/ws/a.ts", "x", { line: 0, character: 0 });
    await service.definition("/ws/b.ts", "y", { line: 0, character: 0 });
    await service.completion("/ws/c.ts", "z", { line: 0, character: 0 });

    expect(created).toHaveLength(1);
  });

  it("passes an engine value through as the ok result", async () => {
    const engine = new FakeLanguageEngine();
    engine.definitionImpl = async () => ({
      path: "/ws/b.ts",
      position: { line: 4, character: 2 },
    });
    const { service } = makeService({ engines: [engine] });

    const result = await service.definition("/ws/a.ts", "x", {
      line: 0,
      character: 0,
    });

    expect(result).toEqual({
      ok: true,
      location: { path: "/ws/b.ts", position: { line: 4, character: 2 } },
    });
    expect(engine.definitionCalls).toEqual([
      { path: "/ws/a.ts", content: "x", position: { line: 0, character: 0 } },
    ]);
  });
});

describe("LanguageService — rename", () => {
  it("assembles the overlay from openDocuments minus the active path", async () => {
    const engine = new FakeLanguageEngine();
    const overlaysSeen: Array<Array<[string, string]>> = [];
    engine.renameImpl = async (_p, _c, _pos, _n, overlay) => {
      overlaysSeen.push([...overlay.entries()]);
      return [{ path: "/ws/a.ts", original: "a", edited: "b" }];
    };
    const { service } = makeService({ engines: [engine] });

    const result = await service.rename({
      path: "/ws/a.ts",
      content: "active content",
      position: { line: 0, character: 0 },
      newName: "renamed",
      openDocuments: [
        { path: "/ws/a.ts", content: "active content" }, // excluded: active
        { path: "/ws/open-dirty.ts", content: "in-memory text" },
        { path: "/ws/open-clean.ts", content: "disk-matching text" },
      ],
    });

    expect(overlaysSeen).toEqual([
      [
        ["/ws/open-dirty.ts", "in-memory text"],
        ["/ws/open-clean.ts", "disk-matching text"],
      ],
    ]);
    expect(result).toEqual({
      ok: true,
      edits: [{ path: "/ws/a.ts", original: "a", edited: "b" }],
    });
  });

  it("maps a refusal to not-renameable with the server's message", async () => {
    const engine = new FakeLanguageEngine();
    engine.renameImpl = async () => {
      throw new EngineRefusedError("cannot rename this element");
    };
    const { service } = makeService({ engines: [engine] });

    const result = await service.rename({
      path: "/ws/a.ts",
      content: "",
      position: { line: 0, character: 0 },
      newName: "y",
      openDocuments: [],
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "not-renameable", message: "cannot rename this element" },
    });
  });
});

describe("LanguageService — failure cooldowns & recovery", () => {
  it("maps a spawn failure to no-server and cools down before retrying", async () => {
    let attempts = 0;
    const { service, advance } = makeService({
      createEngine: () => {
        attempts++;
        throw new EngineUnavailableError("spawn");
      },
    });

    const first = await service.definition("/ws/a.ts", "x", {
      line: 0,
      character: 0,
    });
    expect(first).toEqual({ ok: false, error: { code: "no-server" } });

    await service.definition("/ws/a.ts", "x", { line: 0, character: 0 });
    expect(attempts).toBe(1); // inside the cooldown: no re-attempt

    advance(60_001);
    await service.definition("/ws/a.ts", "x", { line: 0, character: 0 });
    expect(attempts).toBe(2); // cooldown elapsed: retry
  });

  it("maps a crash to server-error, disposes the engine, and cools down", async () => {
    const engine = new FakeLanguageEngine();
    engine.definitionImpl = async () => {
      throw new EngineUnavailableError("crashed");
    };
    const replacement = new FakeLanguageEngine();
    const { service, advance } = makeService({
      engines: [engine, replacement],
    });

    const first = await service.definition("/ws/a.ts", "x", {
      line: 0,
      character: 0,
    });
    expect(first).toEqual({ ok: false, error: { code: "server-error" } });
    expect(engine.disposed).toBe(true);

    // Inside the cooldown: same answer, no new engine.
    const second = await service.definition("/ws/a.ts", "x", {
      line: 0,
      character: 0,
    });
    expect(second).toEqual({ ok: false, error: { code: "server-error" } });
    expect(replacement.definitionCalls).toHaveLength(0);

    // After the cooldown: a fresh engine serves the query.
    advance(60_001);
    const third = await service.definition("/ws/a.ts", "x", {
      line: 0,
      character: 0,
    });
    expect(third).toEqual({ ok: false, error: { code: "no-symbol" } }); // fresh engine's null
    expect(replacement.definitionCalls).toHaveLength(1);
  });

  it("times out a hung query as server-error and disposes the engine", async () => {
    const engine = new FakeLanguageEngine();
    engine.definitionImpl = () => new Promise(() => {}); // never settles
    const { service } = makeService({
      engines: [engine],
      timeouts: { definition: 10, rename: 20_000, completion: 20_000 },
    });

    const result = await service.definition("/ws/a.ts", "x", {
      line: 0,
      character: 0,
    });

    expect(result).toEqual({ ok: false, error: { code: "server-error" } });
    expect(engine.disposed).toBe(true);
  });
});

describe("LanguageService — refusal mapping per query", () => {
  it("maps a definition refusal to no-symbol", async () => {
    const engine = new FakeLanguageEngine();
    engine.definitionImpl = async () => {
      throw new EngineRefusedError("unsupported");
    };
    const { service } = makeService({ engines: [engine] });

    expect(
      await service.definition("/ws/a.ts", "x", { line: 0, character: 0 }),
    ).toEqual({ ok: false, error: { code: "no-symbol" } });
  });

  it("maps a completion refusal to an empty ok list (nothing offered)", async () => {
    const engine = new FakeLanguageEngine();
    engine.completionsImpl = async () => {
      throw new EngineRefusedError("no completions here");
    };
    const { service } = makeService({ engines: [engine] });

    expect(
      await service.completion("/ws/a.ts", "x", { line: 0, character: 0 }),
    ).toEqual({ ok: true, items: [] });
  });
});
