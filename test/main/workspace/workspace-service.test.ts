import path from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceService } from "../../../src/main/workspace/workspace-service.js";
import { fakeDirTree, file } from "./fake-dir-tree.js";

/**
 * Permanent suite. Each clause is consumed by renderer source (the
 * file-tree store and components): absolute paths are node identity
 * (cache keys, React keys, requests back to main), kind drives the
 * expander branch, and `ok` drives the store's failure branch.
 * Assertions stay clause-shaped: set-equality (no order pinning),
 * `ok` only (no error-code pinning until something branches on codes).
 */

describe("WorkspaceService.listChildren", () => {
  it("lists every child with absolute joined paths and truthful kinds", async () => {
    const tree = fakeDirTree({
      Zebra: {},
      aardvark: { "nested.ts": file },
      "Apple.ts": file,
      "mango.md": file,
    });
    const service = new WorkspaceService(tree.root, tree.listDir);

    const result = await service.listChildren(tree.root);
    if (!result.ok) throw new Error("expected ok");

    expect(new Set(result.entries.map((e) => e.path))).toEqual(
      new Set([
        path.join(tree.root, "Zebra"),
        path.join(tree.root, "aardvark"),
        path.join(tree.root, "Apple.ts"),
        path.join(tree.root, "mango.md"),
      ]),
    );
    const byName = new Map(result.entries.map((e) => [e.name, e]));
    expect(byName.get("Zebra")?.kind).toBe("directory");
    expect(byName.get("aardvark")?.kind).toBe("directory");
    expect(byName.get("Apple.ts")?.kind).toBe("file");
    expect(byName.get("mango.md")?.kind).toBe("file");
  });

  it("answers not-ok for a path that does not exist", async () => {
    const tree = fakeDirTree({ "a.txt": file });
    const service = new WorkspaceService(tree.root, tree.listDir);

    const result = await service.listChildren(path.join(tree.root, "vanished"));

    expect(result.ok).toBe(false);
  });

  it("answers not-ok when the path is a file, not a directory", async () => {
    const tree = fakeDirTree({ "a.txt": file });
    const service = new WorkspaceService(tree.root, tree.listDir);

    const result = await service.listChildren(path.join(tree.root, "a.txt"));

    expect(result.ok).toBe(false);
  });
});
