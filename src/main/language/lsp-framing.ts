/**
 * LSP wire framing: JSON-RPC messages as Content-Length-prefixed
 * byte frames over a byte stream (LSP base protocol). Pure by design
 * — no streams, no processes — so the chunk-boundary carry (the part
 * that breaks) is unit-tested directly. The stdio connection adapter
 * feeds this reader raw pipe chunks and writes frameMessage output.
 *
 * Content-Length counts UTF-8 BYTES, not characters; headers are
 * ASCII. The reader buffers bytes only — bodies are decoded once
 * complete, so multi-byte sequences split across chunks reassemble
 * naturally.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Serializes one message into its framed wire form. */
export function frameMessage(message: unknown): Uint8Array {
  const body = encoder.encode(JSON.stringify(message));
  const header = encoder.encode(`Content-Length: ${body.byteLength}\r\n\r\n`);
  const frame = new Uint8Array(header.byteLength + body.byteLength);
  frame.set(header);
  frame.set(body, header.byteLength);
  return frame;
}

/** Byte sequence that ends the header block. */
const HEADER_SEPARATOR = [13, 10, 13, 10] as const; // \r\n\r\n

export class LspFrameReader {
  private buffer = new Uint8Array(0);

  /** Feeds one raw chunk; returns every message that became complete.
   * Throws on a complete-but-malformed header block — a server that
   * stops speaking LSP should fail loudly, not desync silently. */
  push(chunk: Uint8Array): unknown[] {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;

    const messages: unknown[] = [];
    for (;;) {
      const separator = findSeparator(this.buffer);
      if (separator === -1) break; // header still incomplete
      const length = parseContentLength(
        decoder.decode(this.buffer.subarray(0, separator)),
      );
      if (length === null) {
        throw new Error("malformed LSP frame: no Content-Length header");
      }
      const bodyStart = separator + HEADER_SEPARATOR.length;
      const bodyEnd = bodyStart + length;
      if (this.buffer.length < bodyEnd) break; // body still incomplete
      messages.push(
        JSON.parse(decoder.decode(this.buffer.subarray(bodyStart, bodyEnd))),
      );
      this.buffer = this.buffer.subarray(bodyEnd);
    }
    return messages;
  }
}

/** Index of the first \r\n\r\n, or -1. */
function findSeparator(bytes: Uint8Array): number {
  for (let i = 0; i + HEADER_SEPARATOR.length <= bytes.length; i++) {
    if (
      bytes[i] === HEADER_SEPARATOR[0] &&
      bytes[i + 1] === HEADER_SEPARATOR[1] &&
      bytes[i + 2] === HEADER_SEPARATOR[2] &&
      bytes[i + 3] === HEADER_SEPARATOR[3]
    ) {
      return i;
    }
  }
  return -1;
}

/** Content-Length from a header block, case-insensitive; null when
 * absent or unparsable. Other header lines are ignored. */
function parseContentLength(headerBlock: string): number | null {
  for (const line of headerBlock.split("\r\n")) {
    const match = /^content-length:\s*(\d+)$/i.exec(line.trim());
    if (match !== null) return Number(match[1]);
  }
  return null;
}
