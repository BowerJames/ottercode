import { useState } from "react";
import { useEditor } from "../editor/use-editor";
import { collectEdits } from "./collect-edits";
import { useAgentChat } from "./use-agent-chat";

/**
 * The composer: docked at the bottom of the editor column. Sends the
 * message plus the user's dirty in-editor edits when the rail
 * footer's include-edits gate is on (checked here at click time — the
 * composition point: collect-edits is the what-attaches policy,
 * main's compose-prompt is the how-it-renders policy). Disabled while
 * a turn is working; stop aborts.
 *
 * Enter sends; Shift+Enter inserts a newline. The textarea grows with
 * its content (CSS `field-sizing: content`) up to half the window height,
 * then scrolls internally — the editor pane yields the space.
 */
export function Composer() {
  const status = useAgentChat((s) => s.status);
  const send = useAgentChat((s) => s.send);
  const abort = useAgentChat((s) => s.abort);
  const [text, setText] = useState("");

  const working = status === "working";
  const canSend = !working && text.trim().length > 0;

  const submit = () => {
    if (!canSend) return;
    const message = text.trim();
    setText("");
    // getState, not render-time snapshots: the gate and the gather
    // must see state as of this click.
    const edits = useAgentChat.getState().includeEdits
      ? collectEdits(useEditor.getState().workingCopies)
      : [];
    void send(message, edits);
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
