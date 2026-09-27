import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { OttercodeClient } from "../../../shared/ipc/client";
import type { FsErrorCode } from "../../../shared/ipc/fs";
import type { LangFileEdit } from "../../../shared/ipc/lang";
import type {
  VDocChange,
  VDocErrorCode,
  VDocName,
} from "../../../shared/ipc/vdoc";
import type { LangPosition } from "../../../shared/lang/position";

/** The slice of the client the editor depends on for files. */
export type EditorFs = Pick<OttercodeClient["fs"], "readFile">;

/** The slice of the client the editor depends on for design docs
 *  (open reads the authority; save writes it, version-guarded). */
export type EditorVdoc = Pick<OttercodeClient["vdoc"], "read" | "update">;

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

/** Last failed vdoc operation, for the error surface. Cleared by any
 *  successful vdoc open/save. */
export type VdocError = { name: VDocName; code: VDocErrorCode };

/**
 * The editor's buffer over one virtual design doc — the vdoc
 * equivalent of WorkingCopy. The authority is main's VDocStore (the
 * disk-truth of this doc kind); this record is the user's possibly-
 * unsaved view of it, plus what keeps that view honest:
 * - `baseVersion` is the authority version the buffer's content is
 *   based on — it arms the save (vdoc:update) and detects divergence.
 * - `conflict` means the authority moved on while this buffer was
 *   dirty — the banner (re-read | overwrite) resolves it; nothing
 *   clobbers silently in either direction.
 *
 * Same structural rule as virtualDocs: kept in its own record, so
 * every file flow (dirty marking, edit attachment, reset) that
 * iterates workingCopies only can never see it — a design doc
 * cannot ride agent:submit as a file edit, by construction.
 */
export type VDocBuffer = {
  /** Wire identity — the name in main's store (no key prefix). */
  name: VDocName;
  /** Authority content at open/last sync — diff base, revert target. */
  original: string;
  /** Current in-memory text. */
  content: string;
  /** The authority version `content` is based on — arms the save. */
  baseVersion: number;
  /** Bumped only by an adopt/reset that CHANGED the text — the
   *  remount signal, same contract as WorkingCopy.revision. */
  revision: number;
  /** The authority advanced while this buffer was dirty. */
  conflict: boolean;
};

/** The record key for a design doc's buffer: `vdoc:<name>`. Synthetic
 *  — the fs tree can never produce one, so records can't collide. */
export function vdocKey(name: VDocName): string {
  return `vdoc:${name}`;
}

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
  /** Buffers over virtual design docs, keyed `vdoc:<name>` — the
   * vdoc counterpart of workingCopies (see VDocBuffer). */
  vdocBuffers: Record<string, VDocBuffer>;
  /** The document currently displayed (a working-copy path, a
   * virtual key, or a vdoc key — the pane checks virtualDocs, then
   * vdocBuffers, then workingCopies). */
  activePath: string | null;
  /** Null after any successful open. */
  openError: OpenError | null;
  /** Null after any successful vdoc open/save. */
  vdocError: VdocError | null;
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
  /** Opens a virtual design doc's buffer and makes it active. On
   * failure: no buffer, previous document stays active, vdocError
   * records the code. Reopen semantics mirror openVirtual: clean +
   * changed → adopt (revision bumps, the surface rebuilds); dirty →
   * never clobber — the user's edits win and the doc only gains
   * focus. Reopening never duplicates. Settles after the store
   * reflects the outcome. */
  openVdoc(name: VDocName): Promise<void>;
  /** Saves a design doc's buffer to the authority, version-guarded:
   * ok advances original/baseVersion and clears conflict; a conflict
   * flags the buffer (banner resolves it) and touches nothing else;
   * other codes surface on vdocError. A clean buffer is a no-op.
   * `force` re-reads the authority first — explicit last-write-wins
   * (the banner's overwrite arm). */
  saveVdoc(key: string, opts?: { force?: boolean }): Promise<void>;
  /** Reloads a design doc's buffer from the authority UNCONDITIONALLY
   * — discards unsaved edits, clears conflict (the banner's re-read
   * arm; contrast openVdoc, which never clobbers). */
  reloadVdoc(key: string): Promise<void>;
  /** Applies one pushed vdoc change to OPEN buffers (wiring forwards
   * client.vdoc.onChange; the list feature projects the same push
   * separately). Clean buffers adopt (remount only when the text
   * moved); dirty buffers flag conflict — the user decides, nothing
   * clobbers silently. A deleted doc drops its buffer and, if active,
   * deactivates. Changes for unopened docs are no-ops here. */
  syncVdoc(change: VDocChange): void;
  /** Replaces the in-memory content of an open working copy, of an
   * assistant-message draft, or of a design doc buffer. Snapshots are
   * structural no-ops: they have no editable surface. */
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
 * Builds an editor store over injected client slices. The feature's
 * wiring module is the composition root supplying the real singleton;
 * tests supply fake slices.
 */
