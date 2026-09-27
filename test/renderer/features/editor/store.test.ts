import { describe, expect, it } from "vitest";
import { createEditorStore } from "../../../../src/renderer/features/editor/store";
import { FS_READ_FILE_CHANNEL } from "../../../../src/shared/ipc/channels";
import { createClient } from "../../../../src/shared/ipc/client";
import { createFakeTransport } from "../../fake-transport";

/**
 * Permanent suite — one test, one consumer: EditorPane renders
 * workingCopies[activePath] (both WorkingCopy fields feed the dirty-dot
 * comparison). Deleted at the promotion review, unconsumed: the entire
 * open-failure surface (openError, previous-doc-stays-active, no
 * phantom copy) — its only consumer is the error banner, which renders
 * text nothing downstream computes with. Presentation is not
 * consumption. The ok-branch itself is compiler-guaranteed (result
 * doesn't narrow without it); re-pin failure effects when a
 * computational consumer arrives.
 */

function makeStore() {
  const harness = createFakeTransport();
  const store = createEditorStore(createClient(harness.transport).fs);
  return { harness, store };
}

describe("createEditorStore", () => {
  it("open loads a file into a working copy and activates it", async () => {
    const { harness, store } = makeStore();
    harness.responses.set(FS_READ_FILE_CHANNEL, {
      ok: true,
      content: "fn main() {}",
    });

    await store.getState().open("/ws/main.rs");

    const s = store.getState();
    expect(s.activePath).toBe("/ws/main.rs");
    // revision ships with the copy from birth — part of the copy's
    // contract (the remount key consumes it), pinned here with the rest.
    expect(s.workingCopies["/ws/main.rs"]).toEqual({
      original: "fn main() {}",
      content: "fn main() {}",
      revision: 0,
    });
  });

  // RESET tests (consumed by EditorPane: the revert button dispatches
  // reset, the dirty dot renders against content !== original, and the
  // document key consumes revision — a reset that stops bumping it
  // never reaches the CodeMirror surface, silently):
  it("reset restores the load-time snapshot: content reverts, original stands, the document stays active", async () => {
    const { harness, store } = makeStore();
    harness.responses.set(FS_READ_FILE_CHANNEL, {
      ok: true,
      content: "fn main() {}",
    });
    await store.getState().open("/ws/main.rs");
    store.getState().edit("/ws/main.rs", "fn main() { panic!() }");

    store.getState().reset("/ws/main.rs");

    // content snaps back to the snapshot (dot clears, collectEdits
    // stops attaching) while original survives — it is the diff base
    // for the NEXT edit cycle, not a consumed one-shot.
    expect(store.getState().workingCopies["/ws/main.rs"]).toEqual({
      original: "fn main() {}",
      content: "fn main() {}",
      revision: 1,
    });
    // Reset is a state operation, not navigation: the key change remounts
    // the SAME document rather than unmounting it for another.
    expect(store.getState().activePath).toBe("/ws/main.rs");
  });

  it("reset bumps the revision — the remount signal", async () => {
    const { harness, store } = makeStore();
    harness.responses.set(FS_READ_FILE_CHANNEL, { ok: true, content: "a" });
    await store.getState().open("/ws/a.ts");
    store.getState().edit("/ws/a.ts", "b");

    store.getState().reset("/ws/a.ts");
    store.getState().edit("/ws/a.ts", "c");
    store.getState().reset("/ws/a.ts");

    // Two resets, two bumps: each bump is one remount keyed on
    // path:revision. A lost bump is a lost remount — the second reset
    // above would leave "c" on screen.
    expect(store.getState().workingCopies["/ws/a.ts"]?.revision).toBe(2);
    expect(store.getState().workingCopies["/ws/a.ts"]?.content).toBe("a");
  });

  it("reset of an unopened path is a no-op — no phantom copy is created", () => {
    const { store } = makeStore();

    store.getState().reset("/ws/never-opened.ts");

    expect(
      store.getState().workingCopies["/ws/never-opened.ts"],
    ).toBeUndefined();
    expect(store.getState().activePath).toBeNull(); // untouched
  });
});

