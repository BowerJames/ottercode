import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { OttercodeClient } from "../../../shared/ipc/client";
import type { FileEntry } from "../../../shared/ipc/fs";
import { parentDir } from "./parent-dir";

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
  /** The cursor: the selected entry, metadata included (the editor's
   * kind branch consumes it). */
  selectedEntry: FileEntry | null;

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
  /** Records the selected entry. */
  select(entry: FileEntry): void;
  /**
   * Re-lists the visible set from disk: the root plus every expanded
   * directory, in parallel, swapped in atomically (one set). Collapsed
   * directories' caches are dropped — not visible, not trusted;
   * re-expanding refetches (expand already fetches on miss). A
   * not-found re-list drops that directory's cache AND expansion —
   * it's gone, and its parent's fresh listing drops the row; any
   * other failure keeps the last-known cache and expansion
   * (transient, and "expanded implies cached" must survive the
   * refresh). The selection is cleared only when positively known
   * gone — its parent re-listed ok and the entry's path is absent;
   * selections that cannot be verified stand. The root itself is
   * immutable for the app's lifetime, so fs:root is never re-fetched.
   * No-op before loadRoot has landed. Settles only after the store
   * reflects the outcome.
   */
  refresh(): Promise<void>;
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
    selectedEntry: null,

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

    select(entry) {
      set({ selectedEntry: entry });
    },

    async refresh() {
      const start = get();
      if (start.root === null) return; // nothing loaded: no-op
      const dirs = new Set([start.root, ...Object.keys(start.expandedDirs)]);
      const listings = await Promise.all(
        [...dirs].map(
          async (dir) => [dir, await fs.listChildren(dir)] as const,
        ),
      );
      set((s) => {
        const children: Record<string, FileEntry[] | undefined> = {};
        // Dirs with a fresh listing, and every path those listings showed.
        const fresh = new Set<string>();
        const shownPaths = new Set<string>();
        for (const [dir, result] of listings) {
          if (result.ok) {
            children[dir] = result.entries;
            fresh.add(dir);
            for (const entry of result.entries) shownPaths.add(entry.path);
          } else if (result.error.code !== "not-found") {
            // Transient: keep the last-known cache (if any) so a
            // hiccup neither collapses the tree nor breaks the
            // expanded-implies-cached invariant.
            const old = s.childrenByDir[dir];
            if (old !== undefined) children[dir] = old;
          }
          // not-found: the directory is gone — no cache, no
          // expansion; its parent's fresh listing drops the row.
        }
        // Expansion survives wherever data survives. Dirs expanded
        // AFTER the fetches began (not in the fetch set) ride along
        // on their existing cache — a fetch of their own is already
        // under way; a fetched dir's fate was decided by its listing
        // above (fresh, kept-transient, or dropped-not-found).
        const expandedDirs: Record<string, true> = {};
        for (const dir of Object.keys(s.expandedDirs)) {
          if (children[dir] === undefined && !dirs.has(dir)) {
            const old = s.childrenByDir[dir];
            if (old !== undefined) children[dir] = old;
          }
          if (children[dir] !== undefined) expandedDirs[dir] = true;
        }
        // Selection: cleared only when a fresh listing positively
        // says the entry is gone; unverifiable selections stand.
        let selectedEntry = s.selectedEntry;
        if (
          selectedEntry !== null &&
          fresh.has(parentDir(selectedEntry.path)) &&
          !shownPaths.has(selectedEntry.path)
        ) {
          selectedEntry = null;
        }
        return { childrenByDir: children, expandedDirs, selectedEntry };
      });
    },
  }));
}
