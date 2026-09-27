/**
 * Server discovery policy: which binary serves a language, and where
 * it may live. Probe order is workspace `node_modules/.bin` first
 * (project-pinned tooling wins), then each PATH directory as a bare
 * command. All environment access is injected — the `exists` probe,
 * the PATH listing, and the clock — so the policy is unit-tested with
 * no filesystem or PATH access.
 *
 * Caching: a hit is cached forever (binaries don't appear mid-probe);
 * a miss is cached for the cooldown so keystroke-frequency queries
 * don't stat the world, while a server installed while the app runs
 * is still picked up on the next cooldown boundary.
 */

import path from "node:path";
import type { LanguageId } from "../../shared/lang/languages.js";
import type { EngineCommand } from "./language-engine.js";

export interface ServerResolver {
  /** The command line serving a language, or null when none exists. */
  resolve(language: LanguageId): EngineCommand | null;
}

export type ServerResolverDeps = {
  /** Workspace root: `node_modules/.bin` under it is probed first. */
  root: string;
  /** Existence probe — the entire filesystem footprint of this module. */
  exists: (candidate: string) => boolean;
  /** PATH directories, in order. */
  pathDirs: () => string[];
  now: () => number;
  /** Miss-cache window. Default 60s. */
  cooldownMs?: number;
};

/** The server binary each language routes to. One entry may serve
 * several languages (tsserver's wrapper serves ts+js). */
const SERVER_NAMES: Record<LanguageId, string> = {
  typescript: "typescript-language-server",
  javascript: "typescript-language-server",
  python: "pyright-langserver",
};

export function createServerResolver(deps: ServerResolverDeps): ServerResolver {
  const { root, exists, pathDirs, now } = deps;
  const cooldownMs = deps.cooldownMs ?? 60_000;
  const hits = new Map<LanguageId, EngineCommand>();
  const misses = new Map<LanguageId, number>();

  return {
    resolve(language) {
      const hit = hits.get(language);
      if (hit !== undefined) return hit;

      const missedAt = misses.get(language);
      if (missedAt !== undefined && now() - missedAt < cooldownMs) return null;

      const command = probe(language);
      if (command === null) {
        misses.set(language, now());
        return null;
      }
      misses.delete(language);
      hits.set(language, command);
      return command;
    },
  };

  function probe(language: LanguageId): EngineCommand | null {
    const name = SERVER_NAMES[language];
    // Workspace-local: an absolute path, extensions included for the
    // platforms that need them.
    for (const suffix of ["", ".cmd", ".exe"]) {
      const candidate = path.join(root, "node_modules", ".bin", name + suffix);
      if (exists(candidate)) return { command: candidate, args: ["--stdio"] };
    }
    // PATH: a bare name — the spawn's PATH lookup resolves it.
    for (const dir of pathDirs()) {
      if (dir === "") continue;
      for (const suffix of ["", ".cmd", ".exe"]) {
        if (exists(path.join(dir, name + suffix))) {
          return { command: name, args: ["--stdio"] };
        }
      }
    }
    return null;
  }
}
