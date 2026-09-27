import { describe, expect, it } from "vitest";
import { collectRun } from "../../../../src/renderer/features/terminal/collect-run";
import type { TerminalRunView } from "../../../../src/renderer/features/terminal/store";

/**
 * Permanent suite, narrowly. Consumer: compose-prompt's branches —
 * `(no output)` reads output.length, the exit line reads exitCode,
 * the cancelled line reads cancelled — over the record this function
 * builds for the submit wire. A malformed record makes those source
 * branches render garbage (e.g. "Command exited with code
 * undefined"), which is what these tests prevent.
 *
 * Deliberately NOT pinned: the truncation policy itself (which tail,
 * which limits) — like prompt format and the file-tree sort, it is
 * policy with no source consumer computing on it; its tests were
 * ephemeral and are gone.
 */

function view(overrides: Partial<TerminalRunView> = {}): TerminalRunView {
  return {
    id: 1,
    command: "npm test",
    output: "ok\n",
    exitCode: 0,
    cancelled: false,
    ...overrides,
  };
}

describe("collectRun", () => {
  it("maps a view onto the wire record's fields", () => {
    expect(collectRun(view())).toEqual({
      command: "npm test",
      output: "ok\n",
      exitCode: 0,
      cancelled: false,
      truncated: false,
    });
  });

  it("normalizes a still-running view (no exit yet) to a null exit", () => {
    // composePrompt's exit branch would render "code undefined" —
    // null is the contract's "died by signal / unknown" value.
    const record = collectRun(view({ exitCode: undefined }));

    expect(record.exitCode).toBeNull();
  });
});
