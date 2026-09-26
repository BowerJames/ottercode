import { describe, expect, it } from "vitest";
import { createAgentChatStore } from "../../../../src/renderer/features/agent-chat/store";
import {
  AGENT_ABORT_CHANNEL,
  AGENT_EVENTS_CHANNEL,
  AGENT_SUBMIT_CHANNEL,
} from "../../../../src/shared/ipc/channels";
import { createClient } from "../../../../src/shared/ipc/client";
import { createFakeTransport } from "../../fake-transport";

/**
 * Permanent suite. Each test names a consumer in the feature's
 * components: AgentRail renders entries (accumulation, tool rows,
 * error rows, user rows); Composer branches on status and dispatches
 * send/abort; the payload assertion pins createClient's delegation at
 * its first consumer. Deleted at review (unconsumed): the
 * send-while-working guard — the composer already disables both.
 */

function makeStore() {
  const harness = createFakeTransport();
  const store = createAgentChatStore(createClient(harness.transport).agent);
  return { harness, store };
}

describe("createAgentChatStore", () => {
  it("accumulates assistant deltas into one streaming entry and marks working", () => {
    const { harness, store } = makeStore();

    harness.push(AGENT_EVENTS_CHANNEL, { type: "turn-start" });
    harness.push(AGENT_EVENTS_CHANNEL, {
      type: "assistant-delta",
      text: "Hel",
    });
    harness.push(AGENT_EVENTS_CHANNEL, { type: "assistant-delta", text: "lo" });

    const s = store.getState();
    expect(s.entries).toEqual([
      { id: expect.any(Number), kind: "assistant", text: "Hello" },
    ]);
    expect(s.status).toBe("working");
  });

  it("records tool activity and returns to idle at turn-end", () => {
    const { harness, store } = makeStore();

    harness.push(AGENT_EVENTS_CHANNEL, { type: "turn-start" });
    harness.push(AGENT_EVENTS_CHANNEL, {
      type: "tool-start",
      id: "t1",
      name: "edit",
    });
    harness.push(AGENT_EVENTS_CHANNEL, { type: "tool-end", id: "t1" });
    harness.push(AGENT_EVENTS_CHANNEL, { type: "turn-end" });

    const s = store.getState();
    expect(s.entries).toEqual([
      { id: expect.any(Number), kind: "tool", name: "edit" },
    ]);
    expect(s.status).toBe("idle");
  });

  it("error events land as an entry and end the turn", () => {
    const { harness, store } = makeStore();

    harness.push(AGENT_EVENTS_CHANNEL, { type: "turn-start" });
    harness.push(AGENT_EVENTS_CHANNEL, { type: "error", message: "boom" });

    const s = store.getState();
    expect(s.entries).toEqual([
      { id: expect.any(Number), kind: "error", message: "boom" },
    ]);
    expect(s.status).toBe("idle");
  });

  it("send appends the user entry and submits the message", async () => {
    const { harness, store } = makeStore();
    harness.responses.set(AGENT_SUBMIT_CHANNEL, { ok: true });

    await store.getState().send("fix it");

    expect(store.getState().entries).toEqual([
      { id: expect.any(Number), kind: "user", message: "fix it" },
    ]);
    const call = harness.calls.find((c) => c.channel === AGENT_SUBMIT_CHANNEL);
    expect(call?.payload).toEqual({ message: "fix it" });
  });

  it("abort forwards to the client", () => {
    const { harness, store } = makeStore();

    store.getState().abort();

    expect(harness.calls.some((c) => c.channel === AGENT_ABORT_CHANNEL)).toBe(
      true,
    );
  });
});
