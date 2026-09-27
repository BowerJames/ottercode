import { describe, expect, it } from "vitest";
import { isMarkdownPath } from "../../../../src/renderer/features/editor/markdown";

/**
 * Permanent suite. Consumer: EditorPane — the preview/source toggle
 * gates on this classification, so a wrong verdict shows the wrong
 * document surface for that path. Load-bearing clauses: the extensions
 * that earn the preview (case-insensitively — the app classifies
 * paths, not spellings) and, structurally, that synthetic virtual keys
 * never do: a virtual doc is not a file, so it must never flip the
 * document area into preview mode.
 *
 * Windows-style separators are covered too — paths arrive from the fs
 * tree and carry whatever separator the platform uses.
 */

const CASES: [path: string, expected: boolean][] = [
  ["README.md", true],
  ["docs/notes.markdown", true],
  ["src\\APP.MD", true],
  ["src/app.ts", false],
  ["Makefile", false],
  [".gitignore", false],
  ["virtual:chat/7", false],
];

describe("isMarkdownPath", () => {
  it("classifies preview eligibility", () => {
    for (const [path, expected] of CASES) {
      expect(isMarkdownPath(path), path).toBe(expected);
    }
  });
});
