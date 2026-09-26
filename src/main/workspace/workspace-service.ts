import path from "node:path";
import type {
  FileEntry,
  ListChildrenResult,
  ReadFileResult,
} from "../../shared/ipc/fs.js";
import { mapFsError } from "./map-fs-error.js";
import type { WorkspaceFs } from "./workspace-fs.js";

/**
 * Policy: reads above this many characters are refused with
 * "too-large". The number is tunable; the refusal is contract.
 */
export const READ_FILE_MAX_CHARS = 10 * 1024 * 1024;

/** Policy: a NUL this early means the file is not text. */
const BINARY_SNIFF_CHARS = 8192;

/**
 * The disk authority: the single choke point for workspace state. v1 is
 * stateless and read-only — each call goes straight to the seam.
 * Absoluteness of paths is a caller precondition (the renderer is
 * seeded by fs:root and only ever passes absolute paths back).
 */
export class WorkspaceService {
  private readonly root: string;
  private readonly fs: WorkspaceFs;

  constructor(root: string, fs: WorkspaceFs) {
    this.root = root;
    this.fs = fs;
  }

  getRoot(): string {
    return this.root;
  }

  async listChildren(dirPath: string): Promise<ListChildrenResult> {
    try {
      const children = await this.fs.listDir(dirPath);
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

  async readFile(filePath: string): Promise<ReadFileResult> {
    try {
      const content = await this.fs.readFile(filePath);
      if (content.length > READ_FILE_MAX_CHARS) {
        return { ok: false, error: { code: "too-large" } };
      }
      if (content.slice(0, BINARY_SNIFF_CHARS).includes("\0")) {
        return { ok: false, error: { code: "binary" } };
      }
      // Pass-through by design: content crosses verbatim (no
      // truncation, normalization, or trimming) — the agent flow
      // depends on buffers matching the disk bytes.
      return { ok: true, content };
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
