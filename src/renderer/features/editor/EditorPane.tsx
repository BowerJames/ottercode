import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import {
  EditorView as CodeMirrorView,
  drawSelection,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import type { FsErrorCode } from "../../../shared/ipc/fs";
import { languageIdOf } from "../../../shared/lang/languages";
import { Markdown } from "../../components/Markdown";
import { useFileTree } from "../file-tree/use-file-tree";
import { completionExtension } from "./completion";
import {
  definitionExtension,
  goToDefinitionAt,
  revealInView,
} from "./definition";
import { languageFor } from "./language";
import { isMarkdownPath } from "./markdown";
import { RenamePrompt, renameKeymap } from "./rename";
import { SelectionMenu } from "./SelectionMenu";
import {
  type SelectionMenuRequest,
  selectionMenuRequest,
} from "./selection-request";
import { useEditor } from "./use-editor";

/** The error surface: distinct messages per code. Presentation, not
 * consumption — nothing downstream computes with these; the unit suite
 * deliberately does not pin the codes. E2E's territory. */
const ERROR_MESSAGES: Record<FsErrorCode, string> = {
  "not-found": "File not found — it may have been deleted since you saw it.",
  "not-a-directory": "Not a directory.",
  "is-a-directory": "Directories can't be opened as documents.",
  "permission-denied": "Permission denied.",
  binary: "Binary file — ottercode only opens text.",
  "too-large": "File is too large to open.",
  unknown: "Couldn't open this file.",
};

/**
 * The right-hand pane: opens the tree's selected file into an in-memory
 * working copy and lets the user edit it. Edits never touch disk —
 * there is no save; the agent flow will be the only writer.
 */
export function EditorPane() {
  const selected = useFileTree((s) => s.selectedEntry);
  const open = useEditor((s) => s.open);

  // The one composition point between features: the tree's selection
  // drives the editor. Entries are identity-stable, so this effect
  // fires on selection changes only.
  useEffect(() => {
    if (selected !== null && selected.kind === "file") {
      void open(selected.path);
    }
  }, [selected, open]);

  const activePath = useEditor((s) => s.activePath);
  const workingCopy = useEditor((s) =>
    s.activePath === null ? undefined : s.workingCopies[s.activePath],
  );
  const virtualDoc = useEditor((s) =>
    s.activePath === null ? undefined : s.virtualDocs[s.activePath],
  );
  const openError = useEditor((s) => s.openError);
  const reset = useEditor((s) => s.reset);

  const showError =
    openError !== null && openError.path === (selected?.path ?? null);
  const dirty =
    (workingCopy !== undefined &&
      workingCopy.content !== workingCopy.original) ||
    (virtualDoc !== undefined && virtualDoc.content !== virtualDoc.original);

  // Preview is view state, not document state — the pane owns it, and
  // it resets per document: opening anything always lands in source
  // view. Eligibility: markdown files by path, assistant drafts by
  // kind — a draft IS markdown (its rail rendering proves it); user
  // snapshots stay plain text.
  const [preview, setPreview] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies(activePath): activePath is the intentional trigger — preview resets on document switch, not on anything the body reads.
  useEffect(() => {
    setPreview(false);
  }, [activePath]);

  const previewable =
    activePath !== null &&
    (workingCopy !== undefined
      ? isMarkdownPath(activePath)
      : (virtualDoc?.draft ?? false));
  const showPreview = preview && previewable;

  return (
    <section className="editor-pane">
      {(workingCopy !== undefined || virtualDoc !== undefined) &&
        activePath !== null && (
          <div className="editor-header">
            <span className="editor-file-name">
              {virtualDoc !== undefined
                ? virtualDoc.title
                : basename(activePath)}
            </span>
            {virtualDoc !== undefined && (
              <span
                className="editor-virtual-tag"
                title={
                  virtualDoc.draft
                    ? "an editable copy of this assistant message — your edits can attach to your next message"
                    : "read-only — a snapshot, not a file on disk"
                }
              >
                {virtualDoc.draft ? "draft" : "read-only"}
              </span>
            )}
            {dirty && (
              <span
                className="editor-dirty-dot"
                title={
                  virtualDoc !== undefined
                    ? "Differs from the assistant's message — your edits live in memory only"
                    : "Differs from disk — edits live in memory only"
                }
              >
                ●
              </span>
            )}
            {/* Rendered only while dirty, like the dot it answers. Reset is
              the store's remount signal: the key below rebuilds the
              surface from the restored snapshot — the loaded file or the
              assistant's words. Undo history drops — reset means
              discard, not another edit. */}
            {dirty && (
              <button
                type="button"
                className="editor-revert"
                title="discard your edits — restore the content as you opened it"
                onClick={() => reset(activePath)}
              >
                revert
              </button>
            )}
            {/* Markdown surfaces only — files by path, drafts by kind;
              the label names the view a click lands in. */}
            {previewable && (
              <button
                type="button"
                className="editor-preview-toggle"
                title="render this markdown file — or return to its source"
                onClick={() => setPreview((p) => !p)}
              >
                {showPreview ? "source" : "preview"}
              </button>
            )}
          </div>
        )}
      {showError && openError !== null && (
        <div className="editor-error">{ERROR_MESSAGES[openError.code]}</div>
      )}
      {activePath !== null && workingCopy !== undefined ? (
        showPreview ? (
          // The shared Markdown policy over the LIVE content: edits made
          // in source view show up on switch, and a revert updates the
          // preview in place. The trade: CodeMirror unmounts here, so
          // switching back starts a fresh undo history — the working
          // copy itself is untouched (view state, not document state).
          <div className="markdown-preview">
            <Markdown text={workingCopy.content} />
          </div>
        ) : (
          <EditorDocument
            // path:revision — a reset bumps the revision and remounts the
            // document from the restored snapshot (see store.reset).
            key={`${activePath}:${workingCopy.revision}`}
            path={activePath}
            initial={workingCopy.content}
            selectionMenu
          />
        )
      ) : activePath !== null && virtualDoc !== undefined ? (
        // Virtual docs: assistant drafts are EDITABLE markdown
        // surfaces (the toggle above swaps them between rendered and
        // source, same policy as files); user snapshots are read-only
        // plain text. Neither gets the selection menu — its request
        // carries the path across the IPC contract, and a synthetic
        // key must never cross (drafts ride as message edits, not
        // selections).
        showPreview ? (
          <div className="markdown-preview">
            <Markdown text={virtualDoc.content} />
          </div>
        ) : (
          <EditorDocument
            // Same remount contract as working copies: key:revision —
            // a refreshed snapshot or a reset rebuilds the surface.
            key={`${activePath}:${virtualDoc.revision}`}
            path={activePath}
            initial={virtualDoc.content}
            readonly={!virtualDoc.draft}
          />
        )
      ) : (
        <div className="editor-empty">Select a file to view and edit it</div>
      )}
    </section>
  );
}

/**
 * The CodeMirror surface for one document. Keyed by path at the call
 * site, so a document switch remounts; within a mount the editor owns
 * its own state and streams changes up to the store.
 *
 * Right-clicking a non-empty selection opens the send-to-agent menu
 * (the open/close decision lives in selection-request) — working
 * copies only, via `selectionMenu`; an empty selection falls through
 * to native behavior.
 */
function EditorDocument({
  path,
  initial,
  readonly = false,
  selectionMenu = false,
}: {
  path: string;
  initial: string;
  readonly?: boolean;
  /** Whether right-click opens the send-to-agent menu. Working
   * copies only: the menu's request carries the path across the IPC
   * contract, and a synthetic key must never cross — so editable
   * drafts stay menu-less by construction. */
  selectionMenu?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<CodeMirrorView | null>(null);
  const [menuRequest, setMenuRequest] = useState<SelectionMenuRequest | null>(
    null,
  );
  // Rename prompt anchor data, captured from the view when it opens.
  const [renameRequest, setRenameRequest] = useState<{
    x: number;
    y: number;
    offset: number;
  } | null>(null);
  const edit = useEditor((s) => s.edit);
  // Language intelligence eligibility — one classifier read, consumed by
  // the extension bundle and the context menu's language items alike.
  // Virtual doc keys classify to null by construction, so drafts and
  // snapshots self-disable.
  const languageClassified = languageIdOf(path) !== null;
  // The definition jump target, consumed once per request: cross-file
  // jumps land here after the target surface mounts.
  const reveal = useEditor((s) => s.reveal);
  const clearReveal = useEditor((s) => s.clearReveal);
  // Capture once per mount: re-renders pass the latest store content,
  // but the editor must not be rebuilt mid-edit.
  const initialDoc = useRef(initial).current;

  /** Opens the rename prompt. `at` (the symbol offset) overrides the
   * caret — the context menu passes the clicked word when there is
   * no selection. */
  const openRename = (at?: number): void => {
    const view = viewRef.current;
    if (view === null) return;
    const head = at ?? view.state.selection.main.head;
    const coords = view.coordsAtPos(head);
    setRenameRequest({
      x: coords?.left ?? 0,
      y: (coords?.bottom ?? 0) + 4,
      offset: head,
    });
  };

  // openRename is stable over the mount (closes over refs only) —
  // the view is built once per mount; it must not rebuild mid-edit.
  // biome-ignore lint/correctness/useExhaustiveDependencies(openRename): see the comment above — intentional exclusion.
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const view = new CodeMirrorView({
      parent: host,
      doc: initialDoc,
      extensions: [
        lineNumbers(),
        // Grammar, indent, and colors chosen from the path — unknown
        // types contribute nothing and stay plain text.
        ...languageFor(path),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        // Language intelligence — working copies of classified
        // languages only: the extensions self-gate on the shared
        // classifier, and virtual keys classify to null by construction.
        ...(!readonly && languageClassified
          ? [
              definitionExtension(path),
              completionExtension(path),
              renameKeymap(() => openRename()),
            ]
          : []),
        // Draws the caret and selection ourselves: the native caret is
        // black and hairline-thin — invisible on the dark background.
        drawSelection(),
        // Virtual snapshots are reading surfaces: selection and copy
        // work, editing does not (drafts edit, snapshots don't).
        ...(readonly ? [EditorState.readOnly.of(true)] : []),
        editorTheme,
        ...(!readonly
          ? [
              CodeMirrorView.updateListener.of((update) => {
                if (update.docChanged) {
                  edit(path, update.state.doc.toString());
                }
              }),
            ]
          : []),
      ],
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // languageClassified derives from path (already a dep): listing it
    // satisfies the exhaustive-deps rule without adding rebuilds.
  }, [edit, initialDoc, path, readonly, languageClassified]);

  // The definition jump, consumed once: the effect fires on reveal
  // requests (including the mount that follows a cross-file open),
  // scrolls to the target word, and clears — a later remount of this
  // surface never replays a consumed jump.
  useEffect(() => {
    const view = viewRef.current;
    if (reveal === null || view === null || reveal.path !== path) return;
    revealInView(view, reveal.position);
    clearReveal();
  }, [reveal, clearReveal, path]);

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a pointer-only affordance by design — right-click has no keyboard equivalent, and CodeMirror (not this host div) owns the keyboard semantics inside. */}
      <div
        ref={hostRef}
        className="editor-host"
        onContextMenu={
          selectionMenu
            ? (e) => {
                const view = viewRef.current;
                if (view === null) return;
                const main = view.state.selection.main;
                // The click's document offset: where the language menu
                // aims when nothing is selected. Outside text → caret.
                const clickOffset =
                  view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? main.head;
                const request = selectionMenuRequest(
                  path,
                  main,
                  view.state.sliceDoc(main.from, main.to),
                  { x: e.clientX, y: e.clientY },
                  clickOffset,
                );
                if (request === null) return; // nothing to offer: native path
                e.preventDefault();
                setMenuRequest(request);
              }
            : undefined
        }
      />
      {menuRequest !== null && (
        <SelectionMenu
          request={menuRequest}
          onClose={() => setMenuRequest(null)}
          onRename={
            languageClassified
              ? () => openRename(menuRequest.symbolOffset)
              : undefined
          }
          onGoToDefinition={
            languageClassified
              ? () => {
                  const view = viewRef.current;
                  if (view !== null) {
                    void goToDefinitionAt(view, path, menuRequest.symbolOffset);
                  }
                }
              : undefined
          }
        />
      )}
      {renameRequest !== null && viewRef.current !== null && (
        <RenamePrompt
          view={viewRef.current}
          path={path}
          offset={renameRequest.offset}
          anchor={{ x: renameRequest.x, y: renameRequest.y }}
          onClose={() => setRenameRequest(null)}
        />
      )}
    </>
  );
}

const editorTheme = CodeMirrorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "transparent",
      color: "#d4d4d4",
      fontSize: "13px",
    },
    ".cm-scroller": {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      lineHeight: "1.5",
    },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "#6a6a6a",
      border: "none",
    },
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.04)" },
    ".cm-activeLineGutter": { backgroundColor: "rgba(255,255,255,0.06)" },
    ".cm-cursor": { borderLeft: "2px solid #ffffff" },
    ".cm-selectionBackground": { backgroundColor: "rgba(79, 124, 196, 0.35)" },
    // Selection only happens while focused, and drawSelection's base
    // theme styles that band with a five-class selector (default
    // #d7d4f0 — light lavender, near-invisible under light text). The
    // theme class prepended to this selector makes it one deeper, so
    // the accent wins where it matters.
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground":
      {
        backgroundColor: "rgba(79, 124, 196, 0.55)",
      },
  },
  // Declares the UI dark: the base theme flips to dark defaults, so
  // any selection state we fail to style stays readable on its own.
  { dark: true },
);

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
