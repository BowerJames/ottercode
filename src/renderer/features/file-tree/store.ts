import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { OttercodeClient } from "../../../shared/ipc/client";
import type { FileEntry } from "../../../shared/ipc/fs";

/**
 * The slice of the client the file tree depends on. A type-level
 * narrowing (the real client satisfies it structurally) — documentation,
 * not architecture: no adapters, no wiring.
 */
export type FileTreeFs = Pick<OttercodeClient["fs"], "root" | "listChildren">;

export type FileTreeState = {
  /** Workspace root; null until loadRoot resolves. */
  root: string | null;
  /** Lazy cache: directory path -> its children. Undefined = never fetched. */
  childrenByDir: Record<string, FileEntry[] | undefined>;
  /** The open set: expanded directory path -> true. */
  expandedDirs: Record<string, true>;
  /** The cursor: currently selected entry path. */
  selectedPath: string | null;

  /**
   * Bootstrap: fetch the workspace root and seed its children. The
   * returned promise settles only after the store reflects the outcome.
   */
  loadRoot(): Promise<void>;
  /**
   * On cache miss, fetch the directory's children; mark the directory
   * expanded. On failure (ok: false) the store is left untouched — a
   * node may never be shown expanded without data.
   */
  expand(path: string): Promise<void>;
  /** Unmark expansion. The cache is kept — re-expanding is instant. */
  collapse(path: string): void;
  /** Expand if collapsed, collapse if expanded. */
  toggle(path: string): Promise<void>;
  select(path: string): void;
};

export type UseFileTreeStore = UseBoundStore<StoreApi<FileTreeState>>;

/**
 * Builds a file-tree store over an injected client slice. The feature's
 * wiring module is the composition root that supplies the real
 * singleton; tests supply the real client over a fake Invoke.
 */
export function createFileTreeStore(fs: FileTreeFs): UseFileTreeStore {
  return create<FileTreeState>()((set, get) => ({
    root: null,
    childrenByDir: {},
    expandedDirs: {},
    selectedPath: null,

    async loadRoot() {
      const { root } = await fs.root();
      set({ root });
      await get().expand(root);
    },

    async expand(path) {
      const cached = get().childrenByDir[path];
      if (cached === undefined) {
        const result = await fs.listChildren(path);
        if (!result.ok) return; // failure: state untouched
        // One set: "expanded implies cached" is never observably broken.
        set((s) => ({
          childrenByDir: { ...s.childrenByDir, [path]: result.entries },
          expandedDirs: { ...s.expandedDirs, [path]: true },
        }));
      } else {
        set((s) => ({ expandedDirs: { ...s.expandedDirs, [path]: true } }));
      }
    },

    collapse(path) {
      set((s) => {
        const expandedDirs = { ...s.expandedDirs };
        delete expandedDirs[path];
        return { expandedDirs };
      });
    },

    async toggle(path) {
      if (get().expandedDirs[path] === undefined) {
        await get().expand(path);
      } else {
        get().collapse(path);
      }
    },

    select(path) {
      set({ selectedPath: path });
    },
  }));
}
