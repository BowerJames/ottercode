import { describe, expect, it } from "vitest";
import { AgentService } from "../../../src/main/agent/agent-service.js";
import type { AgentEvent } from "../../../src/shared/ipc/agent.js";
import { createFakeProvider } from "./fake-provider.js";

/**
 * Permanent suite. Consumers are real since slice 2: the agent-chat
 * store subscribes to the event stream (forwarding test), and its
 * send/abort actions ride the submit/abort chain into the service.
 */

async function makeService() {
  const fake = createFakeProvider();
  const events: AgentEvent[] = [];
  const service = await AgentService.create("/ws", fake.provider, (event) => {
    events.push(event);
  });
  return { fake, events, service };
}

describe("AgentService", () => {
  it("creates one session for the workspace root and forwards its events to the sink", async () => {
    const { fake, events } = await makeService();

    expect(fake.createdRoots).toEqual(["/ws"]);

    fake.emit({ type: "turn-start" });
    fake.emit({ type: "assistant-delta", text: "hi" });

    expect(events).toEqual([
      { type: "turn-start" },
      { type: "assistant-delta", text: "hi" },
    ]);
  });

  it("submit passes the message to the session and reports acceptance", async () => {
    const { fake, service } = await makeService();

    const result = await service.submit({ message: "fix the bug" });

    expect(result).toEqual({ ok: true });
    expect(fake.sentPrompts).toEqual(["fix the bug"]);
  });

  it("abort reaches the session", async () => {
    const { fake, service } = await makeService();

    service.abort();

    expect(fake.aborts).toBe(1);
  });
});
