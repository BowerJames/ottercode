import { useEffect, useRef } from "react";
import type { TranscriptEntry } from "./store";
import { useAgentChat } from "./use-agent-chat";

/**
 * The transcript rail: the record of the conversation, not the stage.
 * Always visible since the provider picker moved in; the entries area
 * fills as the conversation does, auto-scrolling while streaming.
 */
export function AgentRail() {
  const entries = useAgentChat((s) => s.entries);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies(entries): the entries array is the intentional trigger — auto-scroll on transcript growth.
  useEffect(() => {
    const el = scrollRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [entries]);

  return (
    <aside className="agent-rail">
      <div className="agent-rail-header">
        <span>agent</span>
        <ProviderPicker />
      </div>
      <SwitchError />
      <div className="agent-rail-entries" ref={scrollRef}>
        {entries.map((entry) => (
          <TranscriptRow key={entry.id} entry={entry} />
        ))}
      </div>
    </aside>
  );
}

/** Provider dropdown. Swapping cancels an in-flight turn and clears
 * the conversation (per the swap contract). Failures revert here. */
function ProviderPicker() {
  const provider = useAgentChat((s) => s.provider);
  const available = useAgentChat((s) => s.available);
  const switchProvider = useAgentChat((s) => s.switchProvider);
  const loadProviderInfo = useAgentChat((s) => s.loadProviderInfo);

  useEffect(() => {
    void loadProviderInfo();
  }, [loadProviderInfo]);

  return (
    <select
      className="provider-select"
      value={provider}
      aria-label="agent provider"
      onChange={(e) => void switchProvider(e.target.value)}
    >
      {available.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  );
}

function SwitchError() {
  const switchError = useAgentChat((s) => s.switchError);
  if (switchError === null) return null;
  return <div className="chat-entry chat-error">{switchError}</div>;
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
