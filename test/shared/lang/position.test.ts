import { describe, expect, it } from "vitest";
import {
  offsetFromPosition,
  positionFromOffset,
} from "../../../src/shared/lang/position.js";

/**
 * Permanent suite. Consumers: the renderer converts caret offsets into
 * wire positions before every language request, and main converts
 * returned positions back into offsets inside edit application — a
 * drift in either direction misplaces every query by the same amount,
 * silently. The coordinate system itself (UTF-16 code units, "\n" as
 * the only line separator) is the contract both processes share.
 */

describe("positionFromOffset", () => {
  it("maps offset 0 to the origin", () => {
    expect(positionFromOffset("abc", 0)).toEqual({ line: 0, character: 0 });
  });

  it("maps an offset within the first line to its character index", () => {
    expect(positionFromOffset("abc", 2)).toEqual({ line: 0, character: 2 });
  });

  it("counts lines by \\n and restarts the character at each line", () => {
    // indices: 0 'a' | 1 '\n' | 2 '\n' | 3 'b' | 4 'c'
    const content = "a\n\nbc";
    expect(positionFromOffset(content, 3)).toEqual({ line: 2, character: 0 });
    expect(positionFromOffset(content, 4)).toEqual({ line: 2, character: 1 });
  });

  it("treats a carriage return as an ordinary character (\\n is the only separator)", () => {
    // indices: 0 'a' | 1 '\r' | 2 '\n' | 3 'b'
    const content = "a\r\nb";
    expect(positionFromOffset(content, 1)).toEqual({
      line: 0,
      character: 1,
    });
    expect(positionFromOffset(content, 3)).toEqual({ line: 1, character: 0 });
  });

  it("accepts the end-of-content offset", () => {
    expect(positionFromOffset("ab\ncd", 5)).toEqual({ line: 1, character: 2 });
  });
  // Unpinned, deliberately: out-of-range clamping here has no consumer
  // (callers pass view offsets, valid by construction) — defensive
  // behaviour, not a consumed clause. offsetFromPosition's clamping
  // IS pinned: the engine feeds it server ranges over possibly-drifted
  // content, a real error mode.
});

describe("offsetFromPosition", () => {
  it("round-trips every offset of a multi-line sample", () => {
    const content = "const x = 1;\n\nfunction f() {\n  return x;\n}";
    for (let offset = 0; offset <= content.length; offset++) {
      const position = positionFromOffset(content, offset);
      expect(offsetFromPosition(content, position)).toBe(offset);
    }
  });

  it("clamps a character past the line end to the line end", () => {
    expect(offsetFromPosition("ab\ncd", { line: 1, character: 99 })).toBe(5);
    expect(offsetFromPosition("ab\ncd", { line: 0, character: 99 })).toBe(2);
  });

  it("clamps a line past the last to the end of content", () => {
    expect(offsetFromPosition("ab\ncd", { line: 99, character: 0 })).toBe(5);
  });

  it("clamps negative positions to the origin", () => {
    expect(offsetFromPosition("ab\ncd", { line: -1, character: -1 })).toBe(0);
  });
});
