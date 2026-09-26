import type { Invoke } from "../../../../src/shared/ipc/client";

/**
 * Recording, programmable fake for the Invoke transport seam. Responses
 * are programmed per channel; an unprogrammed channel yields undefined —
 * which the real createClient riding on top surfaces as a visible
 * failure. That is the point: wrong-channel delegation cannot pass
 * silently.
 */
export function createFakeInvoke(): {
  fakeInvoke: Invoke;
  calls: Array<{ channel: string; payload: unknown }>;
  responses: Map<string, unknown>;
} {
  const calls: Array<{ channel: string; payload: unknown }> = [];
  const responses = new Map<string, unknown>();
  const fakeInvoke: Invoke = async (channel, payload) => {
    calls.push({ channel, payload });
    return responses.get(channel);
  };
  return { fakeInvoke, calls, responses };
}
