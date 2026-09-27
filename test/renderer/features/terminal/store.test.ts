import { describe, expect, it } from "vitest";
import { createTerminalStore } from "../../../../src/renderer/features/terminal/store";
import { TERMINAL_EVENTS_CHANNEL } from "../../../../src/shared/ipc/channels";
import { createClient } from "../../../../src/shared/ipc/client";
import { createFakeTransport } from "../../fake-transport";

/**
 * Permanent suite. Consumers: TerminalDock renders runs/running/open
 * (the panel's views are built from the pushed events — single
 * source), and the use-agent-chat wiring consumes completed views to
 * drive recordRun. The payload assertions pin the run/abort
 * delegation at their first consumer.
 */
function makeStore() {
  const harness = createFakeTransport();
  const store = createTerminalStore(createClient(harness.transport).terminal);
  return { harness, store };
}

describe("createTerminalStore", () => {
  it("starts closed and idle with no runs", () => {
    const { store } = makeStore();

    const s = store.getState();
    expect(s.open).toBe(false);
    expect(s.running).toBe(false);
    expect(s.runs).toEqual([]);
  });

  it("builds one view per run from the event bracket", () => {
    const { harness, store } = makeStore();

    harness.push(TERMINAL_EVENTS_CHANNEL, {
      type: "started",
      command: "npm test",
    });
    harness.push(TERMINAL_EVENTS_CHANNEL, { type: "output", chunk: "ok" });
    harness.push(TERMINAL_EVENTS_CHANNEL, { type: "output", chunk: "\n" });
    harness.push(TERMINAL_EVENTS_CHANNEL, {
      type: "exit",
      exitCode: 0,
      cancelled: false,
    });

    const s = store.getState();
    expect(s.runs).toEqual([
      {
        id: expect.any(Number),
        command: "npm test",
        output: "ok\n",
        exitCode: 0,
        cancelled: false,
      },
    ]);
    expect(s.running).toBe(false); // exit closes the run
  });

  it("marks running between started and exit", () => {
    const { harness, store } = makeStore();

    harness.push(TERMINAL_EVENTS_CHANNEL, {
      type: "started",
      command: "watch",
    });

    expect(store.getState().running).toBe(true);
    expect(store.getState().runs[0]?.exitCode).toBeUndefined();
  });

  it("records cancelled runs as completed views", () => {
    const { harness, store } = makeStore();

    harness.push(TERMINAL_EVENTS_CHANNEL, {
      type: "started",
      command: "watch",
    });
    harness.push(TERMINAL_EVENTS_CHANNEL, {
      type: "exit",
      exitCode: null,
      cancelled: true,
    });

    const run = store.getState().runs[0];
    expect(run).toMatchObject({ exitCode: null, cancelled: true });
    expect(store.getState().running).toBe(false);
  });

  it("toggle flips the dock open state — the persistence rule", () => {
    const { store } = makeStore();

    store.getState().toggle();
    expect(store.getState().open).toBe(true);
    store.getState().toggle();
    expect(store.getState().open).toBe(false);
  });

  it("run delegates the command over the wire; a busy refusal changes nothing", async () => {
    const { harness, store } = makeStore();
    harness.responses.set("terminal:run", {
      ok: false,
      error: { code: "busy" },
    });

    await store.getState().run("npm test");

    const call = harness.calls.find((c) => c.channel === "terminal:run");
    expect(call?.payload).toEqual({ command: "npm test" });
    expect(store.getState().runs).toEqual([]); // nothing started locally
  });

  it("abort delegates", () => {
    const { harness, store } = makeStore();

    store.getState().abort();

    expect(harness.calls.some((c) => c.channel === "terminal:abort")).toBe(
      true,
    );
  });
});
