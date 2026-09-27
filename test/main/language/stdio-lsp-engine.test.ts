import { describe, expect, it } from "vitest";
import {
  EngineRefusedError,
  EngineUnavailableError,
  type LanguageEngine,
} from "../../../src/main/language/language-engine.js";
import type { LspConnection } from "../../../src/main/language/lsp-connection.js";
import { createLspEngine } from "../../../src/main/language/stdio-lsp-engine.js";
import { FakeLspConnection } from "./fake-lsp-connection.js";

/**
 * Permanent suite. The stdio LSP engine is the adapter that turns
 * server-native shapes into contract shapes; its only consumer is the
 * service, whose output IS the IPC contract the renderer consumes. If
 * a mapping here drifts (a LocationLink read as a Location, an edit
 * applied against the wrong base, a kind mis-normalized), a consumer
 * downstream breaks — so the mappings are pinned as obligations.
 *
 * Server-dependent behaviours (real tsserver/pyright traffic) are
 * deliberately absent: no test spawns, connects, or reads disk — the
 * connection is scripted and the disk is a Map.
 */

const A_URI = "file:///ws/a.ts";
const B_URI = "file:///ws/b.ts";

function makeEngine(disk: Map<string, string> = new Map()): {
  connection: FakeLspConnection;
  engine: LanguageEngine;
} {
  const connection = new FakeLspConnection();
  connection.respond("initialize", () => ({ result: { capabilities: {} } }));
  const engine = createLspEngine({
    root: "/ws",
    connection: connection as unknown as LspConnection,
    readFile: async (path) => {
      const content = disk.get(path);
      if (content === undefined) throw new Error(`no disk file: ${path}`);
      return content;
    },
  });
  return { connection, engine };
}

describe("stdio LSP engine — handshake & document sync", () => {
  it("performs the initialize handshake once, then syncs and queries", async () => {
    const { connection, engine } = makeEngine();
    connection.respond("textDocument/definition", () => ({ result: null }));
    await engine.definition("/ws/a.ts", "const x = 1;", {
      line: 0,
      character: 6,
    });

    expect(connection.methods()).toEqual([
      "initialize",
      "initialized",
      "textDocument/didOpen",
      "textDocument/definition",
    ]);
    const init = connection.lastParamsOf("initialize");
    expect(init.rootUri).toBe("file:///ws");
    const didOpen = connection.lastParamsOf("textDocument/didOpen");
    expect(didOpen.textDocument).toEqual({
      uri: A_URI,
      languageId: "typescript",
      version: 1,
      text: "const x = 1;",
    });
  });

  it("does not re-send didOpen for unchanged content, didChanges for changed", async () => {
    const { connection, engine } = makeEngine();
    connection.respond("textDocument/definition", () => ({ result: null }));
    await engine.definition("/ws/a.ts", "one", { line: 0, character: 0 });
    await engine.definition("/ws/a.ts", "one", { line: 0, character: 0 });
    await engine.definition("/ws/a.ts", "two", { line: 0, character: 0 });

    const didOpens = connection.sent.filter(
      (m) => (m as { method?: string }).method === "textDocument/didOpen",
    );
    expect(didOpens).toHaveLength(1);
    const didChange = connection.lastParamsOf("textDocument/didChange");
    expect(didChange.textDocument.uri).toBe(A_URI);
    expect(didChange.contentChanges).toEqual([{ text: "two" }]);
  });
});

describe("stdio LSP engine — definition", () => {
  it("maps the first Location result", async () => {
    const { connection, engine } = makeEngine();
    connection.respond("textDocument/definition", () => ({
      result: [{ uri: B_URI, range: { start: { line: 3, character: 5 } } }],
    }));

    const location = await engine.definition("/ws/a.ts", "x", {
      line: 0,
      character: 0,
    });

    expect(location).toEqual({
      path: "/ws/b.ts",
      position: { line: 3, character: 5 },
    });
    expect(connection.lastParamsOf("textDocument/definition").position).toEqual(
      { line: 0, character: 0 },
    );
  });

  it("prefers targetSelectionRange on LocationLink results", async () => {
    const { connection, engine } = makeEngine();
    connection.respond("textDocument/definition", () => ({
      result: [
        {
          targetUri: B_URI,
          targetRange: { start: { line: 0, character: 0 } },
          targetSelectionRange: { start: { line: 9, character: 2 } },
        },
      ],
    }));

    expect(
      await engine.definition("/ws/a.ts", "x", { line: 0, character: 0 }),
    ).toEqual({ path: "/ws/b.ts", position: { line: 9, character: 2 } });
  });

  it("answers null for null and empty results", async () => {
    const { connection, engine } = makeEngine();
    connection.respond("textDocument/definition", () => ({ result: null }));
    expect(
      await engine.definition("/ws/a.ts", "?", { line: 0, character: 0 }),
    ).toBeNull();

    connection.respond("textDocument/definition", () => ({ result: [] }));
    expect(
      await engine.definition("/ws/a.ts", "?", { line: 0, character: 0 }),
    ).toBeNull();
  });
});

