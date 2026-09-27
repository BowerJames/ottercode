import { describe, expect, it } from "vitest";
import {
  frameMessage,
  LspFrameReader,
} from "../../../src/main/language/lsp-framing.js";

/**
 * Permanent suite. The framing reader is the wire format's invariant
 * keeper: LSP servers split Content-Length frames across pipe chunk
 * boundaries at arbitrary BYTE positions (including mid-UTF-8
 * sequence and mid-header), and the reader must reassemble them
 * exactly. Its only consumer is the stdio connection adapter — a
 * framing bug surfaces as corrupted JSON reaching the engine, which
 * no caller can diagnose. frameMessage's byte-accurate header is the
 * other half of the same contract (a char-counted header desyncs the
 * stream for any non-ASCII payload).
 */

/** Splits a Uint8Array at an exact byte index. */
function split(bytes: Uint8Array, at: number): [Uint8Array, Uint8Array] {
  return [bytes.subarray(0, at), bytes.subarray(at)];
}

describe("frameMessage", () => {
  it("frames with a byte-accurate Content-Length header", () => {
    // One emoji: 2 UTF-16 characters but 4 UTF-8 bytes — a header
    // counted in characters would desync the stream.
    const message = { jsonrpc: "2.0", id: 1, result: "😀" };
    const frame = frameMessage(message);

    const text = new TextDecoder().decode(frame);
    const body = text.slice(text.indexOf("\r\n\r\n") + 4);
    expect(body).toBe(JSON.stringify(message));
    expect(
      text.startsWith(
        `Content-Length: ${new TextEncoder().encode(body).byteLength}\r\n\r\n`,
      ),
    ).toBe(true);
  });

  it("round-trips through the reader", () => {
    const reader = new LspFrameReader();
    const message = { result: ["😀"] };
    expect(reader.push(frameMessage(message))).toEqual([message]);
  });
});

describe("LspFrameReader", () => {
  it("parses one complete message from one chunk", () => {
    const reader = new LspFrameReader();
    const messages = reader.push(frameMessage({ id: 1, result: null }));
    expect(messages).toEqual([{ id: 1, result: null }]);
    expect(reader.push(new Uint8Array(0))).toEqual([]);
  });

  it("carries a partial header across chunks", () => {
    const reader = new LspFrameReader();
    const frame = frameMessage({ id: 2, result: { value: 42 } });
    // Split INSIDE the "Content-Length" header text.
    const [a, b] = split(frame, 9);
    expect(reader.push(a)).toEqual([]);
    expect(reader.push(b)).toEqual([{ id: 2, result: { value: 42 } }]);
  });

  it("carries a partial body across chunks", () => {
    const reader = new LspFrameReader();
    const frame = frameMessage({ id: 3, result: "body text" });
    // Split after the header separator plus a few body bytes.
    const [a, b] = split(frame, 30);
    expect(reader.push(a)).toEqual([]);
    expect(reader.push(b)).toEqual([{ id: 3, result: "body text" }]);
  });

  it("reassembles a body split mid-UTF-8-sequence", () => {
    const reader = new LspFrameReader();
    const frame = frameMessage({ id: 4, result: "😀😀" });
    // Find a split point inside the first emoji's 4-byte sequence:
    // header is pure ASCII, so scan for the first 0xF0 byte.
    const emojiAt = frame.indexOf(0xf0);
    const [a, b] = split(frame, emojiAt + 2);
    expect(reader.push(a)).toEqual([]);
    expect(reader.push(b)).toEqual([{ id: 4, result: "😀😀" }]);
  });

  it("emits multiple back-to-back messages from one chunk", () => {
    const reader = new LspFrameReader();
    const a = frameMessage({ id: 5, result: 1 });
    const b = frameMessage({ id: 6, result: 2 });
    const both = new Uint8Array(a.length + b.length);
    both.set(a);
    both.set(b, a.length);
    expect(reader.push(both)).toEqual([
      { id: 5, result: 1 },
      { id: 6, result: 2 },
    ]);
  });

  it("ignores non-Content-Length header lines it doesn't know", () => {
    const reader = new LspFrameReader();
    const body = JSON.stringify({ ok: true });
    const bodyBytes = new TextEncoder().encode(body);
    const header = `Content-Type: application/vscode-jsonrpc; charset=utf-8\r\nContent-Length: ${bodyBytes.length}\r\n\r\n`;
    const frame = new TextEncoder().encode(header + body);
    expect(reader.push(frame)).toEqual([{ ok: true }]);
  });
});
