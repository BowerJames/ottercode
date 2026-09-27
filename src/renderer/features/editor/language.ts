import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import {
  HighlightStyle,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";
import { extensionOf, languageIdOf } from "../../../shared/lang/languages";

/**
 * File type → syntax support over the SHARED classifier
 * (shared/lang/languages): the one place that knows which grammar a
 * path gets, how it indents, and how it's colored. A caller hands over
 * a path and receives the complete bundle — grammar, indent unit,
 * highlight style — or an empty list for unrecognized types, which
 * leaves CodeMirror's plain-text default in force. EditorPane knows
 * nothing about file types; it only forwards the path it already keys
 * its documents by.
 *
 * `extensionOf` is re-exported for the renderer's existing consumers
 * (markdown.ts's preview eligibility), so a file's grammar and its
 * preview affordance can never disagree about what type the path is —
 * and main's language-server routing classifies through the very same
 * primitive.
 */
export { extensionOf } from "../../../shared/lang/languages";

export function languageFor(path: string): Extension[] {
  switch (languageIdOf(path)) {
    case "python":
      // Python's four-space indent is the language's own convention;
      // CodeMirror's default unit (two) belongs to the curly-brace world.
      return [python(), indentUnit.of("    "), highlighting];
    case "typescript":
    case "javascript": {
      // One server serves both languages; the grammar still differs
      // per dialect — JSX-ness rides the extension, TS-ness the id.
      const ext = extensionOf(path);
      const jsx = ext === ".tsx" || ext === ".jsx";
      return [
        javascript({ typescript: languageIdOf(path) === "typescript", jsx }),
        highlighting,
      ];
    }
    default:
      return [];
  }
}

// Dark+-inspired palette to sit beside the editor theme's #d4d4d4
// foreground on its dark background. Resolution is most-specific-tag-
// first: a function-call name carries both function(variableName) and
// variableName tags, and the function rule wins because it matches the
// earlier, more specific tag — not because of array order.
const highlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.comment, color: "#6a9955", fontStyle: "italic" },
    { tag: [t.keyword, t.moduleKeyword], color: "#569cd6" },
    { tag: [t.controlKeyword, t.operatorKeyword], color: "#c586c0" },
    { tag: [t.string, t.special(t.string)], color: "#ce9178" },
    { tag: [t.number, t.bool, t.null], color: "#b5cea8" },
    {
      tag: [t.className, t.typeName, t.namespace, t.self, t.atom],
      color: "#4ec9b0",
    },
    { tag: [t.variableName, t.propertyName], color: "#9cdcfe" },
    {
      tag: [t.function(t.variableName), t.function(t.propertyName)],
      color: "#dcdcaa",
    },
    {
      tag: [t.definition(t.variableName), t.definition(t.propertyName)],
      color: "#9cdcfe",
    },
    // JSX/HTML vocabulary — the tsx branch needs it.
    { tag: t.tagName, color: "#569cd6" },
    { tag: t.attributeName, color: "#9cdcfe" },
    {
      tag: [t.operator, t.punctuation, t.bracket, t.separator],
      color: "#d4d4d4",
    },
    { tag: t.invalid, color: "#f44747" },
  ]),
);
