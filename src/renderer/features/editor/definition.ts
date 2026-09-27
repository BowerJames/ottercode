import type { Extension } from "@codemirror/state";
import { EditorSelection } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { languageIdOf } from "../../../shared/lang/languages";
import type { LangPosition } from "../../../shared/lang/position";
import { offsetFromPosition } from "../../../shared/lang/position";
import { useEditor } from "./use-editor";
import { languageIntel } from "./use-language";

/**
 * Go-to-definition, view half: F12 and Cmd/Ctrl+click ask the
 * language service where the symbol lives, then either scroll this
 * surface (same file) or open the target and post a reveal request
 * (cross-file — the mounted surface's effect consumes it).
 *
 * Self-gating by the shared classifier: a path with no language gets
 * no extension, and virtual doc keys classify to null by construction.
 */

/** Scrolls a view to a position and selects the word sitting there. */
export function revealInView(view: EditorView, position: LangPosition): void {
  const offset = offsetFromPosition(view.state.doc.toString(), position);
  // A point, not a range (contract clause): the destination word is
  // selected locally — cursor-only when the point lands between words.
  const range = view.state.wordAt(offset) ?? EditorSelection.cursor(offset);
  view.dispatch({
    selection: range,
    effects: EditorView.scrollIntoView(range.from, { y: "center" }),
  });
}

export async function goToDefinitionAt(
  view: EditorView,
  path: string,
  offset: number,
): Promise<void> {
  const result = await languageIntel.definition(
    path,
    view.state.doc.toString(),
    offset,
  );
  if (!result.ok) return; // degradation is silence
  const { location } = result;
  if (location.path === path) {
    revealInView(view, location.position);
    return;
  }
  // Cross-file: open activates and mounts the target surface first;
  // the reveal request then lands in the freshly mounted effect.
  await useEditor.getState().open(location.path);
  useEditor.getState().revealAt({
    path: location.path,
    position: location.position,
  });
}

export function definitionExtension(path: string): Extension {
  if (languageIdOf(path) === null) return [];
  return [
    keymap.of([
      {
        key: "F12",
        run: (view) => {
          void goToDefinitionAt(view, path, view.state.selection.main.head);
          return true;
        },
      },
    ]),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        // Cmd+click (macOS) / Ctrl+click elsewhere; left button only —
        // Ctrl+click on macOS is the context-menu path, not ours.
        if (event.button !== 0 || (!event.metaKey && !event.ctrlKey)) {
          return false;
        }
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        void goToDefinitionAt(view, path, pos);
        return true;
      },
    }),
  ];
}
