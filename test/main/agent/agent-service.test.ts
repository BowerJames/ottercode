import { describe, expect, it } from "vitest";
import { AgentService } from "../../../src/main/agent/agent-service.js";
import type { AgentEvent } from "../../../src/shared/ipc/agent.js";
import { createFailingProvider, createFakeProvider } from "./fake-provider.js";

/**
 * Permanent suite. Consumers: the agent-chat store's subscription
 * (forwarding), its send/abort actions (the submit/abort chains), and
 * its switchProvider/loadProviderInfo actions (the swap/info chains,
 * consumed by the rail's provider dropdown).
 */

async function makeService(overrides: Record<string, unknown> = {}) {
  const pi = createFakeProvider();
  const claude = createFakeProvider();
  const events: AgentEvent[] = [];
  const providers = { pi: pi.provider, claude: claude.provider, ...overrides };
  const service = await AgentService.create("/ws", providers, "pi", (event) => {
    events.push(event);
  });
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

  it("submit passes the message to the session and reports acceptance", async () => {
    const { pi, service } = await makeService();

    const result = await service.submit({ message: "fix the bug" });

    expect(result).toEqual({ ok: true });
    expect(pi.sentPrompts).toEqual(["fix the bug"]);
  });

  it("abort reaches the session", async () => {
    const { pi, service } = await makeService();

    service.abort();

    expect(pi.aborts).toBe(1);
  });

  // SWAP — ephemeral until the picker consumes the chain:
  it("reports the active provider and the registered options", async () => {
    const { service } = await makeService();

    expect(service.getProvider()).toEqual({
      provider: "pi",
      available: ["pi", "claude"],
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
    expect(service.getProvider().provider).toBe("claude");
  });

  it("setProvider cancels an in-flight turn and routes new submits to the new session", async () => {
    const { pi, claude, service } = await makeService();

    pi.emit({ type: "turn-start" }); // mid-turn swap
    await service.setProvider("claude");
    await service.submit({ message: "next" });

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
});
