import { describe, expect, it } from "vitest";
import { TerminalService } from "../../../src/main/terminal/terminal-service.js";
import type { TerminalEvent } from "../../../src/shared/ipc/terminal.js";
import { createFakeSpawner } from "./fake-spawner.js";

/**
 * Permanent suite. Consumer: the renderer terminal store's state
 * machine — it consumes every event, so the bracket clauses here are
 * obligations (no exit and the dock bricks with running stuck; a
 * refusal emitting events renders phantom runs), and the exit facts
 * feed RunRow's (cancelled)/(killed) branches and composePrompt's
 * annotations through collectRun. Delegation pins (command, cwd)
 * follow the house precedent of "some string reaches the session".
 *
 * Deliberately NOT pinned: the sanitizer (ANSI stripping, \r
 * dropping) — documented policy with no source consumer computing on
 * it; its tests were ephemeral and are gone.
 */

function makeService(options?: { failSpawn?: boolean }) {
  const fake = createFakeSpawner(options);
  const events: TerminalEvent[] = [];
  const service = new TerminalService("/ws", fake.spawner, (event) => {
    events.push(event);
  });
  return { fake, events, service };
}

describe("TerminalService", () => {
  it("brackets one run: started, output, exit", async () => {
    const { fake, events, service } = makeService();

    await service.run("npm test");
    fake.emit("ok\n");
    fake.emit("done\n");
    fake.exit(0);

    expect(fake.commands).toEqual(["npm test"]);
    expect(fake.cwds).toEqual(["/ws"]); // anchored to the workspace root
    expect(events).toEqual([
      { type: "started", command: "npm test" },
      { type: "output", chunk: "ok\n" },
      { type: "output", chunk: "done\n" },
      { type: "exit", exitCode: 0, cancelled: false },
    ]);
  });

  it("refuses a second command while one is running, emitting nothing", async () => {
    const { fake, events, service } = makeService();
    await service.run("long");

    const result = await service.run("impatient");

    expect(result).toEqual({ ok: false, error: { code: "busy" } });
    expect(fake.commands).toEqual(["long"]);
    // The consumed half of the refusal: no bracket for the refused
    // command — the store renders every event it receives.
    expect(events).toEqual([{ type: "started", command: "long" }]);
  });

  it("accepts the next command after the previous exits", async () => {
    const { fake, events, service } = makeService();
    await service.run("first");
    fake.exit(0);

    const result = await service.run("second");

    expect(result).toEqual({ ok: true });
    expect(fake.commands).toEqual(["first", "second"]);
    expect(events.filter((e) => e.type === "started")).toHaveLength(2);
  });

  it("abort kills the running process and the exit reports cancelled", async () => {
    const { fake, events, service } = makeService();
    await service.run("watch");
    service.abort();
    fake.exit(null); // killed by signal

    expect(fake.kills).toBe(1);
    expect(events.at(-1)).toEqual({
      type: "exit",
      exitCode: null,
      cancelled: true,
    });
    // And the terminal is free again.
    const result = await service.run("next");
    expect(result).toEqual({ ok: true });
  });

  it("a signal death we did not cause reports cancelled false", async () => {
    const { fake, events, service } = makeService();
    await service.run("fragile");
    fake.exit(null); // externally killed — no abort happened

    expect(events.at(-1)).toEqual({
      type: "exit",
      exitCode: null,
      cancelled: false,
    });
  });

  it("a spawn failure still brackets: started, then exit", async () => {
    const { events, service } = makeService({ failSpawn: true });

    const result = await service.run("doomed");

    expect(result).toEqual({ ok: true }); // acceptance is not the outcome
    expect(events).toEqual([
      { type: "started", command: "doomed" },
      { type: "exit", exitCode: null, cancelled: false },
    ]);
  });
});
