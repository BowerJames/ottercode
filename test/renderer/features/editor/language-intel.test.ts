import { describe, expect, it } from "vitest";
import { createLanguageIntel } from "../../../../src/renderer/features/editor/language-intel";
import { createEditorStore } from "../../../../src/renderer/features/editor/store";
import { LANG_RENAME_CHANNEL } from "../../../../src/shared/ipc/channels";
import { createClient } from "../../../../src/shared/ipc/client";
import { createFakeTransport } from "../../fake-transport";

/**
 * Permanent suite for the request-assembly policies — the renderer's
 * half of the contract's tiering clause (rename carries every OTHER
 * open document's current content) and the staleness guard. The CM
 * glue above this module is view plumbing; these are the promises the
 * main-process service consumes.
 */

function makeIntel() {
  const harness = createFakeTransport();
  const client = createClient(harness.transport);
  const editor = createEditorStore(client.fs, client.vdoc);
  const intel = createLanguageIntel({ lang: client.lang, editor });
  return { harness, editor, intel };
}

function withDocs(
  editor: ReturnType<typeof makeIntel>["editor"],
  docs: Record<string, string>,
) {
  // Directly seed working copies (the open path needs fs reads; the
  // seeded shape is identical to a successful open at revision 0).
  for (const [path, content] of Object.entries(docs)) {
    (
      editor.getState() as { workingCopies: Record<string, unknown> }
    ).workingCopies[path] = {
      original: content,
      content,
      revision: 0,
    };
  }
}

describe("createLanguageIntel — rename request assembly", () => {
  it("carries every OTHER open document's current content, never the active one", async () => {
    const { harness, editor, intel } = makeIntel();
    withDocs(editor, {
      "/ws/active.ts": "active text",
      "/ws/dirty.ts": "dirty text",
      "/ws/clean.ts": "clean text",
    });
    editor.getState().edit("/ws/dirty.ts", "edited since open");

    harness.responses.set(LANG_RENAME_CHANNEL, { ok: true, edits: [] });
    await intel.rename(
      "/ws/active.ts",
      "active text",
      4,
      "newName",
      "active text",
    );

    const call = harness.calls.find((c) => c.channel === LANG_RENAME_CHANNEL);
    // Membership as a SET, not an order — the sort is wire-determinism
    // policy; the engine builds a Map either way.
    const payload = call?.payload as {
      openDocuments: Array<{ path: string; content: string }>;
    };
    expect(payload.openDocuments).toHaveLength(2);
    expect(
      new Map(payload.openDocuments.map((d) => [d.path, d.content])),
    ).toEqual(
      new Map([
        // Current content, not open-time: the dirty doc rides its
        // in-memory text. The active doc never appears.
        ["/ws/clean.ts", "clean text"],
        ["/ws/dirty.ts", "edited since open"],
      ]),
    );
    expect(call?.payload).toMatchObject({
      path: "/ws/active.ts",
      content: "active text",
      position: { line: 0, character: 4 }, // offset→position conversion
      newName: "newName",
    });
  });

  it("refuses without invoking when the document drifted since the prompt opened", async () => {
    const { harness, intel } = makeIntel();

    const outcome = await intel.rename(
      "/ws/a.ts",
      "changed while typing",
      0,
      "x",
      "text at prompt open",
    );

    expect(outcome).toEqual({ kind: "stale" });
    expect(harness.calls.some((c) => c.channel === LANG_RENAME_CHANNEL)).toBe(
      false,
    );
  });

  it("applies ok edits through the store and reports failure messages verbatim", async () => {
    const { harness, editor, intel } = makeIntel();

    harness.responses.set(LANG_RENAME_CHANNEL, {
      ok: true,
      edits: [{ path: "/ws/other.ts", original: "a", edited: "b" }],
    });
    const applied = await intel.rename("/ws/a.ts", "t", 0, "n", "t");
    expect(applied).toEqual({ kind: "applied" });
    expect(editor.getState().workingCopies["/ws/other.ts"]).toEqual({
      original: "a",
      content: "b",
      revision: 0,
    });

    harness.responses.set(LANG_RENAME_CHANNEL, {
      ok: false,
      error: { code: "not-renameable", message: "cannot rename this element" },
    });
    const failed = await intel.rename("/ws/a.ts", "t", 0, "n", "t");
    expect(failed).toEqual({
      kind: "failed",
      message: "cannot rename this element",
    });
  });
});
