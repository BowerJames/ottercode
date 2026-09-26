import path from "node:path";
import type {
  DirChild,
  ListDir,
} from "../../../src/main/workspace/list-dir.js";

/**
 * In-memory adapter for the ListDir seam (the test double of the real
 * node:fs adapter). Implements exactly the seam contract and nothing
 * more: names, kinds, ENOENT, ENOTDIR. The moment it grows an `if` that
 * isn't in the seam's doc comment, it's drifting.
 */

/** Sentinel: marks a spec key as a file (directories are nested objects). */
export const file = Symbol("file");

export type FakeDirTreeSpec = { [name: string]: FakeDirTreeSpec | typeof file };

/** Fabricates a Node-style error: an Error carrying a string `code`. */
export function fsError(code: string, message = code): Error {
  return Object.assign(new Error(message), { code });
}

/**
 * Builds a fake workspace tree and returns its (equally fake) absolute
 * root plus the ListDir adapter over it.
 */
export function fakeDirTree(spec: FakeDirTreeSpec): {
  root: string;
  listDir: ListDir;
} {
  const root = path.resolve("/fake-workspace");
  const kinds = new Map<string, "file" | "directory">();
  kinds.set(root, "directory");

  const build = (node: FakeDirTreeSpec, parent: string): void => {
    for (const [name, value] of Object.entries(node)) {
      const entryPath = path.join(parent, name);
      if (value === file) {
        kinds.set(entryPath, "file");
      } else {
        kinds.set(entryPath, "directory");
        build(value, entryPath);
      }
    }
  };
  build(spec, root);

  const listDir: ListDir = async (dirPath) => {
    const resolved = path.resolve(dirPath);
    const kind = kinds.get(resolved);
    if (kind === undefined) {
      throw fsError("ENOENT", `no such file or directory: ${dirPath}`);
    }
    if (kind === "file") {
      throw fsError("ENOTDIR", `not a directory: ${dirPath}`);
    }
    const children: DirChild[] = [];
    for (const [entryPath, entryKind] of kinds) {
      if (path.dirname(entryPath) === resolved) {
        children.push({ name: path.basename(entryPath), kind: entryKind });
      }
    }
    return children;
  };

  return { root, listDir };
}
