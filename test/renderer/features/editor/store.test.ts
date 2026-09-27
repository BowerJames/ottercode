import { describe, expect, it } from "vitest";
import { collectEdits } from "../../../../src/renderer/features/agent-chat/collect-edits";
import type { EditorVdoc } from "../../../../src/renderer/features/editor/store";
import {
  createEditorStore,
  vdocKey,
} from "../../../../src/renderer/features/editor/store";

/**
 * Permanent suite for the editor's vdoc arms. Consumers: EditorPane
 * (open/save/reload/sync drive its header, banner, and remounts) and
 * the use-editor push wiring (syncVdoc is the push entry). Pinned:
 * the buffer contract — materialization, version-guarded saves with
 * all three outcomes, push adoption vs conflict flagging, deletion
 * deactivation — and the STRUCTURAL clause that a design doc can
 * never appear as a file copy (collectEdits feeding agent:submit
 * iterates workingCopies only; the routing pin below guards that
 * guarantee against record mergers). Unpinned: exact error fields
 * beyond codes, revision counts beyond "bumped when text moved".
 */

function makeStore() {
  const docs = new Map<string, { content: string; version: number }>();
  const updates: Array<{
    name: string;
    content: string;
    expectedVersion: number;
  }> = [];
  const vdoc: EditorVdoc = {
    async read(name) {
      const doc = docs.get(name);
      return doc === undefined
        ? { ok: false as const, error: { code: "not-found" as const } }
        : { ok: true as const, content: doc.content, version: doc.version };
    },
    async update(name, content, expectedVersion) {
      updates.push({ name, content, expectedVersion });
      const doc = docs.get(name);
      if (doc === undefined) {
        return { ok: false as const, error: { code: "not-found" as const } };
      }
      if (doc.version !== expectedVersion) {
        return { ok: false as const, error: { code: "conflict" as const } };
      }
      doc.content = content;
      doc.version += 1;
      return { ok: true as const, doc: { name, version: doc.version } };
    },
  };
  const fs = {
    async readFile() {
      return { ok: false as const, error: { code: "not-found" as const } };
    },
  };
  const store = createEditorStore(fs, vdoc);
  return {
    store,
    updates,
    /** Authoritative write from outside this buffer (the agent's tool
     *  or another renderer flow) — bumps the version behind the
     *  buffer's back. */
    authorityWrite(name: string, content: string) {
      const doc = docs.get(name);
      if (doc === undefined) {
        docs.set(name, { content, version: 1 });
      } else {
        doc.content = content;
        doc.version += 1;
      }
    },
  };
}

describe("openVdoc", () => {
  it("materializes a buffer from the authority and activates it", async () => {
    const { store, authorityWrite } = makeStore();
    authorityWrite("a.md", "# A");

    await store.getState().openVdoc("a.md");

    const key = vdocKey("a.md");
    expect(store.getState().activePath).toBe(key);
    expect(store.getState().vdocBuffers[key]).toEqual({
      name: "a.md",
      original: "# A",
      content: "# A",
      baseVersion: 1,
      revision: 0,
      conflict: false,
    });
  });

  it("fails without activating: vdocError records the code", async () => {
    const { store } = makeStore();

    await store.getState().openVdoc("ghost.md");

    expect(store.getState().activePath).toBeNull();
    expect(store.getState().vdocError).toEqual({
      name: "ghost.md",
      code: "not-found",
    });
  });

  it("reopen: clean + authority moved → adopt and remount", async () => {
    const { store, authorityWrite } = makeStore();
    authorityWrite("a.md", "one");
    await store.getState().openVdoc("a.md");
    authorityWrite("a.md", "two");

    await store.getState().openVdoc("a.md");

    const buffer = store.getState().vdocBuffers[vdocKey("a.md")];
    expect(buffer).toMatchObject({
      content: "two",
      original: "two",
      baseVersion: 2,
      revision: 1,
    });
  });

  it("reopen: dirty → the user's edits win, focus only", async () => {
    const { store, authorityWrite } = makeStore();
    authorityWrite("a.md", "one");
    await store.getState().openVdoc("a.md");
    store.getState().edit(vdocKey("a.md"), "mine");
    authorityWrite("a.md", "two");

    await store.getState().openVdoc("a.md");

    const buffer = store.getState().vdocBuffers[vdocKey("a.md")];
    expect(buffer).toMatchObject({
      content: "mine",
      original: "one",
      baseVersion: 1,
      revision: 0,
    });
  });
});