describe("stdio LSP engine — rename", () => {
  it("rejects an invalid identifier before touching the server", async () => {
    const { connection, engine } = makeEngine();

    await expect(
      engine.rename(
        "/ws/a.ts",
        "x",
        { line: 0, character: 0 },
        "not valid!",
        new Map(),
      ),
    ).rejects.toBeInstanceOf(EngineRefusedError);

    expect(connection.sent).toEqual([]); // not even the handshake
  });

  it("builds whole-file edits over the disk base, applying ranged edits", async () => {
    const disk = new Map([
      ["/ws/a.ts", "foo + foo\n"],
      ["/ws/b.ts", "let foo;\n"],
    ]);
    const { connection, engine } = makeEngine(disk);
    connection.respond("textDocument/rename", () => ({
      result: {
        changes: {
          [A_URI]: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 3 },
              },
              newText: "bar",
            },
            {
              range: {
                start: { line: 0, character: 6 },
                end: { line: 0, character: 9 },
              },
              newText: "bar",
            },
          ],
          [B_URI]: [
            {
              range: {
                start: { line: 0, character: 4 },
                end: { line: 0, character: 7 },
              },
              newText: "bar",
            },
          ],
        },
      },
    }));

    const edits = await engine.rename(
      "/ws/a.ts",
      "foo + foo\n",
      { line: 0, character: 0 },
      "bar",
      new Map(),
    );

    expect(edits).toEqual([
      { path: "/ws/a.ts", original: "foo + foo\n", edited: "bar + bar\n" },
      { path: "/ws/b.ts", original: "let foo;\n", edited: "let bar;\n" },
    ]);
  });

  it("computes overlay files against their in-memory content, not disk", async () => {
    const disk = new Map([["/ws/b.ts", "aaaaaaaaaa\n"]]);
    const overlay = new Map([["/ws/b.ts", "bbbbbbbbbb\n"]]);
    const { connection, engine } = makeEngine(disk);
    connection.respond("textDocument/rename", () => ({
      result: {
        changes: {
          [B_URI]: [
            {
              range: {
                start: { line: 0, character: 4 },
                end: { line: 0, character: 7 },
              },
              newText: "QQQ",
            },
          ],
        },
      },
    }));

    const edits = await engine.rename(
      "/ws/a.ts",
      "sym\n",
      { line: 0, character: 0 },
      "renamed",
      overlay,
    );

    expect(edits).toEqual([
      // "bbbbQQQbbb" proves the edit applied to the overlay text; the
      // disk text would have produced "aaaaQQQaaa".
      { path: "/ws/b.ts", original: "bbbbbbbbbb\n", edited: "bbbbQQQbbb\n" },
    ]);
    // The overlay document was synced to the server as-opened.
    const didOpen = connection.lastParamsOf("textDocument/didOpen");
    expect(didOpen.textDocument.uri).toBe(B_URI);
    expect(didOpen.textDocument.text).toBe("bbbbbbbbbb\n");
  });

  it("reads documentChanges (TextDocumentEdit) edits too", async () => {
    const disk = new Map([["/ws/b.ts", "let foo;\n"]]);
    const { connection, engine } = makeEngine(disk);
    connection.respond("textDocument/rename", () => ({
      result: {
        documentChanges: [
          {
            textDocument: { uri: B_URI, version: null },
            edits: [
              {
                range: {
                  start: { line: 0, character: 4 },
                  end: { line: 0, character: 7 },
                },
                newText: "bar",
              },
            ],
          },
        ],
      },
    }));

    const edits = await engine.rename(
      "/ws/a.ts",
      "foo\n",
      { line: 0, character: 0 },
      "bar",
      new Map(),
    );

    expect(edits).toEqual([
      { path: "/ws/b.ts", original: "let foo;\n", edited: "let bar;\n" },
    ]);
  });

  it("answers null when the server has nothing to rename", async () => {
    const { connection, engine } = makeEngine();
    connection.respond("textDocument/rename", () => ({ result: null }));
    expect(
      await engine.rename(
        "/ws/a.ts",
        "x",
        { line: 0, character: 0 },
        "y",
        new Map(),
      ),
    ).toBeNull();
  });

  it("surfaces a server refusal as EngineRefusedError", async () => {
    const { connection, engine } = makeEngine();
    connection.respond("textDocument/rename", () => ({
      error: { code: -32801, message: "cannot rename this element" },
    }));
    await expect(
      engine.rename("/ws/a.ts", "x", { line: 0, character: 0 }, "y", new Map()),
    ).rejects.toSatisfy((e: unknown) => e instanceof EngineRefusedError);
  });
});

