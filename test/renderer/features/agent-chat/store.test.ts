import { describe, expect, it } from "vitest";
import { createAgentChatStore } from "../../../../src/renderer/features/agent-chat/store";
import {
  AGENT_ABORT_CHANNEL,
  AGENT_EVENTS_CHANNEL,
  AGENT_NEW_CHAT_CHANNEL,
  AGENT_PROVIDER_CHANNEL,
  AGENT_SET_MODEL_CHANNEL,
  AGENT_SET_PROVIDER_CHANNEL,
  AGENT_SUBMIT_CHANNEL,
} from "../../../../src/shared/ipc/channels";
import { createClient } from "../../../../src/shared/ipc/client";
import { createFakeTransport } from "../../fake-transport";

/**
 * Permanent suite. Each test names a consumer in the feature's
 * components: AgentRail renders entries (accumulation, tool rows,
 * error rows, user rows) and its footer button dispatches newChat
 * (reset + preserved pickers + rendered failures); Composer branches
 * on status and dispatches send/abort; the payload assertion pins
 * createClient's delegation at its first consumer. Deleted at review
 * (unconsumed): the send-while-working guard — the composer already
 * disables both.
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

  it("send appends the raw user entry and submits message + edits", async () => {
    const { harness, store } = makeStore();
    harness.responses.set(AGENT_SUBMIT_CHANNEL, { ok: true });
    const edits = [{ path: "/ws/a.ts", original: "old", edited: "new" }];

    await store.getState().send("fix it", edits);

    // The rail consumes `message` — it must stay the raw text, never
    // the composed prompt.
    expect(store.getState().entries).toEqual([
      { id: expect.any(Number), kind: "user", message: "fix it" },
    ]);
    const call = harness.calls.find((c) => c.channel === AGENT_SUBMIT_CHANNEL);
    expect(call?.payload).toEqual({ message: "fix it", edits });
  });

  it("abort forwards to the client", () => {
    const { harness, store } = makeStore();

    store.getState().abort();

    expect(harness.calls.some((c) => c.channel === AGENT_ABORT_CHANNEL)).toBe(
      true,
    );
  });

  // Picker tests consumed by the rail: the dropdown renders provider/
  // available and dispatches switchProvider on change:
  it("switchProvider clears the transcript and adopts the new provider", async () => {
    const { harness, store } = makeStore();
    harness.push(AGENT_EVENTS_CHANNEL, { type: "turn-start" });
    harness.push(AGENT_EVENTS_CHANNEL, {
      type: "assistant-delta",
      text: "mid",
    });
    harness.responses.set(AGENT_SET_PROVIDER_CHANNEL, { ok: true });
    harness.responses.set(AGENT_PROVIDER_CHANNEL, {
      provider: "claude",
      available: ["pi", "claude"],
      model: "claude-default",
      models: [{ id: "claude-default", label: "Claude Default" }],
    });

    await store.getState().switchProvider("claude");

    const s = store.getState();
    expect(s.provider).toBe("claude");
    expect(s.entries).toEqual([]);
    expect(s.status).toBe("idle");
    expect(s.model).toBe("claude-default"); // refreshed for the new provider
  });

  it("a failed switch keeps the state and records the error", async () => {
    const { harness, store } = makeStore();
    harness.responses.set(AGENT_PROVIDER_CHANNEL, {
      provider: "pi",
      available: ["pi", "claude"],
    });
    await store.getState().loadProviderInfo();
    harness.responses.set(AGENT_SET_PROVIDER_CHANNEL, {
      ok: false,
      error: { code: "unavailable" },
    });
    harness.push(AGENT_EVENTS_CHANNEL, { type: "turn-start" });

    await store.getState().switchProvider("claude");

    const s = store.getState();
    expect(s.provider).toBe("pi");
    expect(s.status).toBe("working"); // old turn keeps running
    // Error *presence* only: the string is rendered by the rail's
    // SwitchError and nothing computes with it — copy is presentation.
    expect(s.switchError).not.toBeNull();
  });

  it("switchModel clears the transcript and adopts the model", async () => {
    const { harness, store } = makeStore();
    harness.push(AGENT_EVENTS_CHANNEL, { type: "turn-start" });
    harness.responses.set(AGENT_SET_MODEL_CHANNEL, { ok: true });

    await store.getState().switchModel("sonnet");

    const s = store.getState();
    expect(s.model).toBe("sonnet");
    expect(s.entries).toEqual([]);
    expect(s.status).toBe("idle");
  });

  it("loadProviderInfo bootstraps the provider and options", async () => {
    const { harness, store } = makeStore();
    harness.responses.set(AGENT_PROVIDER_CHANNEL, {
      provider: "pi",
      available: ["pi", "claude"],
      model: "pi-default",
      models: [
        { id: "pi-default", label: "PI Default" },
        { id: "pi-2", label: "PI Two" },
      ],
    });

    await store.getState().loadProviderInfo();

    const s = store.getState();
    expect(s.provider).toBe("pi");
    expect(s.available).toEqual(["pi", "claude"]);
    expect(s.model).toBe("pi-default");
    expect(s.models).toEqual([
      { id: "pi-default", label: "PI Default" },
      { id: "pi-2", label: "PI Two" },
    ]);
  });

  // New-chat tests consumed by the rail's footer button: it renders
  // against the reset (entries/status/switchError) and against the
  // pickers, whose values must survive the fresh session.
  it("newChat resets mid-turn, clears a stale switch error, and keeps the pickers' values", async () => {
    const { harness, store } = makeStore();
    harness.responses.set(AGENT_PROVIDER_CHANNEL, {
      provider: "pi",
      available: ["pi", "claude"],
      model: "pi-default",
      models: [{ id: "pi-default", label: "PI Default" }],
    });
    await store.getState().loadProviderInfo();
    harness.responses.set(AGENT_SET_MODEL_CHANNEL, {
      ok: false,
      error: { code: "unavailable" },
    });
    await store.getState().switchModel("pi-2"); // primes switchError
    harness.push(AGENT_EVENTS_CHANNEL, { type: "turn-start" });
    harness.push(AGENT_EVENTS_CHANNEL, {
      type: "assistant-delta",
      text: "mid",
    });
    harness.responses.set(AGENT_NEW_CHAT_CHANNEL, { ok: true });

    await store.getState().newChat();

    const s = store.getState();
    expect(s.entries).toEqual([]);
    expect(s.status).toBe("idle");
    expect(s.switchError).toBeNull(); // the stale failure vanishes
    expect(s.provider).toBe("pi"); // pickers untouched
    expect(s.model).toBe("pi-default");
    // Delegation pinned at the first consumer, same as the send chain.
    expect(
      harness.calls.some((c) => c.channel === AGENT_NEW_CHAT_CHANNEL),
    ).toBe(true);
  });

  it("a failed newChat keeps the state and records the error", async () => {
    const { harness, store } = makeStore();
    harness.responses.set(AGENT_PROVIDER_CHANNEL, {
      provider: "pi",
      available: ["pi", "claude"],
      model: "pi-default",
      models: [],
    });
    await store.getState().loadProviderInfo();
    harness.push(AGENT_EVENTS_CHANNEL, { type: "turn-start" });
    harness.push(AGENT_EVENTS_CHANNEL, {
      type: "assistant-delta",
      text: "mid",
    });
    harness.responses.set(AGENT_NEW_CHAT_CHANNEL, {
      ok: false,
      error: { code: "unavailable" },
    });

    await store.getState().newChat();

    const s = store.getState();
    expect(s.status).toBe("working"); // the turn is genuinely still running
    expect(s.entries).toEqual([
      { id: expect.any(Number), kind: "assistant", text: "mid" },
    ]);
    expect(s.provider).toBe("pi");
    // Error *presence* only: rendered by SwitchError, never computed on.
    expect(s.switchError).not.toBeNull();
  });
});
