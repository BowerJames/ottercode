import { readFile as fsReadFile, readdir } from "node:fs/promises";
import type { WorkspaceFs } from "./workspace-fs.js";

/**
 * The production adapter for the WorkspaceFs seam: the only place in
 * the codebase where node:fs appears. Errors propagate raw — Node's
 * `.code`-carrying errors are exactly what the seam contract promises.
 * Verified by running the app and (later) E2E, not by unit tests.
 */
export const realWorkspaceFs: WorkspaceFs = {
  async listDir(dirPath) {
    const dirents = await readdir(dirPath, { withFileTypes: true });
    return dirents.map((d) => ({
      name: d.name,
      kind: d.isDirectory() ? ("directory" as const) : ("file" as const),
    }));
  },

  readFile: (filePath) => fsReadFile(filePath, "utf8"),
};
