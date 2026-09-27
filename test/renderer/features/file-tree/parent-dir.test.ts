import { describe, expect, it } from "vitest";
import { parentDir } from "../../../../src/renderer/features/file-tree/parent-dir";

/**
 * Permanent suite — consumed by the file-tree store's refresh: the
 * selection-vanished check compares parentDir(entry.path) against
 * freshly listed directory paths, so a wrong parent here means
 * selections clear on the wrong evidence (or never clear).
 */

describe("parentDir", () => {
  it("returns the directory portion of a posix path", () => {
    expect(parentDir("/ws/src/main.rs")).toBe("/ws/src");
    expect(parentDir("/ws/README.md")).toBe("/ws");
  });

  it("maps a root-level entry to the filesystem root", () => {
    expect(parentDir("/x")).toBe("/");
  });

  it("accepts windows separators", () => {
    expect(parentDir("C:\\ws\\a.ts")).toBe("C:\\ws");
  });

  it("ignores trailing separators", () => {
    expect(parentDir("/ws/src/")).toBe("/ws");
  });

  it('returns "" when no separator remains — unmatchable, never wrong', () => {
    expect(parentDir("x")).toBe("");
  });
});
