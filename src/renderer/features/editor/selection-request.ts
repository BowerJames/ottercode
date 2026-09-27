/**
 * The renderer half of the selection-menu seam: WHETHER a right-click
 * opens the context menu, and WHAT it carries. Two doors in:
 *
 * - A selection that yields text opens the full menu (send to agent
 *   plus the language items when the file has a language).
 * - An EMPTY selection still opens — for classified files only — as
 *   the language menu: go-to-definition and rename aimed at the word
 *   under the pointer. Unclassified files fall through to native
 *   behavior, exactly as before.
 *
 * The request carries the file path, the selected text verbatim ("" -
 * when none), the pointer position for the fixed-position menu, and
 * `symbolOffset` — where language operations aim: the clicked
 * position with no selection, the selection's end with one. DOM and
 * CodeMirror stay outside — the caller passes what it read; this
 * module never renders and never touches the view (the same split as
 * agent-chat's collect-edits).
 */

import { languageIdOf } from "../../../shared/lang/languages";

/** The subset of CodeMirror's SelectionRange the decision needs. */
export type SelectionRange = {
  from: number;
  to: number;
  /** True iff nothing is selected. */
  empty: boolean;
};

/** The menu request: what gets sent, and where the menu appears
 * (viewport coordinates — the menu is position: fixed). */
export type SelectionMenuRequest = {
  path: string;
  /** The selected text, verbatim; empty when the menu is the
   * language-only variant (no selection). */
  selection: string;
  x: number;
  y: number;
  /** Where language operations (definition, rename) aim: the click
   * point when nothing is selected, else the selection's end. */
  symbolOffset: number;
};

export function selectionMenuRequest(
  path: string,
  range: SelectionRange,
  selectedText: string,
  position: { x: number; y: number },
  clickOffset: number,
): SelectionMenuRequest | null {
  if (range.empty || selectedText.length === 0) {
    // The language menu's door: an empty selection still opens for
    // classified files, aimed at the clicked word.
    if (
      selectedText.length === 0 &&
      range.empty &&
      languageIdOf(path) !== null
    ) {
      return {
        path,
        selection: "",
        x: position.x,
        y: position.y,
        symbolOffset: clickOffset,
      };
    }
    return null;
  }
  return {
    path,
    selection: selectedText,
    x: position.x,
    y: position.y,
    symbolOffset: range.to,
  };
}
