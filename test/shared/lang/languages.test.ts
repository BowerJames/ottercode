import { describe, expect, it } from "vitest";
import {
  extensionOf,
  languageIdOf,
} from "../../../src/shared/lang/languages.js";

/**
 * Permanent suite. languageIdOf is the app's single path→language
 * classifier, consumed on BOTH sides of the process boundary: the
 * renderer gates language-intel extensions and grammar bundles on it,
 * main routes requests to language servers by it. Membership is the
 * obligation (a wrong id breaks routing or lights up dead features);
 * extensionOf's tail-segment rule is pinned because both consumers
 * key registries off its exact output.
 */

describe("languageIdOf", () => {
  it("classifies TypeScript-family extensions as typescript", () => {
    for (const ext of [".ts", ".mts", ".cts", ".tsx"]) {
      expect(languageIdOf(`src/app${ext}`)).toBe("typescript");
    }
  });

  it("classifies JavaScript-family extensions as javascript", () => {
    for (const ext of [".js", ".mjs", ".cjs", ".jsx"]) {
      expect(languageIdOf(`src/app${ext}`)).toBe("javascript");
    }
  });

  it("classifies .py as python", () => {
    expect(languageIdOf("scripts/dev.py")).toBe("python");
  });

  it("is case-insensitive on the extension", () => {
    expect(languageIdOf("APP.PY")).toBe("python");
    expect(languageIdOf("App.TS")).toBe("typescript");
  });

  it("classifies unknown types and synthetic editor keys as null", () => {
    // null is the renderer's self-disable signal AND main's cheap
    // no-server path: virtual doc keys ("virtual:chat/7") and
    // extensionless names must never claim a language.
    for (const path of [
      "notes.txt",
      "Makefile",
      ".gitignore",
      "virtual:chat/7",
      "a.b.c",
    ]) {
      expect(languageIdOf(path)).toBeNull();
    }
  });
});

describe("extensionOf", () => {
  // Consumed clauses only: the final dot-segment, lowercased — the
  // jsx grammar branch compares ".tsx"/".jsx", markdown compares
  // ".md". The dotfile case (".gitignore" → its whole name) is
  // deliberately unpinned: it feeds only null-classification paths,
  // which languageIdOf's own suite pins.
  it("returns the lowercased final dot-segment of the last path component", () => {
    expect(extensionOf("src/app.TS")).toBe(".ts");
    expect(extensionOf("a/b/c.py")).toBe(".py");
    expect(extensionOf("Makefile")).toBe("");
  });
});
