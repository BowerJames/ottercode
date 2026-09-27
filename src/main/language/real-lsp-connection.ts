/**
 * The production adapter for the LspConnection seam: the only place a
 * language-server process is acquired. Frames flow through the pure
 * framing module both directions; stdout chunks feed the reader raw
 * (byte-accurate reassembly is its job). Real-boundary code, verified
 * by running the app — not by unit tests.
 */

import { spawn } from "node:child_process";
import type { EngineCommand } from "./language-engine.js";
import type { LspConnectionFactory } from "./lsp-connection.js";
import { frameMessage, LspFrameReader } from "./lsp-framing.js";

export const createStdioConnection: LspConnectionFactory = (
  command: EngineCommand,
  root: string,
) => {
  const child = spawn(command.command, command.args, {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const reader = new LspFrameReader();
  let messageHandler: ((message: unknown) => void) | null = null;
  let closeHandler: (() => void) | null = null;
  let closed = false;

  child.stdout?.on("data", (chunk: Buffer) => {
    for (const message of reader.push(chunk)) {
      messageHandler?.(message);
    }
  });
  child.stderr?.on("data", () => {
    // Server diagnostics noise: ignored by policy — the protocol
    // channel is stdout, and stderr text is not a failure signal.
  });
  const close = (): void => {
    if (closed) return;
    closed = true;
    closeHandler?.();
  };
  child.once("exit", close);
  child.once("error", close); // e.g. the binary vanished: ENOENT

  return {
    send(message) {
      if (!closed && child.stdin?.writable === true) {
        child.stdin.write(frameMessage(message));
      }
    },
    onMessage(handler) {
      messageHandler = handler;
    },
    onClose(handler) {
      closeHandler = handler;
    },
    dispose() {
      closed = true;
      child.kill();
    },
  };
};
