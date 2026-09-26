import { describe, expect, it } from "vitest";
import {
  createFileTreeStore,
  type FileTreeState,
} from "../../../../src/renderer/features/file-tree/store";
import {
  FS_LIST_CHILDREN_CHANNEL,
  FS_ROOT_CHANNEL,
} from "../../../../src/shared/ipc/channels";
import { createClient } from "../../../../src/shared/ipc/client";
import type { FileEntry } from "../../../../src/shared/ipc/fs";
import { createFakeInvoke } from "./fake-invoke";

/**
 * Permanent suite. Each test protects a clause the components consume:
 * FileTree renders from loadRoot's seeding; TreeRow reads the cache and
 * the open set, branches on kind, and dispatches toggle/select. Deleted
 * at the promotion review (no consumer, safe-refactor traps): cache-hit
 * no-refetch, collapse-keeps-cache, and the fetch-count assertions.
 */

const WS_CHILDREN: FileEntry[] = [
  { name: "src", path: "/ws/src", kind: "directory" },
  { name: "README.md", path: "/ws/README.md", kind: "file" },
];

const A_CHILDREN: FileEntry[] = [
  { name: "notes.txt", path: "/a/notes.txt", kind: "file" },
];

function makeStore() {
  const harness = createFakeInvoke();
  const store = createFileTreeStore(createClient(harness.fakeInvoke).fs);
  return { harness, store };
}

/** The observable state fields — the query side of the store. */
function snapshot(s: FileTreeState) {
  return {
    root: s.root,
    childrenByDir: s.childrenByDir,
    expandedDirs: s.expandedDirs,
    selectedPath: s.selectedPath,
  };
}

describe("createFileTreeStore", () => {
  it("loadRoot seeds the tree: root and its children", async () => {
    const { harness, store } = makeStore();
    harness.responses.set(FS_ROOT_CHANNEL, { root: "/ws" });
    harness.responses.set(FS_LIST_CHILDREN_CHANNEL, {
      ok: true,
      entries: WS_CHILDREN,
    });

    await store.getState().loadRoot();

    const s = store.getState();
    expect(s.root).toBe("/ws");
    expect(s.childrenByDir["/ws"]).toEqual(WS_CHILDREN);
  });

  it("expand on cache miss fetches children and marks the directory expanded", async () => {
    const { harness, store } = makeStore();
    harness.responses.set(FS_LIST_CHILDREN_CHANNEL, {
      ok: true,
      entries: A_CHILDREN,
    });

    await store.getState().expand("/a");

    const s = store.getState();
    expect(s.expandedDirs["/a"]).toBe(true);
    expect(s.childrenByDir["/a"]).toEqual(A_CHILDREN);
    // Transitive: the REAL client rode along — right channel, right payload.
    const call = harness.calls.find(
      (c) => c.channel === FS_LIST_CHILDREN_CHANNEL,
    );
    expect(call?.payload).toEqual({ path: "/a" });
  });

  it("expand failure (ok: false) leaves the store untouched", async () => {
    const { harness, store } = makeStore();
    harness.responses.set(FS_LIST_CHILDREN_CHANNEL, {
      ok: false,
      error: { code: "not-found" },
    });

    const before = snapshot(store.getState());
    await store.getState().expand("/a");

    expect(snapshot(store.getState())).toEqual(before);
  });

  it("collapse unmarks expansion", async () => {
    const { harness, store } = makeStore();
    harness.responses.set(FS_LIST_CHILDREN_CHANNEL, {
      ok: true,
      entries: A_CHILDREN,
    });
    await store.getState().expand("/a");

    store.getState().collapse("/a");

    expect(store.getState().expandedDirs["/a"]).toBeUndefined();
  });

  it("toggle expands a collapsed directory, collapses an expanded one", async () => {
    const { harness, store } = makeStore();
    harness.responses.set(FS_LIST_CHILDREN_CHANNEL, {
      ok: true,
      entries: A_CHILDREN,
    });

    await store.getState().toggle("/a");
    expect(store.getState().expandedDirs["/a"]).toBe(true);

    await store.getState().toggle("/a");
    expect(store.getState().expandedDirs["/a"]).toBeUndefined();
  });

  it("select sets the selected path", () => {
    const { store } = makeStore();

    store.getState().select("/a/notes.txt");

    expect(store.getState().selectedPath).toBe("/a/notes.txt");
  });
});
