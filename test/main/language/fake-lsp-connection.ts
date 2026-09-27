import type { LspConnection } from "../../../src/main/language/lsp-connection.js";

/**
 * Scripted fake for the LspConnection seam: records every sent
 * message, answers scripted methods asynchronously (queueMicrotask —
 * the real wire never answers synchronously), and can deliver
 * server-initiated traffic (receive) or drop the connection (die).
 * An unscripted request is never answered — the engine-visible
 * equivalent of a hung server, which the service-level timeout owns.
 */

type Responder = (
  params: unknown,
  message: unknown,
) => { result?: unknown; error?: { code: number; message: string } };

export class FakeLspConnection implements LspConnection {
  readonly sent: unknown[] = [];
  disposed = false;
  private messageHandler: ((message: unknown) => void) | null = null;
  private closeHandler: (() => void) | null = null;
  private responders = new Map<string, Responder>();

  /** Script one method: every matching request gets this reply. */
  respond(method: string, responder: Responder): void {
    this.responders.set(method, responder);
  }

  /** Deliver a server→client message (notification or request). */
  receive(message: unknown): void {
    this.messageHandler?.(message);
  }

  /** Drop the connection, as a process death would. */
  die(): void {
    this.closeHandler?.();
  }

  send(message: unknown): void {
    this.sent.push(message);
    const { id, method, params } = message as {
      id?: number;
      method?: string;
      params?: unknown;
    };
    if (id === undefined || method === undefined) return; // notification
    const responder = this.responders.get(method);
    if (responder === undefined) return; // hung: no reply, by design
    const reply = responder(params ?? {}, message);
    queueMicrotask(() => {
      this.messageHandler?.(
        reply.error === undefined
          ? { id, result: reply.result ?? null }
          : { id, error: reply.error },
      );
    });
  }

  onMessage(handler: (message: unknown) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  dispose(): void {
    this.disposed = true;
  }

  // ── Assertions helpers (test-facing, not seam-facing) ──

  /** Every sent message's method, in order (dots for replies n/a). */
  methods(): Array<string | undefined> {
    return this.sent.map((m) => (m as { method?: string }).method);
  }

  /** The params of the LAST sent message with this method. */
  // biome-ignore lint/suspicious/noExplicitAny: assertions-facing accessor — tests reach into wire shapes the engine itself must stay blind to.
  lastParamsOf(method: string): any {
    const found = [...this.sent]
      .reverse()
      .find((m) => (m as { method?: string }).method === method);
    return (found as { params?: unknown } | undefined)?.params;
  }
}
