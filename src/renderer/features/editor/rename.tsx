import type { Extension } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import type { RenameOutcome } from "./language-intel";
import { languageIntel } from "./use-language";

/**
 * Rename, view half: F2 (or the selection menu's entry) opens a
 * caret-anchored prompt; submitting asks the language service for the
 * workspace-wide edit set and applies it in memory through the store
 * — the edits then ride the next agent turn like any hand edit.
 */

export function renameKeymap(open: () => void): Extension {
  return keymap.of([
    {
      key: "F2",
      run: () => {
        open();
        return true;
      },
    },
  ]);
}

/** The caret-anchored rename prompt. Anchored where the symbol sits;
 * outcome feedback stays inline (stale/failed never close silently). */
export function RenamePrompt({
  view,
  path,
  offset,
  anchor,
  onClose,
}: {
  view: EditorView;
  path: string;
  /** The symbol's offset, captured when the prompt opened. */
  offset: number;
  anchor: { x: number; y: number };
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  // The staleness guard's anchor: rename refuses if the document
  // moved since the prompt opened (see language-intel.rename).
  const contentAtOpen = useRef(view.state.doc.toString());
  const [status, setStatus] = useState<null | RenameOutcome>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      if (
        rootRef.current !== null &&
        !rootRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const submit = (): void => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    void (async () => {
      const outcome = await languageIntel.rename(
        path,
        view.state.doc.toString(),
        offset,
        trimmed,
        contentAtOpen.current,
      );
      if (outcome.kind === "applied") {
        onClose(); // edits applied in memory; remounts handle the rest
        return;
      }
      setStatus(outcome);
    })();
  };

  return (
    <div ref={rootRef} className="rename-prompt" style={anchor}>
      <input
        className="rename-prompt-input"
        value={name}
        placeholder="new name"
        onChange={(e) => {
          setName(e.target.value);
          setStatus(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        // biome-ignore lint/a11y/noAutofocus: the prompt's whole purpose is immediate typing — stealing focus on open IS the interaction.
        autoFocus
      />
      <div className="rename-prompt-row">
        {status?.kind === "stale" && (
          <span className="rename-prompt-status">
            document changed — press Enter to retry
          </span>
        )}
        {status?.kind === "failed" && (
          <span className="rename-prompt-status">{status.message}</span>
        )}
        <button
          type="button"
          className="rename-prompt-cancel"
          onClick={onClose}
        >
          cancel
        </button>
        <button
          type="button"
          className="rename-prompt-apply"
          disabled={name.trim().length === 0}
          onClick={submit}
        >
          rename
        </button>
      </div>
    </div>
  );
}
