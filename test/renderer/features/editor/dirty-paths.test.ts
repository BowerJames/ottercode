import { describe, expect, it } from "vitest";
import { dirtyPaths } from "../../../../src/renderer/features/editor/dirty-paths";

/**
 * Permanent suite. Consumer: TreeRow's useShallow subscription over
 * the editor store — the markers render from exactly this set, and
 * the subscription's shallow equality depends on the ordering clause
 * (an unstable order would re-render the tree on every keystroke even
 * when the dirty set didn't change).
 */

function copies(entries: Record<string, [original: string, content: string]>) {
  return Object.fromEntries(
    Object.entries(entries).map(([path, [original, content]]) => [
      path,
      { original, content, revision: 0 },
    ]),
  );
}

describe("dirtyPaths", () => {
  it("lists only diverged copies, by path", () => {
    expect(
      dirtyPaths(
        copies({
          "/ws/clean.ts": ["a", "a"],
          "/ws/dirty.ts": ["a", "b"],
        }),
      ),
    ).toEqual(["/ws/dirty.ts"]);
  });

  it("a copy edited back to identical content is clean — divergence, not history, is the predicate", () => {
    // The store keeps no edit history: a user who edited away and back
    // is indistinguishable from one who never edited, and every
    // consumer (dot, attachments, markers) treats them the same.
    expect(dirtyPaths(copies({ "/ws/round-trip.ts": ["a", "a"] }))).toEqual([]);
  });

  it("is sorted — the subscription's shallow equality depends on stable order", () => {
    expect(
      dirtyPaths(
        copies({
          "/ws/z.ts": ["a", "b"],
          "/ws/a.ts": ["a", "b"],
          "/m.ts": ["a", "b"],
        }),
      ),
    ).toEqual(["/m.ts", "/ws/a.ts", "/ws/z.ts"]);
  });
});
