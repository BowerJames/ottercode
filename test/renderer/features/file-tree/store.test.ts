import { describe, expect, it } from "vitest";
import { createFileTreeStore } from "../../../../src/renderer/features/file-tree/store";
import {
  FS_LIST_CHILDREN_CHANNEL,
  FS_ROOT_CHANNEL,
} from "../../../../src/shared/ipc/channels";
import { createClient } from "../../../../src/shared/ipc/client";
import type {
  FileEntry,
  ListChildrenResult,
} from "../../../../src/shared/ipc/fs";
import { createFakeTransport } from "../../fake-transport";

/**
 * Permanent suite. Each test protects a clause the components consume:
 * FileTree renders from loadRoot's seeding; TreeRow reads the cache and
 * the open set, branches on kind, and dispatches toggle/select; the
 * refresh button dispatches refresh, whose clauses below are what make
 * it an honest "sync with disk" — fresh visible listings, gone dirs
 * dropped, transient failures not collapsing anything. Deleted
 * at the promotion review (no consumer, safe-refactor traps): cache-hit
 * no-refetch, collapse-keeps-cache, the fetch-count assertions, and
 * the expand-failure snapshot (the ok-branch is compiler-guaranteed;
 * its effects are pixels — same ruling as the editor's failure test).
 */

const WS_CHILDREN: FileEntry[] = [
  { name: "src", path: "/ws/src", kind: "directory" },
  { name: "README.md", path: "/ws/README.md", kind: "file" },
];

const A_CHILDREN: FileEntry[] = [
  { name: "notes.txt", path: "/a/notes.txt", kind: "file" },
];

function makeStore() {
  const harness = createFakeTransport();
  const store = createFileTreeStore(createClient(harness.transport).fs);
  return { harness, store };
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
    // Membership + shape only: entry order is the service's documented
    // policy ("Order is policy… deliberately unpinned") and nothing
    // downstream computes with sequence — plain toEqual would pin it.
    expect(s.childrenByDir["/ws"] ?? []).toEqual(
      expect.arrayContaining(WS_CHILDREN),
    );
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

  it("select stores the selected entry (metadata included)", () => {
    const { store } = makeStore();
    const entry: FileEntry = {
      name: "notes.txt",
      path: "/a/notes.txt",
      kind: "file",
    };

    store.getState().select(entry);

    expect(store.getState().selectedEntry).toEqual(entry);
  });
});

/** A store seeded like the app uses it: root loaded, one expanded dir,
 * one collapsed (but cached) dir — plus a programmable disk the test
 * mutates to simulate external change between refreshes. */
function makeLoadedStore() {
  const harness = createFakeTransport();
  const store = createFileTreeStore(createClient(harness.transport).fs);
  const rootChildren: FileEntry[] = [
    { name: "src", path: "/ws/src", kind: "directory" },
    { name: "README.md", path: "/ws/README.md", kind: "file" },
  ];
  const srcChildren: FileEntry[] = [
    { name: "main.rs", path: "/ws/src/main.rs", kind: "file" },
  ];
  const docsChildren: FileEntry[] = [
    { name: "notes.md", path: "/ws/docs/notes.md", kind: "file" },
  ];
  const disk = new Map<string, ListChildrenResult>([
    ["/ws", { ok: true, entries: rootChildren }],
    ["/ws/src", { ok: true, entries: srcChildren }],
    ["/ws/docs", { ok: true, entries: docsChildren }],
  ]);
  harness.responses.set(FS_ROOT_CHANNEL, { root: "/ws" });
  harness.responses.set(
    FS_LIST_CHILDREN_CHANNEL,
    (payload: { path: string }) =>
      disk.get(payload.path) ?? { ok: false, error: { code: "not-found" } },
  );
  return { harness, store, disk };
}

