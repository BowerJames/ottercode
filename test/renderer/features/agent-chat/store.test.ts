import { describe, expect, it } from "vitest";
import { createAgentChatStore } from "../../../../src/renderer/features/agent-chat/store";
import {
  AGENT_ABORT_CHANNEL,
  AGENT_EVENTS_CHANNEL,
  AGENT_NEW_CHAT_CHANNEL,
  AGENT_PROVIDER_CHANNEL,
  AGENT_SET_MODEL_CHANNEL,
  AGENT_SET_PROVIDER_CHANNEL,
  AGENT_SET_THINKING_CHANNEL,
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

  it("send appends the raw user entry and submits message + edits + terminal runs", async () => {
    const { harness, store } = makeStore();
    harness.responses.set(AGENT_SUBMIT_CHANNEL, { ok: true });
    const edits = [{ path: "/ws/a.ts", original: "old", edited: "new" }];
    const runs = [
      {
        command: "npm test",
        output: "ok\n",
        exitCode: 0,
        cancelled: false,
        truncated: false,
      },
    ];

    await store.getState().send("fix it", edits, runs);

    // The rail consumes `message` — it must stay the raw text, never
    // the composed prompt.
    expect(store.getState().entries).toEqual([
      { id: expect.any(Number), kind: "user", message: "fix it" },
    ]);
    const call = harness.calls.find((c) => c.channel === AGENT_SUBMIT_CHANNEL);
    expect(call?.payload).toEqual({
      message: "fix it",
      edits,
      terminalRuns: runs,
    });
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

  it("switchModel clears the transcript, adopts the model, and refreshes thinking", async () => {
    const { harness, store } = makeStore();
    harness.push(AGENT_EVENTS_CHANNEL, { type: "turn-start" });
    harness.responses.set(AGENT_SET_MODEL_CHANNEL, { ok: true });
    harness.responses.set(AGENT_PROVIDER_CHANNEL, {
      provider: "pi",
      available: ["pi", "claude"],
      model: "sonnet",
      models: [],
      thinking: { level: "off", levels: ["off", "high"] },
    });

    await store.getState().switchModel("sonnet");

    const s = store.getState();
    expect(s.model).toBe("sonnet");
    expect(s.entries).toEqual([]);
    expect(s.status).toBe("idle");
    // the picker's choices follow the active model — never stale
    expect(s.thinking).toEqual({ level: "off", levels: ["off", "high"] });
  });

  // TRACK-TERMINAL tests (consumed by the rail footer's checkbox and
  // count, its clear button, and the Composer's gather at click time):
  it("recordRun appends only while track terminal is checked", () => {
    const { store } = makeStore();
    const run = {
      command: "npm test",
      output: "ok",
      exitCode: 0,
      cancelled: false,
      truncated: false,
    };

    store.getState().recordRun(run); // gate off — not recorded
    store.getState().setTrackTerminal(true);
    store.getState().recordRun(run); // gate on — recorded

    expect(store.getState().trackedRuns).toEqual([run]);
  });

  it("an accepted send drains the tracked buffer — runs are events, told once", async () => {
    const { harness, store } = makeStore();
    harness.responses.set(AGENT_SUBMIT_CHANNEL, { ok: true });
    const run = {
      command: "npm test",
      output: "ok",
      exitCode: 0,
      cancelled: false,
      truncated: false,
    };
    store.getState().setTrackTerminal(true);
    store.getState().recordRun(run);

    await store.getState().send("fix it", [], [run]);

    expect(store.getState().trackedRuns).toEqual([]); // drained on ok
  });

  it("a failed send keeps the tracked buffer — the runs were never told", async () => {
    const { harness, store } = makeStore();
    harness.responses.set(AGENT_SUBMIT_CHANNEL, {
      ok: false,
      error: { code: "unavailable" },
    });
    const run = {
      command: "npm test",
      output: "ok",
      exitCode: 0,
      cancelled: false,
      truncated: false,
    };
    store.getState().setTrackTerminal(true);
    store.getState().recordRun(run);

    await store.getState().send("fix it", [], [run]);

    expect(store.getState().trackedRuns).toEqual([run]); // still queued
  });

  it("the footer's clear empties the buffer without touching the gate", () => {
    const { store } = makeStore();
    const run = {
      command: "npm test",
      output: "ok",
      exitCode: 0,
      cancelled: false,
      truncated: false,
    };
    store.getState().setTrackTerminal(true);
    store.getState().recordRun(run);

    store.getState().clearTracked();

    expect(store.getState().trackedRuns).toEqual([]);
    expect(store.getState().trackTerminal).toBe(true); // gate stands
  });

  // THINKING tests consumed by the rail's picker: it renders level +
  // levels and dispatches switchThinking on change; the no-reset
  // clause is why the picker is safe to use mid-turn:
  it("switchThinking adopts the level live — the transcript and turn stand", async () => {
    const { harness, store } = makeStore();
    harness.push(AGENT_EVENTS_CHANNEL, { type: "turn-start" });
    harness.push(AGENT_EVENTS_CHANNEL, {
      type: "assistant-delta",
      text: "mid",
    });
    harness.responses.set(AGENT_PROVIDER_CHANNEL, {
      provider: "pi",
      available: ["pi"],
      model: "pi-default",
      models: [],
      thinking: { level: "medium", levels: ["off", "medium", "high"] },
    });
    await store.getState().loadProviderInfo();
    harness.responses.set(AGENT_SET_THINKING_CHANNEL, { ok: true });

    await store.getState().switchThinking("high");

    const s = store.getState();
    expect(s.thinking?.level).toBe("high");
    expect(s.status).toBe("working"); // the turn keeps running
    expect(s.entries).toEqual([
      { id: expect.any(Number), kind: "assistant", text: "mid" },
    ]); // no reset — unlike the swaps
    const call = harness.calls.find(
      (c) => c.channel === AGENT_SET_THINKING_CHANNEL,
    );
    // Delegation pinned at the first consumer, same as the send chain.
    expect(call?.payload).toEqual({ level: "high" });
  });

  it("a failed switchThinking keeps the level and records the error", async () => {
    const { harness, store } = makeStore();
    harness.responses.set(AGENT_PROVIDER_CHANNEL, {
      provider: "pi",
      available: ["pi"],
      model: "pi-default",
      models: [],
      thinking: { level: "medium", levels: ["off", "medium", "high"] },
    });
    await store.getState().loadProviderInfo();
    harness.responses.set(AGENT_SET_THINKING_CHANNEL, {
      ok: false,
      error: { code: "unsupported" },
    });

    await store.getState().switchThinking("max");

    const s = store.getState();
    expect(s.thinking?.level).toBe("medium"); // the picker reverts
    expect(s.switchError).not.toBeNull();
  });

  it("loadProviderInfo bootstraps the provider, options, and thinking", async () => {
    const { harness, store } = makeStore();
    harness.responses.set(AGENT_PROVIDER_CHANNEL, {
      provider: "pi",
      available: ["pi", "claude"],
      model: "pi-default",
      models: [
        { id: "pi-default", label: "PI Default", thinkingLevels: [] },
        { id: "pi-2", label: "PI Two", thinkingLevels: [] },
      ],
      thinking: { level: "medium", levels: ["off", "medium", "high"] },
    });

    await store.getState().loadProviderInfo();

    const s = store.getState();
    expect(s.provider).toBe("pi");
    expect(s.available).toEqual(["pi", "claude"]);
    expect(s.model).toBe("pi-default");
    expect(s.models).toEqual([
      { id: "pi-default", label: "PI Default", thinkingLevels: [] },
      { id: "pi-2", label: "PI Two", thinkingLevels: [] },
    ]);
    expect(s.thinking).toEqual({
      level: "medium",
      levels: ["off", "medium", "high"],
    });
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
