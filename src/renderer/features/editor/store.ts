import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { OttercodeClient } from "../../../shared/ipc/client";
import type { FsErrorCode } from "../../../shared/ipc/fs";
import type { LangFileEdit } from "../../../shared/ipc/lang";
import type { LangPosition } from "../../../shared/lang/position";

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

/**
 * A jump target for the definition flow: open this document and land
 * on this position. The nonce makes every request distinct — two
 * jumps to the same spot must both land — and consumption CLEARS the
 * field (clearReveal), so remounting a document never replays a stale
 * jump.
 */
export type RevealRequest = {
  path: string;
  position: LangPosition;
  nonce: number;
};

/** An in-memory document with no disk counterpart — either a
 * read-only snapshot (e.g. a user chat message opened for reading) or
 * an editable draft of an assistant message. Kept in its own record
 * (`virtualDocs`), never in `workingCopies`: every file flow (dirty
 * marking, edit attachment, reset) iterates `workingCopies` only, so
 * a virtual doc STRUCTURALLY cannot leak into them — most importantly
 * into collectEdits, whose output crosses the IPC contract into
 * main's disk writes. A synthetic key must never ride `agent:submit`
 * as a file edit; edited drafts ride as AgentMessageEdit, a different
 * attachment kind that carries a title, not a path. */
export type VirtualDoc = {
  /** Display title — synthetic keys are ugly on purpose. Also the
   * wire identity of an edited draft (AgentMessageEdit.title). */
  title: string;
  /** True for assistant-message drafts: editable, rendered as
   * markdown, and gathered as an attachment when dirty. False for
   * reading snapshots: plain, read-only, never dirty. */
  draft: boolean;
  /** The text as it was opened — for drafts, the assistant's words
   * (the diff base and revert target); for snapshots, the text. */
  original: string;
  /** Current text. Moves only for drafts (via `edit`); snapshots
   * keep it identical to `original` forever. */
  content: string;
  /** Bumped only by a reopening that CHANGED the text, or by reset —
   * the editor's remount signal, same contract as
   * WorkingCopy.revision: the document key is key:revision, so a
   * refresh or reset rebuilds the surface from the new text. */
  revision: number;
};

export type EditorState = {
  workingCopies: Record<string, WorkingCopy>;
  /** Read-only, disk-less documents, keyed synthetically (e.g.
   * `virtual:chat/7`). Keys are constructed by the opener; the fs
   * tree can never produce one, so the two records can't collide. */
  virtualDocs: Record<string, VirtualDoc>;
  /** The document currently displayed (a working-copy path or a
   * virtual key — the pane checks virtualDocs first). */
  activePath: string | null;
  /** Null after any successful open. */
  openError: OpenError | null;
  /** The pending definition jump, if any (see RevealRequest). */
  reveal: RevealRequest | null;

  /**
   * Loads the file into a working copy (first open only) and makes it
   * active. On failure: no copy is created, the previous document stays
   * active, and openError records the code. Settles only after the
   * store reflects the outcome.
   */
  open(path: string): Promise<void>;
  /** Opens a virtual document and makes it active. No fs read, no
   * error mode. `draft` marks an assistant message: editable and
   * markdown-rendered (snapshots stay read-only and plain). Refresh
   * semantics: reopening a CLEAN doc with changed text refreshes the
   * snapshot and bumps the revision (a message may have grown since);
   * reopening an EDITED draft never clobbers — the user's edits win
   * over the live entry, and the doc only gains focus. Reopening
   * never duplicates. */
  openVirtual(doc: {
    key: string;
    title: string;
    text: string;
    draft?: boolean;
  }): void;
  /** Replaces the in-memory content of an open working copy, or of an
   * assistant-message draft. Snapshots are structural no-ops: they
   * have no editable surface. */
  edit(path: string, content: string): void;
  /** Restores the open-time snapshot: content := original, revision
   * bumps. The bump is the remount signal — the editor's document key
   * consumes it, so the surface rebuilds from the restored content.
   * `original` stands: it remains the diff base for the next edit
   * cycle. No-op for a key with no open document — reset never
   * creates one. Not a disk re-read: this undoes the USER's edits to
   * what they saw. */
  reset(path: string): void;
  /** Applies a rename's file edits in memory — rename never writes
   * disk (the agent flow is the only writer). Open copies keep their
   * OWN original (the diff base stands) and gain content + a revision
   * bump (the remount signal); unopened files materialize as dirty
   * copies from the edit pair itself — exactly the shape collectEdits
   * attaches to the next turn. Activation is never touched. */
  applyRenameEdits(edits: LangFileEdit[]): void;
  /** Records a definition jump target (fresh nonce per call). */
  revealAt(request: Omit<RevealRequest, "nonce">): void;
  /** Consumes the pending jump (EditorDocument calls this after
   * scrolling), so a later remount doesn't replay it. */
  clearReveal(): void;
};

