import { spawn } from "node:child_process";
import type { SpawnedProcess, TerminalSpawner } from "./terminal-spawner.js";

/**
 * The production adapter for the TerminalSpawner seam: the only place
 * a shell is acquired. Uses the user's shell ($SHELL, falling back to
 * the platform default) non-interactively — stdin is closed, the
 * command runs to completion. Each stream decodes through its own
 * stream-aware TextDecoder so multi-byte characters split across pipe
 * chunks reassemble. Real-boundary code, verified by running the app,
 * not by unit tests.
 */
export const realTerminalSpawner: TerminalSpawner = (
  command,
  cwd,
  handlers,
) => {
  const child = spawn(command, {
    cwd,
    shell: process.env.SHELL ?? true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdoutDecoder = new TextDecoder();
  const stderrDecoder = new TextDecoder();
  child.stdout?.on("data", (data: Buffer) => {
    handlers.onData(stdoutDecoder.decode(data, { stream: true }));
  });
  child.stderr?.on("data", (data: Buffer) => {
    handlers.onData(stderrDecoder.decode(data, { stream: true }));
  });
  let settled = false;
  const settle = (code: number | null): void => {
    if (settled) return;
    settled = true;
    handlers.onExit(code);
  };
  child.once("exit", (code) => settle(code));
  child.once("error", () => settle(null)); // e.g. the shell path is bad
  return {
    kill() {
      child.kill("SIGTERM");
    },
  };
};
