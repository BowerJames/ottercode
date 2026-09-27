/**
 * The terminal domain of the IPC contract: the run channel
 * (renderer -> main) and the event stream (main -> renderer push).
 * Payloads are contract-owned — sanitized text and exit facts, never
 * process handles or raw Buffer chunks.
 */

/** Request for TERMINAL_RUN_CHANNEL. */
export type TerminalRunRequest = {
  /** The shell command line, verbatim. */
  command: string;
};

/**
 * Response for TERMINAL_RUN_CHANNEL. Fire-and-forget semantics like
 * agent:submit — the run's outcome arrives as events on
 * TERMINAL_EVENTS_CHANNEL. `busy` is the one refusal: one command at
 * a time. Spawn failures are not a response — they surface as an exit
 * event (exitCode null, cancelled false), keeping the bracket rule
 * below unbroken.
 */
export type TerminalRunResult =
  | { ok: true }
  | { ok: false; error: { code: "busy" } };

/**
 * One event in the terminal's stream. Clauses:
 * - every run is bracketed: started … output* … exit. Exactly one run
 *   at a time; `busy` refusals emit nothing.
 * - output chunks are sanitized text (ANSI stripped, carriage returns
 *   dropped), append-only, in delivery order. Granularity follows the
 *   process's pipe — no coalescing promise.
 * - exitCode null means the process died by signal (including our
 *   abort); cancelled is true iff WE killed it.
 * - a run's events never interleave with another's.
 */
export type TerminalEvent =
  | { type: "started"; command: string }
  | { type: "output"; chunk: string }
  | { type: "exit"; exitCode: number | null; cancelled: boolean };
