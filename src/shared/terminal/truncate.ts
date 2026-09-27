/**
 * Tail truncation for terminal output — pure policy, no privileges.
 * The numbers are pi's battle-tested defaults (whichever limit hits
 * first wins); keeping the TAIL is the point: the error at the end of
 * a log is usually what matters. Consumed by the renderer when it
 * builds an AgentTerminalRun for the tracked buffer — the panel's
 * display history and the agent's record share this one policy.
 * Policy, not obligation: the limits and mechanics are deliberately
 * unpinned by tests (no source consumer computes on them — the same
 * ruling as the file-tree sort and the prompt format).
 */

/** Policy: at or above this many lines, truncate. */
const TRUNCATE_MAX_LINES = 2000;

/** Policy: at or above this many bytes (UTF-8), truncate. */
const TRUNCATE_MAX_BYTES = 50 * 1024;

export type Tail = {
  /** The kept tail (the whole output when untruncated). */
  content: string;
  /** True iff content is a strict tail of the full output. */
  truncated: boolean;
};

/**
 * Keeps the longest tail that fits both limits. Deterministic; a
 * pass-through when the output fits (content === output, byte for
 * byte).
 */
export function truncateTail(output: string): Tail {
  const bytes = byteLength(output);
  const lines = countLines(output);
  if (bytes <= TRUNCATE_MAX_BYTES && lines <= TRUNCATE_MAX_LINES) {
    return { content: output, truncated: false };
  }
  let tail = sliceTailBytes(output, TRUNCATE_MAX_BYTES);
  let tailLines = countLines(tail);
  if (tailLines > TRUNCATE_MAX_LINES) {
    const parts = tail.split("\n");
    tail = parts.slice(parts.length - TRUNCATE_MAX_LINES).join("\n");
    tailLines = TRUNCATE_MAX_LINES;
  }
  return { content: tail, truncated: tail !== output };
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) count++;
  }
  // A trailing newline ends the last line rather than starting one.
  return text.endsWith("\n") ? count - 1 : count;
}

/** UTF-8 byte length without Node's Buffer — shared code runs in any
 * JS environment (Node main and the browser renderer alike). Pure
 * character walk; surrogate pairs count once as one code point. */
function byteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if ((code & 0xfc00) === 0xd800) {
      bytes += 4; // the pair as one code point
      i++; // skip the low surrogate
    } else bytes += 3;
  }
  return bytes;
}

/** Tail by UTF-8 bytes without splitting a surrogate pair or rune. */
function sliceTailBytes(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) return text;
  // Character-wise walk from the end accumulating bytes — outputs here
  // are megabytes at worst, never gigabytes; clarity beats cleverness.
  let bytes = 0;
  let end = text.length;
  while (end > 0) {
    // Step back over a complete code point (surrogate-aware).
    let start = end - 1;
    while (start > 0 && (text.charCodeAt(start) & 0xfc00) === 0xdc00) {
      start--;
    }
    const cp = text.codePointAt(start);
    if (cp === undefined) break;
    bytes += utf8Len(cp);
    if (bytes > maxBytes) break;
    end = start;
  }
  return text.slice(end);
}

function utf8Len(cp: number): number {
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  if (cp < 0x10000) return 3;
  return 4;
}
