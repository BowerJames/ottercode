import type { TerminalSpawner } from "../../../src/main/terminal/terminal-spawner.js";

/**
 * In-memory double for the spawner seam: records what the service
 * asked it to run and lets tests drive the process half — emit
 * chunks, deliver exits, observe kills. Implements exactly the seam
 * contract and nothing more.
 */
export function createFakeSpawner(options: { failSpawn?: boolean } = {}): {
  spawner: TerminalSpawner;
  commands: string[];
  cwds: string[];
  chunks: Array<(chunk: string) => void>;
  exits: Array<(code: number | null) => void>;
  kills: number;
  /** Deliver output to the most recent process. */
  emit(chunk: string): void;
  /** Deliver an exit to the most recent process. */
  exit(code: number | null): void;
} {
  const commands: string[] = [];
  const cwds: string[] = [];
  const chunks: Array<(chunk: string) => void> = [];
  const exits: Array<(code: number | null) => void> = [];
  let kills = 0;

  const spawner: TerminalSpawner = (command, cwd, handlers) => {
    if (options.failSpawn) throw new Error("spawn failed");
    commands.push(command);
    cwds.push(cwd);
    chunks.push(handlers.onData);
    exits.push(handlers.onExit);
    return {
      kill() {
        kills += 1;
      },
    };
  };

  return {
    spawner,
    commands,
    cwds,
    chunks,
    exits,
    get kills() {
      return kills;
    },
    emit(chunk) {
      chunks.at(-1)?.(chunk);
    },
    exit(code) {
      exits.at(-1)?.(code);
    },
  };
}