// VIRTUAL DOCUMENTS (consumed by the agent rail's double-click: an
// assistant message opens as an editable markdown draft, a user
// message as a read-only snapshot). The record's separation from
// workingCopies is the load-bearing wall: collectEdits gathers dirty
// working copies into agent:submit, and a synthetic key crossing that
// contract would reach main's disk writer.
describe("createEditorStore — virtual documents", () => {
  it("openVirtual activates a document without touching the fs", () => {
    const { harness, store } = makeStore();

    store.getState().openVirtual({
      key: "virtual:chat/7",
      title: "agent message #7",
      text: "# hello",
    });

    const s = store.getState();
    expect(s.activePath).toBe("virtual:chat/7");
    expect(s.virtualDocs["virtual:chat/7"]).toEqual({
      title: "agent message #7",
      draft: false,
      original: "# hello",
      content: "# hello",
      revision: 0,
    });
    // Never a file copy, never an fs read — a virtual doc has no disk
    // counterpart by definition.
    expect(s.workingCopies).toEqual({});
    expect(harness.calls).toEqual([]);
  });

  it("reopening a clean doc refreshes the snapshot and focuses — no duplicate", () => {
    const { store } = makeStore();
    store.getState().openVirtual({
      key: "virtual:chat/7",
      title: "agent message #7",
      text: "partial",
    });

    // The message kept streaming after the first open — the reopen
    // captures the longer text, not a second document.
    store.getState().openVirtual({
      key: "virtual:chat/7",
      title: "agent message #7",
      text: "partial, now complete",
    });

    expect(Object.keys(store.getState().virtualDocs)).toEqual([
      "virtual:chat/7",
    ]);
    expect(store.getState().virtualDocs["virtual:chat/7"]?.content).toBe(
      "partial, now complete",
    );
    // The remount signal moved with the text — EditorPane's document
    // key consumes it, so the surface rebuilds from the new snapshot.
    expect(store.getState().virtualDocs["virtual:chat/7"]?.revision).toBe(1);

    // Reopening with UNCHANGED text bumps nothing: a refocus keeps
    // the surface (and its scroll position) standing.
    store.getState().openVirtual({
      key: "virtual:chat/7",
      title: "agent message #7",
      text: "partial, now complete",
    });
    expect(store.getState().virtualDocs["virtual:chat/7"]?.revision).toBe(1);
  });

  it("edit is a no-op for snapshot keys — they cannot become dirty", () => {
    const { store } = makeStore();
    store.getState().openVirtual({
      key: "virtual:chat/7",
      title: "agent message #7",
      text: "snapshot",
    });

    store.getState().edit("virtual:chat/7", "tampered");

    // The guard chain: edit never touches a snapshot, so it can never
    // be dirty, so no collector can ever attach it to a turn. If this
    // pin breaks, a synthetic key rides agent:submit.
    expect(store.getState().virtualDocs["virtual:chat/7"]?.content).toBe(
      "snapshot",
    );
    expect(store.getState().workingCopies).toEqual({});
  });

  it("drafts edit: content moves, original stands as the diff base", () => {
    const { store } = makeStore();
    store.getState().openVirtual({
      key: "virtual:chat/7",
      title: "agent message #7",
      text: "as the assistant wrote it",
      draft: true,
    });

    store.getState().edit("virtual:chat/7", "as the user corrected it");

    const doc = store.getState().virtualDocs["virtual:chat/7"];
    expect(doc?.content).toBe("as the user corrected it");
    expect(doc?.original).toBe("as the assistant wrote it");
    // Still no file copy — a draft's edits ride as message edits,
    // never as file edits.
    expect(store.getState().workingCopies).toEqual({});
  });

  it("drafts reset: content := original, revision bumps (remount)", () => {
    const { store } = makeStore();
    store.getState().openVirtual({
      key: "virtual:chat/7",
      title: "agent message #7",
      text: "original",
      draft: true,
    });
    store.getState().edit("virtual:chat/7", "edited");

    store.getState().reset("virtual:chat/7");

    const doc = store.getState().virtualDocs["virtual:chat/7"];
    expect(doc?.content).toBe("original");
    expect(doc?.original).toBe("original"); // the diff base stands
    expect(doc?.revision).toBe(1);
  });

  it("reopening an EDITED draft never clobbers — the user's work wins", () => {
    const { store } = makeStore();
    store.getState().openVirtual({
      key: "virtual:chat/7",
      title: "agent message #7",
      text: "v1",
      draft: true,
    });
    store.getState().edit("virtual:chat/7", "v1 (edited)");

    // The entry kept streaming after the user started editing; the
    // reopen must not refresh over the user's words.
    store.getState().openVirtual({
      key: "virtual:chat/7",
      title: "agent message #7",
      text: "v1, fully streamed",
      draft: true,
    });

    const doc = store.getState().virtualDocs["virtual:chat/7"];
    expect(doc?.original).toBe("v1");
    expect(doc?.content).toBe("v1 (edited)");
    expect(doc?.revision).toBe(0); // no remount — nothing changed
  });
});
