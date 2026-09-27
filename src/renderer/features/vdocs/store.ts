import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { OttercodeClient } from "../../../shared/ipc/client";
import type {
  VDocChange,
  VDocCreateResult,
  VDocMeta,
  VDocName,
} from "../../../shared/ipc/vdoc";

/** The slice of the client the vdoc list depends on. */
export type VdocListClient = Pick<
  OttercodeClient["vdoc"],
  "list" | "create" | "delete"
>;

/**
 * The sidebar's projection of the vdoc world: which design docs exist
 * and what version each is at. The authority is main's VDocStore; this
 * store never holds content — opening a doc is the editor's business
 * (openVdoc on the editor store), and this list only names entries.
 *
 * Two feeds keep `docs` current: `refresh()` (the initial pull) and
 * `applyChange` (pushed changes, forwarded by the wiring in
 * use-vdocs — the composition root is the one place the push joins
 * the store). The editor subscribes to the same push independently
 * for its open buffers; neither feature knows about the other.
 */
export type VdocsState = {
  /** Sorted by name (the main store's list policy; pushes re-sort). */
  docs: readonly VDocMeta[];

  /** Pull the authoritative list. Settles after state reflects it. */
  refresh(): Promise<void>;
  /** Create with starter content (the authority requires content from
   *  birth — no empty genesis). Returns the wire result mechanically;
   *  the caller decides what to do with `doc` (typically: open it). */
  create(name: VDocName): Promise<VDocCreateResult>;
  /** Delete. The push removes the row; errors are swallowed — the
   *  list self-heals on the next change either way. */
  remove(name: VDocName): Promise<void>;
  /** Apply one pushed change: upsert on created/written, drop on
   *  deleted. Order is kept sorted by name for stable rendering. */
  applyChange(change: VDocChange): void;
};

export type UseVdocsStore = UseBoundStore<StoreApi<VdocsState>>;

export function createVdocsStore(vdoc: VdocListClient): UseVdocsStore {
  return create<VdocsState>()((set) => ({
    docs: [],

    async refresh() {
      const result = await vdoc.list();
      set({ docs: result.docs });
    },

    async create(name) {
      return vdoc.create(name, templateFor(name));
    },

    async remove(name) {
      await vdoc.delete(name);
    },

    applyChange(change) {
      set((s) => {
        if (change.kind === "deleted") {
          return { docs: s.docs.filter((d) => d.name !== change.name) };
        }
        const meta = { name: change.name, version: change.version };
        const exists = s.docs.some((d) => d.name === change.name);
        const docs = exists
          ? s.docs.map((d) => (d.name === change.name ? meta : d))
          : [...s.docs, meta];
        return { docs: [...docs].sort(byName) };
      });
    },
  }));
}

/** Starter content for a new doc: a heading derived from the name
 *  ("auth-flow.md" → "# Auth flow"). Presentation choice, not policy
 *  — the authority only requires non-birth-empty. */
function templateFor(name: VDocName): string {
  const title = name
    .replace(/\.md$/, "")
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  return `# ${title}\n\n`;
}

function byName(a: VDocMeta, b: VDocMeta): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}
