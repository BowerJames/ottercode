import type {
  AgentFileEdit,
  AgentSubmitRequest,
} from "../../shared/ipc/agent.js";

/**
 * The prompt-composition seam: turns a submit request (message + the
 * user's edited files) into the prompt string handed to the session.
 * The one place prompt format lives — format experiments rewrite the
 * inside of this module and nothing else moves (wire, client, and
 * service are format-blind).
 *
 * v1 adapter: message first, verbatim; then each edited file as a
 * context-free +/- line diff (LCS) under a path heading. The framing
 * states the load-bearing fact that the edits exist only in the
 * user's editor — disk still has the old content — because the
 * session's read tools hit disk and would otherwise contradict the
 * diffs. Files at or above MAX_DIFF_LINES ship whole (LCS is
 * quadratic). Deterministic: same request, same prompt, byte for
 * byte — a repeat send reads the same as a first send.
 */

/** Policy: files at or above this many lines per side ship whole. */
const MAX_DIFF_LINES = 1000;

export function composePrompt(request: AgentSubmitRequest): string {
  if (request.edits.length === 0) {
    return request.message;
  }
  const sections = [
    request.message,
    "",
    "The user has also edited these files in the editor. These edits exist only in the user's editor — the files on disk still have the old content shown as `-` lines. Treat the `+` lines as the user's current intent:",
  ];
  for (const edit of request.edits) {
    sections.push(...fileSection(edit));
  }
  return sections.join("\n");
}

function fileSection(edit: AgentFileEdit): string[] {
  const original = edit.original.split("\n");
  const edited = edit.edited.split("\n");
  if (original.length > MAX_DIFF_LINES || edited.length > MAX_DIFF_LINES) {
    return [
      "",
      `### ${edit.path}`,
      "(file too large to diff — current editor content follows)",
      "```",
      edit.edited,
      "```",
    ];
  }
  const lines = diffLines(original, edited).map((op) =>
    op.kind === "del" ? `-${op.line}` : `+${op.line}`,
  );
  return ["", `### ${edit.path}`, "```diff", ...lines, "```"];
}

type LineOp = { kind: "del" | "add"; line: string };

/**
 * Longest-common-subsequence diff over lines, emitting pure deletions
 * and additions in order (no context lines — a change script, not a
 * human patch). Implementation detail of the v1 adapter, not policy.
 */
function diffLines(a: string[], b: string[]): LineOp[] {
  const n = a.length;
  const m = b.length;
  const stride = m + 1;
  // table[i * stride + j] = LCS length of a[i..] and b[j..]. Reads go
  // through `at` — indexing is bounds-safe by the loop invariants, but
  // noUncheckedIndexedAccess can't see that (same for a[i]/b[j] casts).
  const table = new Int32Array((n + 1) * stride);
  const at = (i: number, j: number): number => table[i * stride + j] as number;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * stride + j] =
        a[i] === b[j]
          ? at(i + 1, j + 1) + 1
          : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const ops: LineOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const x = a[i] as string;
    const y = b[j] as string;
    if (x === y) {
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      ops.push({ kind: "del", line: x });
      i++;
    } else {
      ops.push({ kind: "add", line: y });
      j++;
    }
  }
  while (i < n) {
    ops.push({ kind: "del", line: a[i] as string });
    i++;
  }
  while (j < m) {
    ops.push({ kind: "add", line: b[j] as string });
    j++;
  }
  return ops;
}
