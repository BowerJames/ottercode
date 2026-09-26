import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  READ_FILE_MAX_CHARS,
  WorkspaceService,
} from "../../../src/main/workspace/workspace-service.js";
import { fakeDirTree, file } from "./fake-dir-tree.js";

/**
 * Permanent suite. Each clause names a consumer in renderer source:
 * - absolute paths / truthful kinds -> TreeRow identity keys and kind branch
 * - `ok` failures-as-values        -> the stores' error branches (a throw
 *   would surface as an unhandled rejection)
 * Error CODES, membership, and content verbatim-ness are deliberately
 * unpinned: their only consumer is the error banner, which renders
 * text nothing downstream computes with. Presentation is not
 * consumption. Order is policy.
 */

describe("WorkspaceService.listChildren", () => {
  it("lists children with absolute joined paths and truthful kinds", async () => {
    const tree = fakeDirTree({
      Zebra: {},
      aardvark: { "nested.ts": file() },
      "Apple.ts": file(),
      "mango.md": file(),
    });
    const service = new WorkspaceService(tree.root, tree.fs);

    const result = await service.listChildren(tree.root);
    if (!result.ok) throw new Error("expected ok");

    const byName = new Map(result.entries.map((e) => [e.name, e]));
    expect(byName.get("Zebra")?.path).toBe(path.join(tree.root, "Zebra"));
    expect(byName.get("Zebra")?.kind).toBe("directory");
    expect(byName.get("aardvark")?.kind).toBe("directory");
    expect(byName.get("Apple.ts")?.path).toBe(path.join(tree.root, "Apple.ts"));
    expect(byName.get("Apple.ts")?.kind).toBe("file");
    expect(byName.get("mango.md")?.kind).toBe("file");
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
  it("answers not-ok for a path that does not exist", async () => {
    const tree = fakeDirTree({ "a.txt": file("hello") });
    const service = new WorkspaceService(tree.root, tree.fs);

    const result = await service.readFile(path.join(tree.root, "vanished"));

    expect(result.ok).toBe(false);
  });

  it("answers not-ok for a directory path", async () => {
    const tree = fakeDirTree({ src: {} });
    const service = new WorkspaceService(tree.root, tree.fs);

    const result = await service.readFile(path.join(tree.root, "src"));

    expect(result.ok).toBe(false);
  });

  it("answers not-ok for binary content (NUL in the first 8k)", async () => {
    const tree = fakeDirTree({ "blob.bin": file("abc\u0000def") });
    const service = new WorkspaceService(tree.root, tree.fs);

    const result = await service.readFile(path.join(tree.root, "blob.bin"));

    expect(result.ok).toBe(false);
  });

  it("answers not-ok for content above the size cap", async () => {
    const tree = fakeDirTree({
      "huge.txt": file("x".repeat(READ_FILE_MAX_CHARS + 1)),
    });
    const service = new WorkspaceService(tree.root, tree.fs);

    const result = await service.readFile(path.join(tree.root, "huge.txt"));

    expect(result.ok).toBe(false);
  });
});
