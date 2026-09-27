import type { TerminalRunResult } from "../../shared/ipc/terminal.js";
import type {
  SpawnedProcess,
  TerminalEventSink,
  TerminalSpawner,
} from "./terminal-spawner.js";

/**
 * Runs one command at a time in the workspace root and brackets each
 * run over the event sink: started … output* … exit. Sanitization is
 * policy here (strip ANSI, drop carriage returns) so the wire never
 * carries escape noise — with a carry buffer, because pipes split
 * ANSI sequences across chunk boundaries and the renderer would
 * otherwise see the halves. The service is deliberately
 * accumulation-free: the renderer owns history; this owns the live
 * process only.
 */
export class TerminalService {
  private readonly root: string;
  private readonly spawner: TerminalSpawner;
  private readonly sink: TerminalEventSink;
  private running: SpawnedProcess | null = null;
  private killing = false;

  constructor(root: string, spawner: TerminalSpawner, sink: TerminalEventSink) {
    this.root = root;
    this.spawner = spawner;
    this.sink = sink;
  }

  /** Accepts a command for execution. The outcome arrives as events
   * — acceptance is not success. Refuses with `busy` while another
   * command runs (emitting nothing: no bracket ever starts). */
  run(command: string): Promise<TerminalRunResult> {
    if (this.running !== null) {
      return Promise.resolve({ ok: false, error: { code: "busy" } });
    }
    this.sink({ type: "started", command });
    const sanitizer = createSanitizer();
    let settled = false;
    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      this.running = null;
      const cancelled = this.killing;
      this.killing = false;
      this.sink({ type: "exit", exitCode: code, cancelled });
    };
    try {
      this.running = this.spawner(command, this.root, {
        onData: (chunk) => {
          const text = sanitizer.push(chunk);
          if (text.length > 0) this.sink({ type: "output", chunk: text });
        },
        onExit: finish,
      });
    } catch {
      // The process never started — still bracket, so consumers are
      // never left waiting on a started that never exits.
      finish(null);
    }
    return Promise.resolve({ ok: true });
  }

  /** Kills the running command (no-op when idle). The exit event
   * reports cancelled: true — WE killed it, as opposed to an external
   * signal death. */
  abort(): void {
    if (this.running === null) return;
    this.killing = true;
    this.running.kill();
  }
}

/** OSC sequences: ESC ] … terminated by BEL, ESC \, or ST. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escape sequences is control-character matching by definition — these bytes ARE the protocol.
const OSC_ANSI = /\u001B\][\s\S]*?(?:\u0007|\u001B\\|\u009C)/g;
/** CSI and friends: ESC/C1, optional intermediates/params, final
 * byte (after ansi-regex — whose final class includes digits, so a
 * sequence ending in a param digit can falsely look complete). */
const CSI_ANSI =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: see OSC_ANSI — the ESC/C1 introducers are the point.
  /[\u001B\u009B][[\]()#;?]*(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]/g;

const stripAnsi = (text: string): string =>
  text.replace(OSC_ANSI, "").replace(CSI_ANSI, "");

/** True iff suffix starts at an ESC and could still GROW into a
 * complete sequence: an OSC still awaiting its terminator, or a CSI
 * whose tail is still params (digits/;/:) with no final byte yet.
 * Judged on the RAW chunk tail, before stripping — after stripping,
 * a partial sequence has already been mangled. */
const possiblyIncomplete = (suffix: string): boolean =>
  // biome-ignore lint/suspicious/noControlCharactersInRegex: see OSC_ANSI — prefix shapes of the same sequences.
  /^\u001B\][\s\S]*$/.test(suffix) ||
  // biome-ignore lint/suspicious/noControlCharactersInRegex: see CSI_ANSI — prefix shapes of the same sequences.
  /^[\u001B\u009B][[\]()#;?]*[\d;:]*$/.test(suffix);

/** Per-run output sanitizer: strips complete ANSI sequences, holds a
 * trailing partial one until a later chunk completes it (a partial
 * still outstanding at run end is dropped — it was never real
 * text), and drops carriage returns. */
function createSanitizer(): { push(chunk: string): string } {
  let carry = "";
  return {
    push(chunk) {
      const raw = carry + chunk;
      carry = "";
      let head = raw;
      const esc = raw.lastIndexOf("\u001B");
      if (esc !== -1 && possiblyIncomplete(raw.slice(esc))) {
        head = raw.slice(0, esc);
        carry = raw.slice(esc);
      }
      return stripAnsi(head).replace(/\r/g, "");
    },
  };
}