describe("stdio LSP engine — completions", () => {
  it("maps CompletionList items with normalized kinds and folded apply text", async () => {
    const { connection, engine } = makeEngine();
    connection.respond("textDocument/completion", () => ({
      result: {
        items: [
          {
            label: "foo",
            kind: 3,
            insertText: "foo(",
            detail: "(x: number) => void",
          },
          {
            label: "Renamed",
            kind: 7,
            textEdit: { range: {}, newText: "renamed" },
          },
          { label: "plain" }, // no kind, no insertText
          { label: "MAX", kind: 21 },
          { label: "import", kind: 14 },
          { label: "./mod", kind: 9 },
          { label: "field", kind: 5 },
        ],
      },
    }));

    const items = await engine.completions("/ws/a.ts", "f", {
      line: 0,
      character: 1,
    });

    expect(items).toEqual([
      {
        label: "foo",
        apply: "foo(",
        kind: "function",
        detail: "(x: number) => void",
      },
      { label: "Renamed", apply: "renamed", kind: "type" },
      { label: "plain", apply: "plain", kind: "text" },
      { label: "MAX", apply: "MAX", kind: "variable" },
      { label: "import", apply: "import", kind: "keyword" },
      { label: "./mod", apply: "./mod", kind: "module" },
      { label: "field", apply: "field", kind: "property" },
    ]);
  });

  it("answers an empty list for null results", async () => {
    const { connection, engine } = makeEngine();
    connection.respond("textDocument/completion", () => ({ result: null }));
    expect(
      await engine.completions("/ws/a.ts", "", { line: 0, character: 0 }),
    ).toEqual([]);
  });
});

describe("stdio LSP engine — connection death & disposal", () => {
  it("rejects pending queries as crashed, and refuses further work, when the connection dies", async () => {
    const { connection, engine } = makeEngine();
    // definition is left unscripted: the query hangs pending.
    const pending = engine.definition("/ws/a.ts", "x", {
      line: 0,
      character: 0,
    });
    const sentBefore = connection.sent.length;

    connection.die();
    await expect(pending).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof EngineUnavailableError && e.reason === "crashed",
    );

    await expect(
      engine.definition("/ws/a.ts", "x", { line: 0, character: 0 }),
    ).rejects.toBeInstanceOf(EngineUnavailableError);
    expect(connection.sent).toHaveLength(sentBefore); // nothing new sent
  });

  it("answers server-initiated requests with method-not-found instead of hanging the server", async () => {
    const { connection, engine } = makeEngine();
    const done = engine.definition("/ws/a.ts", "x", {
      line: 0,
      character: 0,
    }); // hangs (unscripted) — but the engine stays live
    connection.receive({
      jsonrpc: "2.0",
      id: 99,
      method: "workspace/configuration",
      params: {},
    });

    const reply = connection.sent.find((m) => (m as { id?: number }).id === 99);
    expect(reply).toEqual({
      jsonrpc: "2.0",
      id: 99,
      error: { code: -32601, message: "method not found" },
    });
    engine.dispose(); // settle the hung query
    await expect(done).rejects.toBeInstanceOf(EngineUnavailableError);
  });

  it("dispose tears the connection down", () => {
    const { connection, engine } = makeEngine();
    engine.dispose();
    expect(connection.disposed).toBe(true);
  });
});
