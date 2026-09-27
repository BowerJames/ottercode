import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import {
  HighlightStyle,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";

/**
 * File type → syntax support: the one place that knows which grammar a
 * path gets, how it indents, and how it's colored. A caller hands over
 * a path and receives the complete bundle — grammar, indent unit,
 * highlight style — or an empty list for unrecognized types, which
 * leaves CodeMirror's plain-text default in force. EditorPane knows
 * nothing about file types; it only forwards the path it already keys
 * its documents by.
 *
 * `extensionOf` is exported as the app's single path→extension
 * classifier: markdown.ts's preview eligibility consumes it, so a
 * file's grammar and its preview affordance can never disagree about
 * what type the path is.
 */
export function languageFor(path: string): Extension[] {
  switch (extensionOf(path)) {
    case ".py":
      // Python's four-space indent is the language's own convention;
      // CodeMirror's default unit (two) belongs to the curly-brace world.
      return [python(), indentUnit.of("    "), highlighting];
    case ".ts":
    case ".mts":
    case ".cts":
      return [javascript({ typescript: true }), highlighting];
    case ".tsx":
      return [javascript({ typescript: true, jsx: true }), highlighting];
    case ".js":
    case ".mjs":
    case ".cjs":
      return [javascript(), highlighting];
    case ".jsx":
      return [javascript({ jsx: true }), highlighting];
    default:
      return [];
  }
}

/** The final dot-segment of the path's last component, lowercased —
 * `.PY` and `app.TS` light up like their lowercase kin. Dotfiles
 * (`.gitignore`) and extensionless names (`Makefile`) match nothing. */
export function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).at(-1) ?? path;
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
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
