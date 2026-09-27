import type {
  AgentFileEdit,
  AgentMessageEdit,
  AgentSelection,
  AgentSelectionSubmitRequest,
  AgentSubmitRequest,
  AgentTerminalRun,
} from "../../shared/ipc/agent.js";

/**
 * The prompt-composition seam: turns a submit request (message + the
 * user's edited files + the user's terminal runs) into the prompt
 * string handed to the session. The one place prompt format lives —
 * format experiments rewrite the inside of this module and nothing
 * else moves (wire, client, and service are format-blind).
 *
 * Two entry points, one per turn kind on the wire: composePrompt for
 * composer turns (below) and composeSelectionPrompt for focused
 * turns (message + one selection, never attachments — the request
 * type has no fields for them, so this function is total over its
 * input with no dead branches).
 *
 * v1 adapter: message first, verbatim — or absent entirely, when the
 * turn rides on attachments alone (the framings below then stand
 * without one and never reference a message that isn't there); then
 * terminal runs pi-style
 * (Ran `cmd` + fenced output + exit annotations) under a framing
 * that marks them as USER-initiated — load-bearing here because we
 * inline runs into one prompt where pi injects them as separate
 * user messages, and without the framing a model could mistake them
 * for its own tool calls; then each edited file as a context-free
 * +/- line diff (LCS) under a path heading. The edits framing
 * states the load-bearing fact that the edits exist only in the
 * user's editor — disk still has the old content — because the
 * session's read tools hit disk and would otherwise contradict the
 * diffs; last, each edited assistant message as the same +/- diff
 * under its title, framed as the user's corrections to the model's
 * own past words. Files at or above MAX_DIFF_LINES ship whole (LCS
 * is quadratic). Deterministic: same request, same prompt, byte for
 * byte — a repeat send reads the same as a first send.
 */

/** Policy: files at or above this many lines per side ship whole. */
const MAX_DIFF_LINES = 1000;

export function composePrompt(request: AgentSubmitRequest): string {
  const sections: string[] = [];
  if (request.message.length > 0) {
    sections.push(request.message);
  }
  if (request.terminalRuns.length > 0) {
    if (sections.length > 0) {
      sections.push("");
    }
    const intro =
      request.message.length > 0
        ? "Before sending this message, the user ran these commands in the editor's terminal."
        : "The user ran these commands in the editor's terminal.";
    sections.push(
      `${intro} The user ran them directly — they are not your tool calls:`,
    );
    for (const run of request.terminalRuns) {
      sections.push(...runSection(run));
    }
  }
  if (request.edits.length > 0) {
    if (sections.length > 0) {
      sections.push("");
    }
    sections.push(
      "The user has edited these files in the editor. These edits exist only in the user's editor — the files on disk still have the old content shown as `-` lines. Treat the `+` lines as the user's current intent:",
    );
    for (const edit of request.edits) {
      sections.push(...fileSection(edit));
    }
  }
  if (request.messageEdits.length > 0) {
    if (sections.length > 0) {
      sections.push("");
    }
    sections.push(
      "The user has edited some of your earlier messages in the editor. The `-` lines are what you wrote; the `+` lines are the user's corrections. Treat the `+` lines as the user's current intent:",
    );
    for (const edit of request.messageEdits) {
      sections.push(...messageSection(edit));
    }
  }
  return sections.join("\n");
}

/**
 * The focused-turn entry point: message (verbatim, first — or absent
 * entirely when the turn rides on the selection alone) plus the
 * selection as path + fenced text. The framing states the same
 * load-bearing fact as the edits framing: the text comes from the
 * user's editor buffer, which may be ahead of disk — the session's
 * read tools hit disk and would otherwise contradict it.
 */
export function composeSelectionPrompt(
  request: AgentSelectionSubmitRequest,
): string {
  const sections: string[] = [];
  if (request.message.length > 0) {
    sections.push(request.message);
  }
  sections.push(...selectionSection(request.selection));
  return sections.join("\n");
}

function selectionSection(selection: AgentSelection): string[] {
  return [
    "",
    `The user selected this text in \`${selection.path}\` in the editor and is asking about it. It may reflect unsaved edits — the file on disk can differ:`,
    "```",
    selection.text,
    "```",
  ];
}

/** One terminal run, pi's phrasing: the command, its output fenced,
 * and the exit facts that change how it reads. Provider-neutral
 * wording — this text is what the model sees. */
function runSection(run: AgentTerminalRun): string[] {
  const section = ["", `Ran \`${run.command}\``];
  if (run.output.length > 0) {
    section.push("```", run.output, "```");
  } else {
    section.push("(no output)");
  }
  if (run.cancelled) {
    section.push("", "(command cancelled)");
  } else if (run.exitCode !== null && run.exitCode !== 0) {
    section.push("", `Command exited with code ${run.exitCode}`);
  }
  if (run.truncated) {
    section.push("", "(output truncated — the tail is shown)");
  }
  return section;
}

function fileSection(edit: AgentFileEdit): string[] {
  return ["", `### ${edit.path}`, ...diffBlock(edit.original, edit.edited)];
}

/** One edited assistant message: its rail title as the heading, the
 * same diff block a file gets. */
function messageSection(edit: AgentMessageEdit): string[] {
  return ["", `### ${edit.title}`, ...diffBlock(edit.original, edit.edited)];
}

/** A +/- line diff under a fenced ```diff block — or the current
 * content whole, past MAX_DIFF_LINES (LCS is quadratic). */
function diffBlock(original: string, edited: string): string[] {
  const originalLines = original.split("\n");
  const editedLines = edited.split("\n");
  if (
    originalLines.length > MAX_DIFF_LINES ||
    editedLines.length > MAX_DIFF_LINES
  ) {
    return [
      "(too large to diff — current editor content follows)",
      "```",
      edited,
      "```",
    ];
  }
  const lines = diffLines(originalLines, editedLines).map((op) =>
    op.kind === "del" ? `-${op.line}` : `+${op.line}`,
  );
  return ["```diff", ...lines, "```"];
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
