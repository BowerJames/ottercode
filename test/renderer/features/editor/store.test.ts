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
