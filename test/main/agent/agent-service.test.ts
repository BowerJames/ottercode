import { describe, expect, it } from "vitest";
import { AgentService } from "../../../src/main/agent/agent-service.js";
import type { AgentEvent } from "../../../src/shared/ipc/agent.js";
import { createFailingProvider, createFakeProvider } from "./fake-provider.js";

/**
 * Permanent suite. Consumers: the agent-chat store's subscription
 * (forwarding), its send/abort actions (the submit/abort chains), its
 * switchProvider/switchModel/loadProviderInfo actions (the
 * reconfigure/info chains, consumed by the rail's dropdowns), and its
 * newChat action (the fresh-session chain, consumed by the rail's
 * footer button — provider/model preservation is why that action
 * skips the info refetch).
 */

async function makeService() {
  const pi = createFakeProvider();
  const claude = createFakeProvider();
  const events: AgentEvent[] = [];
  const service = await AgentService.create(
    "/ws",
    { pi: pi.provider, claude: claude.provider },
    "pi",
    (event) => {
      events.push(event);
    },
  );
  return { pi, claude, events, service };
}

describe("AgentService", () => {
  it("creates one session for the workspace root and forwards its events to the sink", async () => {
    const { pi, events } = await makeService();

    expect(pi.createdRoots).toEqual(["/ws"]);

    pi.emit({ type: "turn-start" });
    pi.emit({ type: "assistant-delta", text: "hi" });

    expect(events).toEqual([
      { type: "turn-start" },
      { type: "assistant-delta", text: "hi" },
    ]);
  });

  it("submit hands a prompt string to the session and reports acceptance", async () => {
    const { pi, service } = await makeService();

    const result = await service.submit({
      message: "fix the bug",
      edits: [{ path: "/ws/a.ts", original: "old", edited: "new" }],
      messageEdits: [],
      terminalRuns: [],
    });

    // The service's obligation is delegation only: SOME string reaches
    // the session. Prompt content is unpinned — each compose-prompt
    // experiment carries its own ephemeral tests, deleted at green.
    expect(result).toEqual({ ok: true });
    expect(pi.sentPrompts).toHaveLength(1);
    expect(typeof pi.sentPrompts[0]).toBe("string");
  });

  // Consumed by the store's sendSelection action (the editor's
  // SelectionMenu chain): the focused-turn twin of submit above.
  it("submitSelection hands a prompt string to the session and reports acceptance", async () => {
    const { pi, service } = await makeService();

    const result = await service.submitSelection({
      message: "what does this do?",
      selection: { path: "/ws/a.ts", text: "const x = 1;" },
    });

    // Same delegation-only clause: SOME string reaches the session.
    expect(result).toEqual({ ok: true });
    expect(pi.sentPrompts).toHaveLength(1);
    expect(typeof pi.sentPrompts[0]).toBe("string");
  });

  it("abort reaches the session", async () => {
    const { pi, service } = await makeService();

    service.abort();

    expect(pi.aborts).toBe(1);
  });

  it("reports the active provider, its options, the resolved model, and thinking", async () => {
    const { service } = await makeService();

    const info = await service.getProviderInfo();

    expect(info).toEqual({
      provider: "pi",
      available: ["pi", "claude"],
      model: "fake-default",
      models: [
        {
          id: "fake-default",
          label: "Fake Default",
          thinkingLevels: ["off", "low", "medium", "high"],
        },
        { id: "fake-2", label: "Fake Two", thinkingLevels: ["off", "high"] },
        { id: "fake-plain", label: "Fake Plain", thinkingLevels: [] },
      ],
      // fake-default offers a real choice; the session came up at the
      // fake's default ("off")
      thinking: {
        level: "off",
        levels: ["off", "low", "medium", "high"],
      },
    });
  });

  it("setProvider swaps the session: new events forward, old events don't", async () => {
    const { pi, claude, events, service } = await makeService();

    const result = await service.setProvider("claude");

    expect(result).toEqual({ ok: true });
    expect(pi.disposes).toBe(1);

    claude.emit({ type: "assistant-delta", text: "new" });
    pi.emit({ type: "assistant-delta", text: "stale" });

    expect(events).toEqual([{ type: "assistant-delta", text: "new" }]);
    const info = await service.getProviderInfo();
    expect(info.provider).toBe("claude");
  });

  it("setProvider cancels an in-flight turn and routes new submits to the new session", async () => {
    const { pi, claude, service } = await makeService();

    pi.emit({ type: "turn-start" }); // mid-turn swap
    await service.setProvider("claude");
    await service.submit({
      message: "next",
      edits: [],
      messageEdits: [],
      terminalRuns: [],
    });

    expect(pi.sentPrompts).toEqual([]); // old session heard nothing
    expect(claude.sentPrompts).toEqual(["next"]);
  });

  it("a failed switch leaves the old session running and reports unavailable", async () => {
    const pi = createFakeProvider();
    const sinkEvents: AgentEvent[] = [];
    const service = await AgentService.create(
      "/ws",
      { pi: pi.provider, claude: createFailingProvider() },
      "pi",
      (event) => {
        sinkEvents.push(event);
      },
    );

    const result = await service.setProvider("claude");

    expect(result).toEqual({ ok: false, error: { code: "unavailable" } });
    expect(pi.disposes).toBe(0); // old session untouched
    pi.emit({ type: "assistant-delta", text: "still here" });
    expect(sinkEvents).toEqual([
      { type: "assistant-delta", text: "still here" },
    ]);
  });

  // MODEL tests (consumed by the model combobox chain):
  it("setModel swaps the session with the requested model and reports it", async () => {
    const { pi, service } = await makeService();

    const result = await service.setModel("fake-2");

    expect(result).toEqual({ ok: true });
    expect(pi.requestedModels).toEqual([undefined, "fake-2"]);
    expect(pi.disposes).toBe(1);
    expect((await service.getProviderInfo()).model).toBe("fake-2");
  });

  it("an illegitimate model fails the swap and leaves the session running", async () => {
    const pi = createFakeProvider({ rejectModel: "bad-model" });
    const sinkEvents: AgentEvent[] = [];
    const service = await AgentService.create(
      "/ws",
      { pi: pi.provider },
      "pi",
      (event) => {
        sinkEvents.push(event);
      },
    );

    const result = await service.setModel("bad-model");

    expect(result).toEqual({ ok: false, error: { code: "unavailable" } });
    expect(pi.disposes).toBe(0);
    pi.emit({ type: "assistant-delta", text: "unaffected" });
    expect(sinkEvents).toEqual([
      { type: "assistant-delta", text: "unaffected" },
    ]);
  });

  // THINKING tests (consumed by the rail's thinking picker — the
  // store's thinking state and its switchThinking action):
  it("setThinkingLevel changes the live session and reports it — no swap", async () => {
    const { pi, service } = await makeService();

    const result = await service.setThinkingLevel("medium");

    expect(result).toEqual({ ok: true });
    expect(pi.disposes).toBe(0); // LIVE: the session stands
    expect(pi.setLevels).toEqual(["medium"]);
    expect((await service.getProviderInfo()).thinking).toEqual({
      level: "medium",
      levels: ["off", "low", "medium", "high"],
    });
  });

  it("a level the active model doesn't offer is rejected without touching the session", async () => {
    const { pi, service } = await makeService();

    const result = await service.setThinkingLevel("max");

    expect(result).toEqual({ ok: false, error: { code: "unsupported" } });
    expect(pi.setLevels).toEqual([]);
    expect((await service.getProviderInfo()).thinking?.level).toBe("off");
  });

  it("a session without thinking control reports unsupported and hides the picker", async () => {
    const pi = createFakeProvider({ noThinkingControl: true });
    const service = await AgentService.create(
      "/ws",
      { pi: pi.provider },
      "pi",
      () => {},
    );

    const result = await service.setThinkingLevel("medium");
    const info = await service.getProviderInfo();

    expect(result).toEqual({ ok: false, error: { code: "unsupported" } });
    expect(pi.setLevels).toEqual([]);
    // levels exist but the session can't change them — no real choice
    expect(info.thinking).toBeNull();
  });

  it("a model swap carries the thinking level across when the new model offers it", async () => {
    const { pi, service } = await makeService();
    await service.setThinkingLevel("high"); // high is offered by BOTH fakes

    const result = await service.setModel("fake-2");

    expect(result).toEqual({ ok: true });
    // the fresh session came up at "off" (the fake's default); the
    // reconcile set the carried level on it — no extra swap
    expect(pi.setLevels).toEqual(["high", "high"]);
    expect(pi.disposes).toBe(1);
    expect((await service.getProviderInfo()).thinking).toEqual({
      level: "high",
      levels: ["off", "high"],
    });
  });

  it("a model swap drops the thinking level the new model doesn't offer", async () => {
    const { pi, service } = await makeService();
    await service.setThinkingLevel("medium"); // fake-2 offers only off/high

    await service.setModel("fake-2");

    // the fresh session's default stands; nothing was set on it
    expect(pi.setLevels).toEqual(["medium"]);
    expect((await service.getProviderInfo()).thinking).toEqual({
      level: "off",
      levels: ["off", "high"],
    });
  });

  it("a model with no thinking levels hides the picker after a swap", async () => {
    const { service } = await makeService();

    await service.setModel("fake-plain");

    expect((await service.getProviderInfo()).thinking).toBeNull();
  });
  // relies on preservation to skip the info refetch, and on in-band
  // failure reporting for its error branch):
  it("newChat replaces the session preserving the provider and the active model", async () => {
    const { pi, service } = await makeService();
    await service.setModel("fake-2"); // the active model is now fake-2

    const result = await service.newChat();

    expect(result).toEqual({ ok: true });
    // The ACTIVE model rides through — not a default re-resolution
    // (the store's pickers stay valid without a refetch).
    expect(pi.requestedModels).toEqual([undefined, "fake-2", "fake-2"]);
    expect(pi.disposes).toBe(2); // the model swap, then the new chat
    expect(await service.getProviderInfo()).toMatchObject({
      provider: "pi",
      model: "fake-2",
    });
    await service.submit({
      message: "fresh",
      edits: [],
      messageEdits: [],
      terminalRuns: [],
    });
    expect(pi.sentPrompts).toEqual(["fresh"]); // routes to the new session
  });

  it("newChat carries the thinking level across (same model)", async () => {
    const { pi, service } = await makeService();
    await service.setThinkingLevel("high");

    await service.newChat();

    expect(pi.setLevels).toEqual(["high", "high"]); // set, then re-carried
    expect((await service.getProviderInfo()).thinking?.level).toBe("high");
  });

  it("a failed newChat reports unavailable and leaves the session running", async () => {
    // rejectModel fails exactly the SECOND createSession: the initial
    // create passes model: undefined; newChat passes the resolved
    // default ("fake-default").
    const pi = createFakeProvider({ rejectModel: "fake-default" });
    const sinkEvents: AgentEvent[] = [];
    const service = await AgentService.create(
      "/ws",
      { pi: pi.provider },
      "pi",
      (event) => {
        sinkEvents.push(event);
      },
    );

    const result = await service.newChat();

    expect(result).toEqual({ ok: false, error: { code: "unavailable" } });
    expect(pi.disposes).toBe(0);
    pi.emit({ type: "assistant-delta", text: "unaffected" });
    expect(sinkEvents).toEqual([
      { type: "assistant-delta", text: "unaffected" },
    ]);
  });
});
