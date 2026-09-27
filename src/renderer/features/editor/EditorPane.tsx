import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  EditorView as CodeMirrorView,
  drawSelection,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import type { FsErrorCode } from "../../../shared/ipc/fs";
import { useFileTree } from "../file-tree/use-file-tree";
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
  const openError = useEditor((s) => s.openError);

  const showError =
    openError !== null && openError.path === (selected?.path ?? null);
  const dirty =
    workingCopy !== undefined && workingCopy.content !== workingCopy.original;

  return (
    <section className="editor-pane">
      {activePath !== null && workingCopy !== undefined && (
        <div className="editor-header">
          <span className="editor-file-name">{basename(activePath)}</span>
          {dirty && (
            <span
              className="editor-dirty-dot"
              title="Differs from disk — edits live in memory only"
            >
              ●
            </span>
          )}
        </div>
      )}
      {showError && openError !== null && (
        <div className="editor-error">{ERROR_MESSAGES[openError.code]}</div>
      )}
      {activePath !== null && workingCopy !== undefined ? (
        <EditorDocument
          key={activePath}
          path={activePath}
          initial={workingCopy.content}
        />
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
 * (the open/close decision lives in selection-request); an empty
 * selection falls through to native behavior.
 */
function EditorDocument({ path, initial }: { path: string; initial: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<CodeMirrorView | null>(null);
  const [menuRequest, setMenuRequest] = useState<SelectionMenuRequest | null>(
    null,
  );
  const edit = useEditor((s) => s.edit);
  // Capture once per mount: re-renders pass the latest store content,
  // but the editor must not be rebuilt mid-edit.
  const initialDoc = useRef(initial).current;

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const view = new CodeMirrorView({
      parent: host,
      doc: initialDoc,
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        // Draws the caret and selection ourselves: the native caret is
        // black and hairline-thin — invisible on the dark background.
        drawSelection(),
        editorTheme,
        CodeMirrorView.updateListener.of((update) => {
          if (update.docChanged) {
            edit(path, update.state.doc.toString());
          }
        }),
      ],
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [edit, initialDoc, path]);

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a pointer-only affordance by design — right-click has no keyboard equivalent, and CodeMirror (not this host div) owns the keyboard semantics inside. */}
      <div
        ref={hostRef}
        className="editor-host"
        onContextMenu={(e) => {
          const view = viewRef.current;
          if (view === null) return;
          const main = view.state.selection.main;
          const request = selectionMenuRequest(
            path,
            main,
            view.state.sliceDoc(main.from, main.to),
            { x: e.clientX, y: e.clientY },
          );
          if (request === null) return; // empty selection: native path
          e.preventDefault();
          setMenuRequest(request);
        }}
      />
      {menuRequest !== null && (
        <SelectionMenu
          request={menuRequest}
          onClose={() => setMenuRequest(null)}
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
