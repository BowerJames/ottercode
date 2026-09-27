import { useState } from "react";
import { useEditor } from "../editor/use-editor";
import { collectEdits, collectMessageEdits } from "./collect-edits";
import { useAgentChat } from "./use-agent-chat";

/**
 * The composer: docked at the bottom of the editor column. Sends the
 * message plus the user's dirty in-editor edits — file edits AND
 * edited assistant-message drafts — when the rail footer's
 * include-edits gate is on (checked here at click time — the
 * composition point: collect-edits is the what-attaches policy,
 * main's compose-prompt is the how-it-renders policy). Disabled while
 * a turn is working; stop aborts.
 *
 * A turn needs a message OR pending attachments: sends go out with an
 * empty message when any will attach — attachments make a valid turn
 * (compose-prompt renders them stand-alone).
 *
 * Enter sends; Shift+Enter inserts a newline. The textarea grows with
 * its content (CSS `field-sizing: content`) up to half the window height,
 * then scrolls internally — the editor pane yields the space.
 */
export function Composer() {
  const status = useAgentChat((s) => s.status);
  const send = useAgentChat((s) => s.send);
  const abort = useAgentChat((s) => s.abort);
  const includeEdits = useAgentChat((s) => s.includeEdits);
  const trackedRuns = useAgentChat((s) => s.trackedRuns);
  // Both attachment kinds count: the gate label says "edits" and the
  // empty-message rule says attachments make a valid turn — file
  // edits and message edits alike.
  const editCount = useEditor(
    (s) =>
      collectEdits(s.workingCopies).length +
      collectMessageEdits(s.virtualDocs).length,
  );
  const [text, setText] = useState("");

  const working = status === "working";
  // The gate mirrors the gather in submit exactly: edits count only
  // while the include-edits gate is on, tracked runs always (they were
  // gated at record time). Gate and gather must never disagree.
  const canSend =
    !working &&
    (text.trim().length > 0 ||
      (includeEdits && editCount > 0) ||
      trackedRuns.length > 0);

  const submit = () => {
    if (!canSend) return;
    const message = text.trim();
    setText("");
    // getState, not render-time snapshots: the gates and the gathers
    // must see state as of this click.
    const edits = useAgentChat.getState().includeEdits
      ? collectEdits(useEditor.getState().workingCopies)
      : [];
    const messageEdits = useAgentChat.getState().includeEdits
      ? collectMessageEdits(useEditor.getState().virtualDocs)
      : [];
    // Tracked runs were gated at record time — unchecking since
    // doesn't un-record them (they ran while checked; they still
    // ride). The buffer drains on the accepted send.
    const terminalRuns = useAgentChat.getState().trackedRuns;
    void send(message, edits, messageEdits, terminalRuns);
  };

  return (
    <div className="composer">
      <textarea
        className="composer-input"
        rows={1}
        value={text}
        placeholder={working ? "agent is working…" : "message the agent"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        disabled={working}
      />
      {working ? (
        <button type="button" className="composer-stop" onClick={() => abort()}>
          stop
        </button>
      ) : (
        <button
          type="button"
          className="composer-send"
          disabled={!canSend}
          onClick={submit}
        >
          send
        </button>
      )}
    </div>
  );
}
