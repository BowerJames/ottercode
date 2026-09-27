import { describe, expect, it } from "vitest";
import { isMarked } from "../../../../src/renderer/features/file-tree/dirty-mark";

/**
 * Permanent suite. Consumer: TreeRow renders the marker for both row
 * kinds from exactly this decision. The directory clauses are the
 * load-bearing ones: marking is pure path math — no childrenByDir, no
 * expansion state — so a collapsed, never-expanded directory is marked
 * identically to an open one. That property lives in the interface
 * itself: the function takes no tree state.
 */

describe("isMarked", () => {
  it("a file is marked iff its path is dirty", () => {
    const dirty = new Set(["/ws/a.ts"]);
    expect(isMarked("file", "/ws/a.ts", dirty)).toBe(true);
    expect(isMarked("file", "/ws/b.ts", dirty)).toBe(false);
  });

  it("a directory is marked when a dirty file lies beneath it — collapsed or not, propagating to every ancestor", () => {
    const dirty = new Set(["/ws/src/deep/a.ts"]);
    expect(isMarked("directory", "/ws/src", dirty)).toBe(true);
    expect(isMarked("directory", "/ws", dirty)).toBe(true);
    expect(isMarked("directory", "/ws/test", dirty)).toBe(false); // clean sibling
  });

  it("the prefix must end on a separator boundary — /ws/a is not a parent of /ws/ab", () => {
    const dirty = new Set(["/ws/ab/x.ts"]);
    expect(isMarked("directory", "/ws/a", dirty)).toBe(false);
    expect(isMarked("directory", "/ws/ab", dirty)).toBe(true);
  });

  it("backslash separators propagate too — the tree must mark identically on Windows paths", () => {
    const dirty = new Set(["C:\\ws\\src\\a.ts"]);
    expect(isMarked("directory", "C:\\ws\\src", dirty)).toBe(true);
    expect(isMarked("directory", "C:\\ws", dirty)).toBe(true);
  });
});
