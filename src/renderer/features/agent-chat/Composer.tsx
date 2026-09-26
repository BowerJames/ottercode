import { useState } from "react";
import { useAgentChat } from "./use-agent-chat";

/**
 * The composer: docked at the bottom of the editor column. Message-only
 * in v1 — attachment chips (diffs, comments) grow here when the bundle
 * lands. Disabled while a turn is working; stop aborts.
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
    void send(message);
  };

  return (
    <div className="composer">
      <input
        className="composer-input"
        value={text}
        placeholder={working ? "agent is working…" : "message the agent"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
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
