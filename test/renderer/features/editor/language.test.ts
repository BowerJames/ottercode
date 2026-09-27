import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { languageFor } from "../../../../src/renderer/features/editor/language";

/**
 * Permanent suite. Consumer: EditorPane — it feeds languageFor's
 * result straight into the CodeMirror extensions at mount time. The
 * load-bearing clause is that every branch yields extensions an
 * EditorState accepts: a malformed value (an empty indentUnit throws
 * during state construction) would crash the pane's mount effect for
 * that file type. One path per distinct switch branch plus the
 * unknown branch EditorPane hits most.
 *
 * Which grammar maps to which extension is deliberately unpinned —
 * that's visual, E2E's territory (as with ERROR_MESSAGES).
 */

const BRANCHES = [
  "script.py",
  "src/app.ts",
  "src/app.tsx",
  "src/main.js",
  "src/ui.jsx",
  "notes.txt",
];

describe("languageFor", () => {
  it("yields mountable extensions for every branch", () => {
    for (const path of BRANCHES) {
      expect(() =>
        EditorState.create({ extensions: languageFor(path) }),
      ).not.toThrow();
    }
  });
});
