import { describe, expect, it } from "vitest";
import { createGitStore } from "../../../../src/renderer/features/git/store";
import { GIT_STATUS_CHANNEL } from "../../../../src/shared/ipc/channels";
import { createClient } from "../../../../src/shared/ipc/client";
import { createFakeTransport } from "../../fake-transport";

/**
 * Permanent suite. Consumers: GitBar renders `branch` and hides on
 * null (no repo, detached, or failure — all collapse to hidden); the
 * payload assertion pins createClient's git delegation at its first
 * consumer.
 */
function makeStore() {
  const harness = createFakeTransport();
  const store = createGitStore(createClient(harness.transport).git);
  return { harness, store };
}

describe("createGitStore", () => {
  it("starts with no branch (undefined — the bar is hidden while loading)", () => {
    const { store } = makeStore();

    expect(store.getState().branch).toBeUndefined();
  });

  it("load records the branch from the status result", async () => {
    const { harness, store } = makeStore();
    harness.responses.set(GIT_STATUS_CHANNEL, {
      ok: true,
      branch: "main",
    });

    await store.getState().load();

    expect(store.getState().branch).toBe("main");
    expect(harness.calls.some((c) => c.channel === GIT_STATUS_CHANNEL)).toBe(
      true,
    );
  });

  it("load collapses every no-branch outcome — and failures — to null", async () => {
    const { harness, store } = makeStore();
    harness.responses.set(GIT_STATUS_CHANNEL, { ok: true, branch: null });
    await store.getState().load();

    harness.responses.set(GIT_STATUS_CHANNEL, {
      ok: false,
      error: { code: "unavailable" },
    });
    await store.getState().load();

    expect(store.getState().branch).toBeNull();
  });
});
