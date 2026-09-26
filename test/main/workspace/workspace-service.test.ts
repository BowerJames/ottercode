import path from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceService } from "../../../src/main/workspace/workspace-service.js";
import { fakeDirTree, file } from "./fake-dir-tree.js";

/**
 * Permanent suite. Each clause names a consumer in renderer source:
 * - absolute paths / truthful kinds -> TreeRow identity keys and kind branch
 * - `ok` failures-as-values        -> the stores' error branches (a throw
 *   would surface as an unhandled rejection)
 * Membership, error codes, content verbatim-ness, and the binary/size
 * refusals are deliberately unpinned: presentation is not consumption.
 * Re-pin triggers: the submit flow (content fidelity, refusals); a
 * computational consumer of codes. Order is policy.
 */

describe("WorkspaceService.listChildren", () => {
  it("lists children with absolute joined paths and truthful kinds", async () => {
    const tree = fakeDirTree({
      Zebra: {},
      aardvark: { "nested.ts": file("body") },
      "Apple.ts": file("text"),
      "mango.md": file("more text"),
    });
    const service = new WorkspaceService(tree.root, tree.fs);

    const result = await service.listChildren(tree.root);
    if (!result.ok) throw new Error("expected ok");

    // Shape-only: every returned entry carries an absolute joined path
    // (the round-trip identity clause) and a kind matching the disk
    // truth. Which entries appear is deliberately not asserted.
    for (const entry of result.entries) {
      expect(entry.path).toBe(path.join(tree.root, entry.name));
      expect(entry.kind).toBe(tree.kindOf(entry.path));
    }
  });

  it("answers not-ok for a path that does not exist", async () => {
    const tree = fakeDirTree({ "a.txt": file() });
    const service = new WorkspaceService(tree.root, tree.fs);

    const result = await service.listChildren(path.join(tree.root, "vanished"));

    expect(result.ok).toBe(false);
  });

  it("answers not-ok when the path is a file, not a directory", async () => {
    const tree = fakeDirTree({ "a.txt": file() });
    const service = new WorkspaceService(tree.root, tree.fs);

    const result = await service.listChildren(path.join(tree.root, "a.txt"));

    expect(result.ok).toBe(false);
  });
});

describe("WorkspaceService.readFile", () => {
  it("answers not-ok when the read fails (missing path)", async () => {
    const tree = fakeDirTree({ "a.txt": file("hello") });
    const service = new WorkspaceService(tree.root, tree.fs);

    const result = await service.readFile(path.join(tree.root, "vanished"));

    expect(result.ok).toBe(false);
  });
});
