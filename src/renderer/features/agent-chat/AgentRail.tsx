import { useEffect, useRef } from "react";
import type { AgentThinkingLevel } from "../../../shared/ipc/agent";
import { ComboBox } from "../../components/ComboBox";
import { useEditor } from "../editor/use-editor";
import { collectEdits } from "./collect-edits";
import type { TranscriptEntry } from "./store";
import { useAgentChat } from "./use-agent-chat";

/**
 * The transcript rail: the record of the conversation, not the stage.
 * Always visible since the provider picker moved in; the entries area
 * fills as the conversation does, auto-scrolling while streaming. Its
 * footer hosts the include-edits gate and the new-chat button.
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
          <ThinkingPicker />
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

/** Footer controls: the include-edits gate, the track-terminal gate
 * with its pending count and clear escape hatch, and the new-chat
 * action. The labels carry counts of what would ride along. All stay
 * usable mid-turn — the gates only affect the next send; new chat
 * abandons the turn (the swap contract handles cancellation). */
function AttachFooter() {
  const includeEdits = useAgentChat((s) => s.includeEdits);
  const setIncludeEdits = useAgentChat((s) => s.setIncludeEdits);
  const trackTerminal = useAgentChat((s) => s.trackTerminal);
  const setTrackTerminal = useAgentChat((s) => s.setTrackTerminal);
  const trackedRuns = useAgentChat((s) => s.trackedRuns);
  const clearTracked = useAgentChat((s) => s.clearTracked);
  const newChat = useAgentChat((s) => s.newChat);
  const editCount = useEditor((s) => collectEdits(s.workingCopies).length);

  return (
    <footer className="agent-rail-footer">
      <div className="agent-rail-gates">
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
        <div className="agent-rail-gate">
          <label
            className="agent-rail-attach"
            title="send commands run in the terminal while this is checked with your next message"
          >
            <input
              type="checkbox"
              checked={trackTerminal}
              onChange={(e) => setTrackTerminal(e.target.checked)}
            />
            track terminal
            {trackedRuns.length > 0 ? ` (${trackedRuns.length})` : ""}
          </label>
          {trackedRuns.length > 0 ? (
            <button
              type="button"
              className="agent-rail-clear"
              title="discard the tracked terminal runs"
              onClick={() => clearTracked()}
            >
              ×
            </button>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        className="agent-rail-new-chat"
        title="start a fresh conversation (same provider and model)"
        onClick={() => void newChat()}
      >
        new chat
      </button>
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

/** Thinking dropdown: levels the active model offers, changed live —
 * unlike the model, swapping levels never resets the conversation.
 * Hidden (null) when the model offers no meaningful choice. */
function ThinkingPicker() {
  const thinking = useAgentChat((s) => s.thinking);
  const switchThinking = useAgentChat((s) => s.switchThinking);

  if (thinking === null) return null;

  return (
    <select
      className="provider-select thinking-select"
      value={thinking.level}
      aria-label="thinking level"
      title="reasoning effort for the active model (changes take effect immediately)"
      onChange={(e) =>
        void switchThinking(e.target.value as AgentThinkingLevel)
      }
    >
      {thinking.levels.map((level) => (
        <option key={level} value={level}>
          {level}
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
      return (
        <div className="chat-entry chat-user">
          {/* Attachment-only turn: the composer sends edits/tracked runs
              with no message — show a marker, not an empty bubble. */}
          {entry.message.length > 0
            ? entry.message
            : "(no message — attachments sent)"}
        </div>
      );
    case "assistant":
      return <div className="chat-entry chat-assistant">{entry.text}</div>;
    case "tool":
      return <div className="chat-entry chat-tool">tool: {entry.name}</div>;
    case "error":
      return <div className="chat-entry chat-error">{entry.message}</div>;
  }
}
