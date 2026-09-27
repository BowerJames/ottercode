import type { TerminalEvent } from "../../shared/ipc/terminal.js";

/**
 * The process seam. Everything the terminal service knows about
 * acquiring a child process is this interface; adapters satisfy it.
 * Two adapters — the real one spawning a shell (real-terminal-
 * spawner) and the in-memory fake (tests) — make this a real seam.
 *
 * Adapter contract:
 * - Runs `command` (a full shell command line) in `cwd` using the
 *   user's shell. stdin is NOT interactive — the command runs to
 *   completion unattended (command-runner semantics, not a PTY).
 * - onData delivers combined stdout+stderr as decoded text, in
 *   delivery order, granularity following the pipes. Chunks may
 *   split ANSI sequences or code points mid-stream — decoding must be
 *   stream-aware.
 * - onExit delivers exactly once: the exit code, or null when the
 *   process died by signal (including after kill()).
 * - kill asks the process to die; onExit still follows.
 * - A synchronous throw means the process never started (no onData,
 *   no onExit).
 */
export type SpawnedProcess = {
  kill(): void;
};

export type TerminalSpawner = (
  command: string,
  cwd: string,
  handlers: {
    onData(chunk: string): void;
    onExit(code: number | null): void;
  },
) => SpawnedProcess;

/** Pushes terminal events out of main: webContents.send in
 * production, a recording fake in tests. */
export type TerminalEventSink = (event: TerminalEvent) => void;
