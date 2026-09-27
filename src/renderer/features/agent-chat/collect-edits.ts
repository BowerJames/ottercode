import type { AgentFileEdit } from "../../../shared/ipc/agent";
import type { WorkingCopy } from "../editor/store";

/**
 * The renderer half of the attachment seam: WHICH working copies ride
 * along on a turn. Policy: every dirty copy (content diverged from
 * disk-at-load), both versions carried, path-sorted for a
 * deterministic wire. HOW edits become prompt text is the other half
 * of the seam, in main (compose-prompt) — this module never renders.
 *
 * Resending is the contract: every turn re-attaches the full current
 * dirty set, and the prompt frames them as current state, so a repeat
 * send reads the same as a first send. (No "already communicated"
 * baseline — WorkingCopy.original stays disk-at-load and keeps
 * feeding the dirty dot.)
 */
export function collectEdits(
  workingCopies: Record<string, WorkingCopy>,
): AgentFileEdit[] {
  return Object.entries(workingCopies)
    .filter(([, copy]) => copy.content !== copy.original)
    .map(([path, copy]) => ({
      path,
      original: copy.original,
      edited: copy.content,
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
