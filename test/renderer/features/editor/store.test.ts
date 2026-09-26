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
    expect(s.workingCopies["/ws/main.rs"]).toEqual({
      original: "fn main() {}",
      content: "fn main() {}",
    });
  });
});
