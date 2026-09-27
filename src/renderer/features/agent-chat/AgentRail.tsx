import { useEffect, useRef } from "react";
import { ComboBox } from "../../components/ComboBox";
import { useEditor } from "../editor/use-editor";
import { collectEdits } from "./collect-edits";
import type { TranscriptEntry } from "./store";
import { useAgentChat } from "./use-agent-chat";

/**
 * The transcript rail: the record of the conversation, not the stage.
 * Always visible since the provider picker moved in; the entries area
 * fills as the conversation does, auto-scrolling while streaming. Its
 * footer hosts the include-edits gate for outgoing messages.
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
        <div className="agent-rail-pickers">
          <ProviderPicker />
          <ModelPicker />
        </div>
      </div>
      <SwitchError />
      <div className="agent-rail-entries" ref={scrollRef}>
        {entries.map((entry) => (
          <TranscriptRow key={entry.id} entry={entry} />
        ))}
      </div>
      <AttachFooter />
    </aside>
  );
}

/** Footer control: gates whether the next message attaches the
 * editor's dirty copies. The label carries the count of what would
 * ride along. Stays usable mid-turn — it only affects the next send. */
function AttachFooter() {
  const includeEdits = useAgentChat((s) => s.includeEdits);
  const setIncludeEdits = useAgentChat((s) => s.setIncludeEdits);
  const editCount = useEditor((s) => collectEdits(s.workingCopies).length);

  return (
    <footer className="agent-rail-footer">
      <label
        className="agent-rail-attach"
        title="attach the editor's unsaved edits to your next message"
      >
        <input
          type="checkbox"
          checked={includeEdits}
          onChange={(e) => setIncludeEdits(e.target.checked)}
        />
        include file edits{editCount > 0 ? ` (${editCount})` : ""}
      </label>
    </footer>
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

/** Model combobox: adapter-enumerated options only (nothing the
 * provider didn't vouch for), filterable because pi lists many. */
function ModelPicker() {
  const model = useAgentChat((s) => s.model);
  const models = useAgentChat((s) => s.models);
  const switchModel = useAgentChat((s) => s.switchModel);

  return (
    <ComboBox
      value={model}
      options={models}
      onChange={(id) => void switchModel(id)}
      ariaLabel="agent model"
      placeholder="model…"
    />
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
