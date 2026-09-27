/**
 * The renderer half of the selection-menu seam: WHETHER a right-click
 * opens the send-to-agent menu, and WHAT it carries. Policy: only a
 * selection that yields text opens the menu (an empty selection falls
 * through to native behavior); the request carries the file path, the
 * selected text verbatim, and the pointer position for the
 * fixed-position menu. DOM and CodeMirror stay outside — the caller
 * passes the range it read; this module never renders and never
 * touches the view (the same split as agent-chat's collect-edits).
 */

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
  selection: string;
  x: number;
  y: number;
};

export function selectionMenuRequest(
  path: string,
  range: SelectionRange,
  selectedText: string,
  position: { x: number; y: number },
): SelectionMenuRequest | null {
  if (range.empty || selectedText.length === 0) return null;
  return {
    path,
    selection: selectedText,
    x: position.x,
    y: position.y,
  };
}
