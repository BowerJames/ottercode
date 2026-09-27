/**
 * The coordinate system shared by the language-intelligence contract:
 * a position is a zero-based line plus a zero-based character counted
 * in UTF-16 code units. That is both the LSP wire convention and
 * JavaScript's own string indexing, so nothing in the pipeline
 * converts encodings — "\n" is the only line separator (\r is an
 * ordinary character), matching CodeMirror's normalized documents.
 *
 * All functions clamp out-of-range inputs into the content: positions
 * arriving from a server that saw slightly different text must never
 * throw — they land on the nearest valid offset instead.
 */

export type LangPosition = {
  /** Zero-based line index. */
  line: number;
  /** Zero-based character offset within the line, UTF-16 code units. */
  character: number;
};

export function positionFromOffset(
  content: string,
  offset: number,
): LangPosition {
  const clamped = Math.max(0, Math.min(offset, content.length));
  let line = 0;
  for (let i = 0; i < clamped; i++) {
    if (content.charCodeAt(i) === 10) line++; // "\n"
  }
  const lineStart = content.lastIndexOf("\n", clamped - 1) + 1;
  return { line, character: clamped - lineStart };
}

export function offsetFromPosition(
  content: string,
  position: LangPosition,
): number {
  let lineStart = 0;
  for (let line = 0; line < Math.max(0, position.line); line++) {
    const next = content.indexOf("\n", lineStart);
    if (next === -1) return content.length; // line past the last
    lineStart = next + 1;
  }
  const lineEnd = content.indexOf("\n", lineStart);
  const limit = lineEnd === -1 ? content.length : lineEnd;
  return Math.max(lineStart, Math.min(lineStart + position.character, limit));
}
