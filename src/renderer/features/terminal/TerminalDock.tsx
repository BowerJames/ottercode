import { useEffect, useRef, useState } from "react";
import { usePanelSize } from "../../app/use-panel-size";
import { Splitter } from "../../components/Splitter";
import type { TerminalRunView } from "./store";
import { useTerminal } from "./use-terminal";

/**
 * The terminal dock: the bottom band of the editor column, between
 * the editor and the composer. The collapsed strip IS the toggle —
 * opening and closing live here, nowhere else. The dock is
 * deliberately persistent: runs starting or finishing never close
 * it, and its history survives agent turns and new chats (the
 * terminal is a workspace surface, not a conversation one). When
 * open, the dock owns its height: the splitter along its top edge
 * drags it taller (anchored at the bottom — drag up to grow).
 */
export function TerminalDock() {
  const open = useTerminal((s) => s.open);
  const running = useTerminal((s) => s.running);
  const toggle = useTerminal((s) => s.toggle);
  const panel = usePanelSize({
    axis: "y",
    min: 120,
    max: 600,
    initial: 240,
    invert: true, // anchored at the bottom: drag up to grow
  });

  return (
    <section className="terminal-dock">
      {open ? (
        <Splitter
          axis="y"
          title="drag to resize — double-click to reset"
          {...panel.handleProps}
        />
      ) : null}
      <button
        type="button"
        className="terminal-strip"
        aria-expanded={open}
        onClick={toggle}
      >
        <span aria-hidden>{open ? "▾" : "▸"}</span> terminal
        {running ? (
          <span className="terminal-live" aria-hidden>
            ●
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="terminal-body" style={{ height: panel.size }}>
          <TerminalBody />
        </div>
      ) : null}
    </section>
  );
}

/** The expanded body: the run history (auto-scrolling while it
 * grows) above the command line. One command at a time — the input
 * disables while running; stop aborts. */
function TerminalBody() {
  const runs = useTerminal((s) => s.runs);
  const running = useTerminal((s) => s.running);
  const run = useTerminal((s) => s.run);
  const abort = useTerminal((s) => s.abort);
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies(runs): the runs array is the intentional trigger — follow the output as it grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [runs]);

  const submit = () => {
    const command = text.trim();
    if (command.length === 0 || running) return;
    setText("");
    void run(command);
  };

  return (
    <>
      <div className="terminal-output" ref={scrollRef}>
        {runs.map((runView) => (
          <RunRow key={runView.id} run={runView} />
        ))}
      </div>
      <div className="terminal-input-row">
        <span className="terminal-prompt" aria-hidden>
          $
        </span>
        <input
          className="terminal-input"
          value={text}
          placeholder={running ? "running…" : "run a command"}
          disabled={running}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
        {running ? (
          <button
            type="button"
            className="terminal-stop"
            onClick={() => abort()}
          >
            stop
          </button>
        ) : null}
      </div>
    </>
  );
}

/** One run in the history: the command echo, its output, and the
 * exit line — present only when the run speaks (non-zero, signal
 * death, or cancellation). */
function RunRow({ run }: { run: TerminalRunView }) {
  return (
    <div className="terminal-run">
      <div className="terminal-run-command">$ {run.command}</div>
      {run.output.length > 0 ? (
        <pre className="terminal-run-output">{run.output}</pre>
      ) : null}
      {run.exitCode === undefined ? (
        <div className="terminal-run-status">…</div>
      ) : run.cancelled ? (
        <div className="terminal-run-status terminal-failed">(cancelled)</div>
      ) : run.exitCode === null ? (
        <div className="terminal-run-status terminal-failed">(killed)</div>
      ) : run.exitCode !== 0 ? (
        <div className="terminal-run-status terminal-failed">
          (exit {run.exitCode})
        </div>
      ) : null}
    </div>
  );
}
