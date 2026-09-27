import { useEffect, useRef, useState } from "react";
import { useAgentChat } from "../agent-chat/use-agent-chat";
import type { SelectionMenuRequest } from "./selection-request";

/**
 * The send-to-agent surface for one editor selection: a two-phase
 * fixed-position popover at the right-click point. Phase one is the
 * menu (a single item); phase two is the prompt box — type, send.
 * Submitting dispatches the store's focused turn (message + the
 * selection, nothing else attaches).
 *
 * Cross-feature by the established pattern: the chat feature's store
 * hook only (as Composer uses useEditor) — never its internals.
 */
export function SelectionMenu({
  request,
  onClose,
  onRename,
  onGoToDefinition,
}: {
  request: SelectionMenuRequest;
  onClose: () => void;
  /** Offer a symbol rename for this selection (classified files
   * only; absent = no entry — the menu never renames what has no
   * language). */
  onRename?: () => void;
  /** Offer a definition jump (same gating as rename). */
  onGoToDefinition?: () => void;
}) {
  const [phase, setPhase] = useState<"menu" | "prompt">("menu");
  const [text, setText] = useState("");
  const status = useAgentChat((s) => s.status);
  const sendSelection = useAgentChat((s) => s.sendSelection);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Dismiss on outside pointer-down or Escape. mousedown (not click):
  // it fires for every button, so a fresh right-click elsewhere closes
  // this menu before the editor's handler can open its own.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (
        rootRef.current !== null &&
        !rootRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const working = status === "working";
  const submit = () => {
    const message = text.trim();
    if (message.length === 0 || working) return;
    onClose();
    void sendSelection(message, {
      path: request.path,
      text: request.selection,
    });
  };

  // Fixed at the pointer, clamped inside the viewport (phase widths
  // differ; the prompt is the wider one).
  const width = phase === "menu" ? 180 : 300;
  const left = Math.min(request.x, window.innerWidth - width - 8);
  const top = Math.min(request.y, window.innerHeight - 170);

  return (
    <div ref={rootRef} className="selection-menu" style={{ left, top, width }}>
      {phase === "menu" ? (
        <>
          {onGoToDefinition !== undefined && (
            <button
              type="button"
              className="selection-menu-item"
              onClick={() => {
                onClose();
                onGoToDefinition();
              }}
            >
              go to definition
            </button>
          )}
          {onRename !== undefined && (
            <button
              type="button"
              className="selection-menu-item"
              onClick={() => {
                onClose();
                onRename();
              }}
            >
              rename symbol
            </button>
          )}
          {/* Send-to-agent is selection-only: the language menu (empty
            selection) carries no text to fence. */}
          {request.selection.length > 0 && (
            <button
              type="button"
              className="selection-menu-item"
              onClick={() => setPhase("prompt")}
            >
              send to agent
            </button>
          )}
        </>
      ) : (
        <div className="selection-prompt">
          <div className="selection-prompt-context" title={request.selection}>
            {request.path} — {firstLine(request.selection)}
          </div>
          <textarea
            className="selection-prompt-input"
            rows={2}
            value={text}
            placeholder={
              working ? "agent is working…" : "ask about this selection"
            }
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter inserts a newline — same
              // contract as the composer.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            disabled={working}
            // biome-ignore lint/a11y/noAutofocus: the popover's whole purpose is immediate typing — stealing focus on open IS the interaction.
            autoFocus
          />
          <div className="selection-prompt-row">
            <button
              type="button"
              className="selection-prompt-cancel"
              onClick={onClose}
            >
              cancel
            </button>
            <button
              type="button"
              className="selection-prompt-send"
              disabled={working || text.trim().length === 0}
              onClick={submit}
            >
              send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function firstLine(text: string): string {
  const line = text.split("\n")[0] ?? "";
  return line.length > 48 ? `${line.slice(0, 47)}…` : line;
}
