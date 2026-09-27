import { describe, expect, it } from "vitest";
import { createServerResolver } from "../../../src/main/language/server-resolver.js";
import type { LanguageId } from "../../../src/shared/lang/languages.js";

/**
 * Permanent suite. The resolver's output is the spawn command the
 * engine rides on: a wrong probe order or a broken negative cache
 * either runs a phantom binary or hammers the filesystem on every
 * keystroke. Everything environment-shaped (disk, PATH, clock) is
 * injected — the suite touches no external resource.
 */

function makeResolver(
  existing: Set<string>,
  pathDirs: string[] = ["/usr/bin"],
) {
  let clock = 1_000;
  let probes = 0;
  const resolver = createServerResolver({
    root: "/ws",
    exists: (candidate) => {
      probes++;
      return existing.has(candidate);
    },
    pathDirs: () => pathDirs,
    now: () => clock,
    cooldownMs: 60_000,
  });
  return {
    resolver,
    probeCount: () => probes,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("server resolver", () => {
  it("prefers the workspace-local binary when one exists", () => {
    const { resolver } = makeResolver(
      new Set(["/ws/node_modules/.bin/typescript-language-server"]),
    );

    expect(resolver.resolve("typescript")).toEqual({
      command: "/ws/node_modules/.bin/typescript-language-server",
      args: ["--stdio"],
    });
  });

  it("falls back to a PATH hit as a bare command", () => {
    const { resolver } = makeResolver(new Set(["/usr/bin/pyright-langserver"]));

    expect(resolver.resolve("python")).toEqual({
      command: "pyright-langserver",
      args: ["--stdio"],
    });
  });

  it("answers null when no server exists anywhere", () => {
    const { resolver } = makeResolver(new Set());
    expect(resolver.resolve("javascript")).toBeNull();
  });

  it("caches a positive hit — no re-probing on later resolves", () => {
    const { resolver, probeCount } = makeResolver(
      new Set(["/usr/bin/typescript-language-server"]),
    );
    resolver.resolve("typescript");
    const afterFirst = probeCount();
    resolver.resolve("typescript");
    expect(probeCount()).toBe(afterFirst);
  });

  it("caches a miss for the cooldown, then probes again", () => {
    const { resolver, probeCount, advance } = makeResolver(new Set());
    resolver.resolve("typescript");
    const afterMiss = probeCount();

    resolver.resolve("typescript"); // inside cooldown: no probes
    expect(probeCount()).toBe(afterMiss);

    advance(60_001); // cooldown elapsed
    resolver.resolve("typescript");
    expect(probeCount()).toBeGreaterThan(afterMiss);
  });

  it("treats the languages one server serves equivalently", () => {
    const { resolver } = makeResolver(
      new Set(["/ws/node_modules/.bin/typescript-language-server"]),
    );
    for (const language of ["typescript", "javascript"] as LanguageId[]) {
      expect(resolver.resolve(language)?.command).toBe(
        "/ws/node_modules/.bin/typescript-language-server",
      );
    }
    // Distinct cooldowns: a missing python server must not inherit
    // the typescript cache entry (or vice versa).
    expect(resolver.resolve("python")).toBeNull();
  });
});
