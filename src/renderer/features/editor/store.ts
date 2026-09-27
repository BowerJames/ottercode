import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { OttercodeClient } from "../../../shared/ipc/client";
import type { FsErrorCode } from "../../../shared/ipc/fs";

/** The slice of the client the editor depends on. */
export type EditorFs = Pick<OttercodeClient["fs"], "readFile">;

/**
 * An in-memory editable copy of one file's text, with provenance.
 * Nothing ever writes this back to disk — the agent flow is the only
 * writer (see DEVELOPMENT.md: disk is the source of truth).
 */
export type WorkingCopy = {
  /** Disk content at load time — the diff base. Unrecoverable later. */
  original: string;
  /** Current in-memory text. */
  content: string;
  /** Bumped only by reset — the editor's remount signal: the document
   * key is path:revision, so a reset rebuilds the CodeMirror surface
   * from the restored content (dropping undo history, by design). */
  revision: number;
};

/** Last failed open, for the error surface. */
export type OpenError = { path: string; code: FsErrorCode };

export type EditorState = {
  workingCopies: Record<string, WorkingCopy>;
  /** The document currently displayed. */
  activePath: string | null;
  /** Null after any successful open. */
  openError: OpenError | null;

  /**
   * Loads the file into a working copy (first open only) and makes it
   * active. On failure: no copy is created, the previous document stays
   * active, and openError records the code. Settles only after the
   * store reflects the outcome.
   */
  open(path: string): Promise<void>;
  /** Replaces the in-memory content of an open working copy. */
  edit(path: string, content: string): void;
  /** Restores the load-time snapshot: content := original, revision
   * bumps. The bump is the remount signal — the editor's document key
   * consumes it, so the surface rebuilds from the restored content.
   * `original` stands: it remains the diff base for the next edit
   * cycle. No-op for a path with no copy — reset never creates one.
   * Not a disk re-read: disk may have moved on since load; this
   * undoes the USER's edits to what they saw. */
  reset(path: string): void;
};

export type UseEditorStore = UseBoundStore<StoreApi<EditorState>>;

/**
 * Builds an editor store over an injected client slice. The feature's
 * wiring module is the composition root supplying the real singleton;
 * tests supply the real client over a fake Invoke.
 */
export function createEditorStore(fs: EditorFs): UseEditorStore {
  return create<EditorState>()((set, get) => ({
    workingCopies: {},
    activePath: null,
    openError: null,

    async open(path) {
      const existing = get().workingCopies[path];
      if (existing === undefined) {
        const result = await fs.readFile(path);
        if (!result.ok) {
          // Failure: no copy, no activation — the previous document
          // stays visible and the error surface gets the code.
          set({ openError: { path, code: result.error.code } });
          return;
        }
        set((s) => ({
          workingCopies: {
            ...s.workingCopies,
            [path]: {
              original: result.content,
              content: result.content,
              revision: 0,
            },
          },
          activePath: path,
          openError: null,
        }));
      } else {
        // Cached: activate only. The copy (and any edits) is preserved.
        set({ activePath: path, openError: null });
      }
    },

    edit(path, content) {
      set((s) => {
        const copy = s.workingCopies[path];
        if (copy === undefined) return s; // editing requires an open copy
        return {
          workingCopies: {
            ...s.workingCopies,
            [path]: { ...copy, content },
          },
        };
      });
    },

    reset(path) {
      set((s) => {
        const copy = s.workingCopies[path];
        if (copy === undefined) return s; // no phantom copies on reset
        return {
          workingCopies: {
            ...s.workingCopies,
            [path]: {
              ...copy,
              content: copy.original,
              revision: copy.revision + 1,
            },
          },
        };
      });
    },
  }));
}
