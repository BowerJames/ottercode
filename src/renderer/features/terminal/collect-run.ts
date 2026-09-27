import type { AgentTerminalRun } from "../../../shared/ipc/agent";
import { truncateTail } from "../../../shared/terminal/truncate";
import type { TerminalRunView } from "./store";

/**
 * The renderer half of the terminal attachment seam: converts one
 * completed view into the run that rides along on a turn. Policy:
 * the record's output is the view's TAIL under the shared truncation
 * limits — each run truncates individually, so one runaway command
 * can't crowd out the rest. The how-it-renders half lives in main
 * (compose-prompt); this module never renders.
 */
export function collectRun(view: TerminalRunView): AgentTerminalRun {
  const tail = truncateTail(view.output);
  return {
    command: view.command,
    output: tail.content,
    exitCode: view.exitCode ?? null,
    cancelled: view.cancelled,
    truncated: tail.truncated,
  };
}
