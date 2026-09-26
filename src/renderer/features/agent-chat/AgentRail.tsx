import { useEffect, useRef } from "react";
import type { TranscriptEntry } from "./store";
import { useAgentChat } from "./use-agent-chat";

/**
 * The transcript rail: the record of the conversation, not the stage.
 * Absent until the first entry exists; auto-scrolls while streaming.
 */
export function AgentRail() {
  const entries = useAgentChat((s) => s.entries);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies(entries): the entries array is the intentional trigger — auto-scroll on transcript growth.
  useEffect(() => {
    const el = scrollRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [entries]);

  if (entries.length === 0) return null;

  return (
    <aside className="agent-rail">
      <div className="agent-rail-header">agent</div>
      <div className="agent-rail-entries" ref={scrollRef}>
        {entries.map((entry) => (
          <TranscriptRow key={entry.id} entry={entry} />
        ))}
      </div>
    </aside>
  );
}

function TranscriptRow({ entry }: { entry: TranscriptEntry }) {
  switch (entry.kind) {
    case "user":
      return <div className="chat-entry chat-user">{entry.message}</div>;
    case "assistant":
      return <div className="chat-entry chat-assistant">{entry.text}</div>;
    case "tool":
      return <div className="chat-entry chat-tool">tool: {entry.name}</div>;
    case "error":
      return <div className="chat-entry chat-error">{entry.message}</div>;
  }
}