describe("edit routing (the structural clause)", () => {
  it("edits the buffer and never materializes a working copy", () => {
    const { store, authorityWrite } = makeStore();
    authorityWrite("a.md", "base");
    return store
      .getState()
      .openVdoc("a.md")
      .then(() => {
        store.getState().edit(vdocKey("a.md"), "edited");

        expect(store.getState().vdocBuffers[vdocKey("a.md")]?.content).toBe(
          "edited",
        );
        // The pin: design docs ride NOTHING into agent:submit as files.
        expect(store.getState().workingCopies).toEqual({});
        expect(collectEdits(store.getState().workingCopies)).toEqual([]);
      });
  });
});

describe("saveVdoc", () => {
  it("ok: advances original and baseVersion, clears conflict", async () => {
    const { store, authorityWrite, updates } = makeStore();
    authorityWrite("a.md", "one");
    await store.getState().openVdoc("a.md");
    store.getState().edit(vdocKey("a.md"), "mine");

    await store.getState().saveVdoc(vdocKey("a.md"));

    expect(updates).toEqual([
      { name: "a.md", content: "mine", expectedVersion: 1 },
    ]);
    expect(store.getState().vdocBuffers[vdocKey("a.md")]).toMatchObject({
      original: "mine",
      content: "mine",
      baseVersion: 2,
      conflict: false,
    });
  });

  it("a clean buffer is a no-op — no version churn, no echo", async () => {
    const { store, authorityWrite, updates } = makeStore();
    authorityWrite("a.md", "one");
    await store.getState().openVdoc("a.md");

    await store.getState().saveVdoc(vdocKey("a.md"));

    expect(updates).toEqual([]);
  });

  it("conflict: flags the buffer and touches nothing else", async () => {
    const { store, authorityWrite } = makeStore();
    authorityWrite("a.md", "one");
    await store.getState().openVdoc("a.md");
    store.getState().edit(vdocKey("a.md"), "mine");
    authorityWrite("a.md", "agent's"); // version 2 behind the buffer's back

    await store.getState().saveVdoc(vdocKey("a.md"));

    expect(store.getState().vdocBuffers[vdocKey("a.md")]).toMatchObject({
      content: "mine",
      original: "one",
      baseVersion: 1,
      conflict: true,
    });
  });

  it("force: rebases onto the authority's current version (overwrite)", async () => {
    const { store, authorityWrite, updates } = makeStore();
    authorityWrite("a.md", "one");
    await store.getState().openVdoc("a.md");
    store.getState().edit(vdocKey("a.md"), "mine");
    authorityWrite("a.md", "agent's"); // version 2

    await store.getState().saveVdoc(vdocKey("a.md"), { force: true });

    expect(updates).toEqual([
      { name: "a.md", content: "mine", expectedVersion: 2 },
    ]);
    expect(store.getState().vdocBuffers[vdocKey("a.md")]).toMatchObject({
      original: "mine",
      baseVersion: 3,
      conflict: false,
    });
  });
});

