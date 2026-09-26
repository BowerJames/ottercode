import type {
  ClientTransport,
  Invoke,
  Subscribe,
} from "../../src/shared/ipc/client";

/**
 * Recording, programmable fake for the client transport seam — both
 * halves. Responses are programmed per channel (invoke); events are fed
 * with push (subscribe). An unprogrammed invoke channel yields
 * undefined — which the real createClient riding on top surfaces as a
 * visible failure: wrong-channel delegation cannot pass silently.
 */
export function createFakeTransport(): {
  transport: ClientTransport;
  calls: Array<{ channel: string; payload: unknown }>;
  responses: Map<string, unknown>;
  push(channel: string, payload: unknown): void;
} {
  const calls: Array<{ channel: string; payload: unknown }> = [];
  const responses = new Map<string, unknown>();
  const listeners = new Map<string, Set<(payload: unknown) => void>>();

  const fakeInvoke: Invoke = async (channel, payload) => {
    calls.push({ channel, payload });
    return responses.get(channel);
  };

  const fakeSubscribe: Subscribe = (channel, listener) => {
    const set = listeners.get(channel) ?? new Set();
    listeners.set(channel, set);
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  };

  return {
    transport: { invoke: fakeInvoke, subscribe: fakeSubscribe },
    calls,
    responses,
    push(channel, payload) {
      for (const listener of listeners.get(channel) ?? []) {
        listener(payload);
      }
    },
  };
}
