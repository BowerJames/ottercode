import type {
  AgentFileEdit,
  AgentMessageEdit,
} from "../../../shared/ipc/agent";
import type { VirtualDoc, WorkingCopy } from "../editor/store";

/**
 * The renderer half of the attachment seam: WHICH in-editor edits ride
 * along on a turn — two attachment kinds, two collectors, one policy
 * each. HOW attachments become prompt text is the other half of the
 * seam, in main (compose-prompt) — these modules never render.
 *
 * Resending is the contract: every turn re-attaches the full current
 * dirty set, and the prompt frames them as current state, so a repeat
 * send reads the same as a first send. (No "already communicated"
 * baseline — originals stay open-time snapshots and keep feeding the
 * dirty dot.)
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

/**
 * The message-edit twin: WHICH assistant-message drafts ride along.
 * Policy: every dirty draft (content diverged from the assistant's
 * words), both versions carried, key-sorted for a deterministic
 * wire — a draft crosses as title + text, never as its synthetic
 * editor key (that key must not ride `agent:submit`; see
 * VirtualDoc). Snapshots can never qualify: they cannot be dirty.
 */
export function collectMessageEdits(
  virtualDocs: Record<string, VirtualDoc>,
): AgentMessageEdit[] {
  return (
    Object.entries(virtualDocs)
      .filter(([, doc]) => doc.draft && doc.content !== doc.original)
      // Conversation order — the key's trailing entry id — so the
      // prompt lists corrections in the order the messages happened;
      // the key string breaks ties for synthetic keys without one.
      .sort(([a], [b]) => entryOrder(a) - entryOrder(b) || (a < b ? -1 : 1))
      .map(([, doc]) => ({
        title: doc.title,
        original: doc.original,
        edited: doc.content,
      }))
  );
}

/** The trailing integer of a synthetic key (`virtual:chat/7` → 7);
 * 0 when there is none. */
function entryOrder(key: string): number {
  const digits = /(\d+)$/.exec(key);
  return digits === null ? 0 : Number(digits[1]);
}