export function createEditorStore(
  fs: EditorFs,
  vdoc: EditorVdoc,
): UseEditorStore {
  // Store-local nonce counter: stays out of the public state shape.
  let revealNonce = 0;
  return create<EditorState>()((set, get) => ({
    workingCopies: {},
    virtualDocs: {},
    vdocBuffers: {},
    activePath: null,
    openError: null,
    vdocError: null,
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

    async openVdoc(name) {
      const key = vdocKey(name);
      const existing = get().vdocBuffers[key];
      if (existing === undefined) {
        const result = await vdoc.read(name);
        if (!result.ok) {
          // Failure: no buffer, no activation — the previous document
          // stays visible and the error surface gets the code.
          set({ vdocError: { name, code: result.error.code } });
          return;
        }
        set((s) => ({
          vdocBuffers: {
            ...s.vdocBuffers,
            [key]: {
              name,
              original: result.content,
              content: result.content,
              baseVersion: result.version,
              revision: 0,
              conflict: false,
            },
          },
          activePath: key,
          vdocError: null,
        }));
        return;
      }
      // Cached: a CLEAN buffer refreshes when the authority moved
      // (adopt + remount); a DIRTY one keeps the user's edits and
      // only gains focus — same reopen rule as openVirtual.
      if (existing.content === existing.original) {
        const result = await vdoc.read(name);
        if (result.ok && result.content !== existing.content) {
          set((s) => ({
            vdocBuffers: {
              ...s.vdocBuffers,
              [key]: {
                ...existing,
                original: result.content,
                content: result.content,
                baseVersion: result.version,
                revision: existing.revision + 1,
              },
            },
            activePath: key,
            vdocError: null,
          }));
          return;
        }
      }
      set({ activePath: key, vdocError: null });
    },

    async saveVdoc(key, opts) {
      const buffer = get().vdocBuffers[key];
      if (buffer === undefined) return;
      // A clean buffer has nothing to say — and skipping keeps version
      // churn (and its push echo) out of a refocus.
      if (buffer.content === buffer.original && opts?.force !== true) {
        return;
      }
      let expectedVersion = buffer.baseVersion;
      if (opts?.force) {
        // Explicit last-write-wins: rebase onto the authority's current
        // version before writing (the banner's overwrite arm).
        const read = await vdoc.read(buffer.name);
        if (!read.ok) {
          set({ vdocError: { name: buffer.name, code: read.error.code } });
          return;
        }
        expectedVersion = read.version;
      }
      const result = await vdoc.update(
        buffer.name,
        buffer.content,
        expectedVersion,
      );
      if (result.ok) {
        const saved = buffer.content;
        set((s) => ({
          vdocBuffers: {
            ...s.vdocBuffers,
            [key]: {
              ...buffer,
              original: saved,
              baseVersion: result.doc.version,
              conflict: false,
            },
          },
          vdocError: null,
        }));
        return;
      }
      if (result.error.code === "conflict") {
        // Flag, don't touch: the banner decides (re-read | overwrite).
        // The push for the winning write has typically already flagged
        // this — setting it again is idempotent.
        set((s) => ({
          vdocBuffers: {
            ...s.vdocBuffers,
            [key]: { ...buffer, conflict: true },
          },
        }));
        return;
      }
      set({ vdocError: { name: buffer.name, code: result.error.code } });
    },

    async reloadVdoc(key) {
      const buffer = get().vdocBuffers[key];
      if (buffer === undefined) return;
      const result = await vdoc.read(buffer.name);
      if (!result.ok) {
        set({ vdocError: { name: buffer.name, code: result.error.code } });
        return;
      }
      set((s) => ({
        vdocBuffers: {
          ...s.vdocBuffers,
          [key]: {
            ...buffer,
            original: result.content,
            content: result.content,
            baseVersion: result.version,
            revision:
              result.content === buffer.content
                ? buffer.revision
                : buffer.revision + 1,
            conflict: false,
          },
        },
        vdocError: null,
      }));
    },

    syncVdoc(change) {
      const key = vdocKey(change.name);
      const buffer = get().vdocBuffers[key];
      if (buffer === undefined) return; // not open — the list's business
      if (change.kind === "deleted") {
        // The doc is gone; the buffer goes with it. If it was active,
        // deactivate silently (v1 ruling) — the list row disappears in
        // parallel via its own projection.
        set((s) => {
          const vdocBuffers = { ...s.vdocBuffers };
          delete vdocBuffers[key];
          return {
            vdocBuffers,
            activePath: s.activePath === key ? null : s.activePath,
          };
        });
        return;
      }
      const dirty = buffer.content !== buffer.original;
      if (dirty) {
        // The authority moved under unsaved edits — flag and wait. The
        // user's stale baseVersion will conflict honestly if they
        // save anyway; the banner offers the clean resolution.
        set((s) => ({
          vdocBuffers: {
            ...s.vdocBuffers,
            [key]: { ...buffer, conflict: true },
          },
        }));
        return;
      }
      // Clean: adopt. No remount when the text is what we already
      // show (e.g. the echo of this user's own save).
      set((s) => ({
        vdocBuffers: {
          ...s.vdocBuffers,
          [key]: {
            ...buffer,
            original: change.content,
            content: change.content,
            baseVersion: change.version,
            revision:
              change.content === buffer.content
                ? buffer.revision
                : buffer.revision + 1,
            conflict: false,
          },
        },
      }));
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
        const buffer = s.vdocBuffers[path];
        if (buffer !== undefined) {
          return {
            vdocBuffers: {
              ...s.vdocBuffers,
              [path]: { ...buffer, content },
            },
          };
        }
        return s; // editing requires an open copy, draft, or vdoc buffer
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
        const buffer = s.vdocBuffers[path];
        if (buffer !== undefined) {
          return {
            vdocBuffers: {
              ...s.vdocBuffers,
              [path]: {
                ...buffer,
                content: buffer.original,
                revision: buffer.revision + 1,
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
