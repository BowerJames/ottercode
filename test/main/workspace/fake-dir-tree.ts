import path from "node:path";
import type { WorkspaceFs } from "../../../src/main/workspace/workspace-fs.js";

/**
 * In-memory adapter for the WorkspaceFs seam (the test double of the
 * real node:fs adapter). Implements exactly the seam contract and
 * nothing more: names, kinds, contents, ENOENT, ENOTDIR, EISDIR. The
 * moment it grows an `if` that isn't in the seam's doc comment, it's
 * drifting.
 */

/** Marks a file in a spec, carrying its content. */
export class FakeFile {
  constructor(readonly content: string) {}
}

/** Spec shorthand: `name: file("content")` — defaults to empty content. */
export const file = (content = ""): FakeFile => new FakeFile(content);

export type FakeDirTreeSpec = { [name: string]: FakeDirTreeSpec | FakeFile };

/** Fabricates a Node-style error: an Error carrying a string `code`. */
export function fsError(code: string, message = code): Error {
  return Object.assign(new Error(message), { code });
}

/**
 * Builds a fake workspace tree and returns its (equally fake) absolute
 * root plus the WorkspaceFs adapter over it.
 */
export function fakeDirTree(spec: FakeDirTreeSpec): {
  root: string;
  fs: WorkspaceFs;
} {
  const root = path.resolve("/fake-workspace");
  const kinds = new Map<string, "file" | "directory">();
  const contents = new Map<string, string>();
  kinds.set(root, "directory");

  const build = (node: FakeDirTreeSpec, parent: string): void => {
    for (const [name, value] of Object.entries(node)) {
      const entryPath = path.join(parent, name);
      if (value instanceof FakeFile) {
        kinds.set(entryPath, "file");
        contents.set(entryPath, value.content);
      } else {
        kinds.set(entryPath, "directory");
        build(value, entryPath);
      }
    }
  };
  build(spec, root);

  const fs: WorkspaceFs = {
    async listDir(dirPath) {
      const resolved = path.resolve(dirPath);
      const kind = kinds.get(resolved);
      if (kind === undefined) {
        throw fsError("ENOENT", `no such file or directory: ${dirPath}`);
      }
      if (kind === "file") {
        throw fsError("ENOTDIR", `not a directory: ${dirPath}`);
      }
      const children: Array<{ name: string; kind: "file" | "directory" }> = [];
      for (const [entryPath, entryKind] of kinds) {
        if (path.dirname(entryPath) === resolved) {
          children.push({ name: path.basename(entryPath), kind: entryKind });
        }
      }
      return children;
    },

    async readFile(filePath) {
      const resolved = path.resolve(filePath);
      const kind = kinds.get(resolved);
      if (kind === undefined) {
        throw fsError("ENOENT", `no such file or directory: ${filePath}`);
      }
      if (kind === "directory") {
        throw fsError(
          "EISDIR",
          `illegal operation on a directory: ${filePath}`,
        );
      }
      return contents.get(resolved) ?? "";
    },
  };

  return { root, fs };
}
