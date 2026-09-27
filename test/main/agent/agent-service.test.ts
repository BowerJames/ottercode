import { describe, expect, it } from "vitest";
import { AgentService } from "../../../src/main/agent/agent-service.js";
import type { AgentEvent } from "../../../src/shared/ipc/agent.js";
import { createFailingProvider, createFakeProvider } from "./fake-provider.js";

/**
 * Permanent suite. Consumers: the agent-chat store's subscription
 * (forwarding), its send/abort actions (the submit/abort chains), and
 * its switchProvider/switchModel/loadProviderInfo actions (the
 * reconfigure/info chains, consumed by the rail's dropdowns).
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
    });

    // The service's obligation is delegation only: SOME string reaches
    // the session. Prompt content is unpinned — each compose-prompt
    // experiment carries its own ephemeral tests, deleted at green.
    expect(result).toEqual({ ok: true });
    expect(pi.sentPrompts).toHaveLength(1);
    expect(typeof pi.sentPrompts[0]).toBe("string");
  });

  it("abort reaches the session", async () => {
    const { pi, service } = await makeService();

    service.abort();

    expect(pi.aborts).toBe(1);
  });

  it("reports the active provider, its options, and the resolved model", async () => {
    const { service } = await makeService();

    const info = await service.getProviderInfo();

    expect(info).toEqual({
      provider: "pi",
      available: ["pi", "claude"],
      model: "fake-default",
      models: [
        { id: "fake-default", label: "Fake Default" },
        { id: "fake-2", label: "Fake Two" },
      ],
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
    await service.submit({ message: "next", edits: [] });

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
});