describe("reloadVdoc", () => {
  it("discards unsaved edits unconditionally and clears conflict", async () => {
    const { store, authorityWrite } = makeStore();
    authorityWrite("a.md", "one");
    await store.getState().openVdoc("a.md");
    store.getState().edit(vdocKey("a.md"), "mine");
    authorityWrite("a.md", "agent's"); // the agent wrote behind the buffer
    store.getState().syncVdoc({
      kind: "written",
      name: "a.md",
      content: "agent's",
      version: 2,
      origin: "agent",
    }); // dirty → conflict

    await store.getState().reloadVdoc(vdocKey("a.md"));

    expect(store.getState().vdocBuffers[vdocKey("a.md")]).toMatchObject({
      content: "agent's",
      original: "agent's",
      baseVersion: 2,
      revision: 1,
      conflict: false,
    });
  });
});

describe("syncVdoc (the push entry)", () => {
  it("clean buffer adopts an agent write, remounting only when text moved", async () => {
    const { store, authorityWrite } = makeStore();
    authorityWrite("a.md", "one");
    await store.getState().openVdoc("a.md");

    store.getState().syncVdoc({
      kind: "written",
      name: "a.md",
      content: "agent's",
      version: 2,
      origin: "agent",
    });
    const afterWrite = store.getState().vdocBuffers[vdocKey("a.md")];
    expect(afterWrite).toMatchObject({
      content: "agent's",
      baseVersion: 2,
      revision: 1, // text moved → remount
    });

    // The echo of the user's own save: same text → no remount.
    store.getState().syncVdoc({
      kind: "written",
      name: "a.md",
      content: "agent's",
      version: 2,
      origin: "user",
    });
    expect(store.getState().vdocBuffers[vdocKey("a.md")]?.revision).toBe(
      afterWrite?.revision,
    );
  });

  it("dirty buffer flags conflict — nothing clobbers silently", async () => {
    const { store, authorityWrite } = makeStore();
    authorityWrite("a.md", "one");
    await store.getState().openVdoc("a.md");
    store.getState().edit(vdocKey("a.md"), "mine");

    store.getState().syncVdoc({
      kind: "written",
      name: "a.md",
      content: "agent's",
      version: 2,
      origin: "agent",
    });

    expect(store.getState().vdocBuffers[vdocKey("a.md")]).toMatchObject({
      content: "mine",
      original: "one",
      baseVersion: 1,
      conflict: true,
    });
  });

  it("deleted: drops the buffer, deactivates if active, spares others", async () => {
    const { store, authorityWrite } = makeStore();
    authorityWrite("a.md", "one");
    authorityWrite("b.md", "two");
    await store.getState().openVdoc("a.md");
    await store.getState().openVdoc("b.md");
    store.getState().edit(vdocKey("a.md"), "unsaved");

    store.getState().syncVdoc({ kind: "deleted", name: "b.md" });
    // b was ACTIVE: its deletion deactivates; a's buffer is spared.
    expect(store.getState().activePath).toBeNull();
    expect(store.getState().vdocBuffers[vdocKey("a.md")]).toBeDefined();

    await store.getState().openVdoc("a.md"); // reactivate (dirty → focus only)
    store.getState().syncVdoc({ kind: "deleted", name: "a.md" });
    expect(store.getState().vdocBuffers[vdocKey("a.md")]).toBeUndefined();
    expect(store.getState().activePath).toBeNull();
  });

  it("changes for unopened docs are no-ops", () => {
    const { store } = makeStore();

    store.getState().syncVdoc({
      kind: "created",
      name: "ghost.md",
      content: "x",
      version: 1,
      origin: "agent",
    });

    expect(store.getState().vdocBuffers).toEqual({});
    expect(store.getState().activePath).toBeNull();
  });
});

describe("reset on a vdoc key", () => {
  it("restores the open-time content with a remount, keeping the stale baseVersion honest", async () => {
    const { store, authorityWrite } = makeStore();
    authorityWrite("a.md", "one");
    await store.getState().openVdoc("a.md");
    store.getState().edit(vdocKey("a.md"), "mine");

    store.getState().reset(vdocKey("a.md"));

    expect(store.getState().vdocBuffers[vdocKey("a.md")]).toMatchObject({
      content: "one",
      original: "one",
      revision: 1,
    });
  });
});