export type UseEditorStore = UseBoundStore<StoreApi<EditorState>>;

/**
 * Builds an editor store over an injected client slice. The feature's
 * wiring module is the composition root supplying the real singleton;
 * tests supply the real client over a fake Invoke.
 */
export function createEditorStore(fs: EditorFs): UseEditorStore {
  // Store-local nonce counter: stays out of the public state shape.
  let revealNonce = 0;
  return create<EditorState>()((set, get) => ({
    workingCopies: {},
    virtualDocs: {},
    activePath: null,
    openError: null,
    reveal: null,

    openVirtual(doc) {
      set((s) => {
        const existing = s.virtualDocs[doc.key];
        // An edited draft wins over the live entry: reopen with
        // different text keeps the user's work and only focuses.
        // Everything else refreshes when the text actually moved —
        // a refocus of the same text keeps the surface (and its
        // scroll position) standing.
        const dirty =
          existing !== undefined && existing.content !== existing.original;
        // A first open is not a change: revision starts at 0, and only
        // a reopen with moved text bumps it.
        const changed =
          existing !== undefined && existing.original !== doc.text;
        return {
          virtualDocs: {
            ...s.virtualDocs,
            [doc.key]: {
              title: doc.title,
              draft: doc.draft ?? false,
              original: dirty ? (existing?.original ?? doc.text) : doc.text,
              content: dirty ? (existing?.content ?? doc.text) : doc.text,
              revision:
                !dirty && changed
                  ? (existing?.revision ?? 0) + 1
                  : (existing?.revision ?? 0),
            },
          },
          activePath: doc.key,
          openError: null,
        };
      });
    },

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
        if (copy !== undefined) {
          return {
            workingCopies: {
              ...s.workingCopies,
              [path]: { ...copy, content },
            },
          };
        }
        // Drafts only — a snapshot has no editable surface, so its
        // key is a structural no-op here (never dirty, never rides).
        const doc = s.virtualDocs[path];
        if (doc?.draft) {
          return {
            virtualDocs: {
              ...s.virtualDocs,
              [path]: { ...doc, content },
            },
          };
        }
        return s; // editing requires an open copy or draft
      });
    },

    reset(path) {
      set((s) => {
        const copy = s.workingCopies[path];
        if (copy !== undefined) {
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
        }
        const doc = s.virtualDocs[path];
        if (doc !== undefined) {
          return {
            virtualDocs: {
              ...s.virtualDocs,
              [path]: {
                ...doc,
                content: doc.original,
                revision: doc.revision + 1,
              },
            },
          };
        }
        return s; // no phantom documents on reset
      });
    },

    applyRenameEdits(edits) {
      if (edits.length === 0) return;
      set((s) => {
        const workingCopies = { ...s.workingCopies };
        for (const edit of edits) {
          const open = workingCopies[edit.path];
          workingCopies[edit.path] =
            open !== undefined
              ? { ...open, content: edit.edited, revision: open.revision + 1 }
              : { original: edit.original, content: edit.edited, revision: 0 };
        }
        return { workingCopies };
      });
    },

    revealAt(request) {
      revealNonce += 1;
      set({ reveal: { ...request, nonce: revealNonce } });
    },

    clearReveal() {
      set({ reveal: null });
    },
  }));
}
