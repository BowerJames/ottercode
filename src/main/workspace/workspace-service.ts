import path from "node:path";
import type { FileEntry, ListChildrenResult } from "../../shared/ipc/fs.js";
import type { ListDir } from "./list-dir.js";
import { mapFsError } from "./map-fs-error.js";

/**
 * The disk authority: the single choke point for workspace state. v1 is
 * stateless and read-only — each call goes straight to the seam.
 * Absoluteness of listed paths is a caller precondition (the renderer is
 * seeded by fs:root and only ever passes absolute paths back).
 */
export class WorkspaceService {
  private readonly root: string;
  private readonly listDir: ListDir;

  constructor(root: string, listDir: ListDir) {
    this.root = root;
    this.listDir = listDir;
  }

  getRoot(): string {
    return this.root;
  }

  async listChildren(dirPath: string): Promise<ListChildrenResult> {
    try {
      const children = await this.listDir(dirPath);
      return {
        ok: true,
        entries: children
          .map((child) => ({
            name: child.name,
            path: path.join(dirPath, child.name),
            kind: child.kind,
          }))
          .sort(compareEntries),
      };
    } catch (error) {
      return { ok: false, error: mapFsError(error) };
    }
  }
}

/**
 * Presentation order: directories first, then files; within a group,
 * case-insensitive by name, ties broken by raw name so the order is a
 * deterministic total order on every platform. Policy, not obligation —
 * documented at the contract, deliberately unpinned by tests.
 */
function compareEntries(a: FileEntry, b: FileEntry): number {
  if (a.kind !== b.kind) {
    return a.kind === "directory" ? -1 : 1;
  }
  const aLower = a.name.toLowerCase();
  const bLower = b.name.toLowerCase();
  if (aLower !== bLower) {
    return aLower < bLower ? -1 : 1;
  }
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}