/** Seeds root + /ws/src expanded and /ws/docs collapsed-but-cached. */
async function seedTree(store: ReturnType<typeof createFileTreeStore>) {
  await store.getState().loadRoot();
  await store.getState().expand("/ws/src");
  await store.getState().expand("/ws/docs");
  store.getState().collapse("/ws/docs");
}

describe("createFileTreeStore.refresh", () => {
  it("replaces visible listings with fresh disk state and drops collapsed caches", async () => {
    const { store, disk } = makeLoadedStore();
    await seedTree(store);
    // External change between refreshes: a new file at the root, and
    // main.rs is gone.
    disk.set("/ws", {
      ok: true,
      entries: [
        { name: "src", path: "/ws/src", kind: "directory" },
        { name: "README.md", path: "/ws/README.md", kind: "file" },
        { name: "new-file.ts", path: "/ws/new-file.ts", kind: "file" },
      ],
    });
    disk.set("/ws/src", { ok: true, entries: [] });

    await store.getState().refresh();

    const s = store.getState();
    expect(s.childrenByDir["/ws"] ?? []).toEqual(
      expect.arrayContaining([
        { name: "new-file.ts", path: "/ws/new-file.ts", kind: "file" },
      ]),
    );
    expect(
      (s.childrenByDir["/ws"] ?? []).some((e) => e.path === "/ws/src"),
    ).toBe(true);
    expect(s.childrenByDir["/ws/src"]).toEqual([]);
    // Collapsed caches are dropped — not visible, not trusted.
    expect(s.childrenByDir["/ws/docs"]).toBeUndefined();
    // The visible set stays expanded.
    expect(s.expandedDirs["/ws"]).toBe(true);
    expect(s.expandedDirs["/ws/src"]).toBe(true);
  });

  it("drops a directory that no longer exists: no cache, no expansion", async () => {
    const { store, disk } = makeLoadedStore();
    await seedTree(store);
    disk.delete("/ws/src");

    await store.getState().refresh();

    const s = store.getState();
    expect(s.childrenByDir["/ws/src"]).toBeUndefined();
    expect(s.expandedDirs["/ws/src"]).toBeUndefined();
    // The root (still present) keeps its data and expansion.
    expect(s.childrenByDir["/ws"]).toBeDefined();
    expect(s.expandedDirs["/ws"]).toBe(true);
  });

  it("keeps last-known cache and expansion on a transient failure", async () => {
    const { store, disk } = makeLoadedStore();
    await seedTree(store);
    disk.set("/ws/src", { ok: false, error: { code: "unknown" } });

    await store.getState().refresh();

    const s = store.getState();
    expect(s.childrenByDir["/ws/src"]).toEqual([
      { name: "main.rs", path: "/ws/src/main.rs", kind: "file" },
    ]);
    expect(s.expandedDirs["/ws/src"]).toBe(true);
  });

  it("clears the selection only when a fresh listing positively says it is gone", async () => {
    const { store, disk } = makeLoadedStore();
    await seedTree(store);
    store.getState().select({
      name: "main.rs",
      path: "/ws/src/main.rs",
      kind: "file",
    });
    // External deletion: the parent re-lists ok without the file.
    disk.set("/ws/src", { ok: true, entries: [] });

    await store.getState().refresh();

    expect(store.getState().selectedEntry).toBeNull();
  });

  it("keeps the selection when its parent's listing failed (unverifiable)", async () => {
    const { store, disk } = makeLoadedStore();
    await seedTree(store);
    const entry: FileEntry = {
      name: "main.rs",
      path: "/ws/src/main.rs",
      kind: "file",
    };
    store.getState().select(entry);
    disk.set("/ws/src", { ok: false, error: { code: "unknown" } });

    await store.getState().refresh();

    expect(store.getState().selectedEntry).toEqual(entry);
  });

  it("is a no-op before loadRoot has landed", async () => {
    const { store } = makeLoadedStore();

    await store.getState().refresh();

    const s = store.getState();
    expect(s.root).toBeNull();
    expect(s.childrenByDir).toEqual({});
  });
});
