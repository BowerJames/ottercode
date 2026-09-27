import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { languageIdOf } from "../../../shared/lang/languages";
import { languageIntel } from "./use-language";

/**
 * Autocomplete, view half: a CodeMirror completion source over the
 * language service. The payload clause is the debouncer — whole
 * document content crosses per query, but only after typing settles
 * (never per keystroke). Degradation is silence: no server, no
 * completions, no interruption.
 */

/** Policy: wait for typing to settle before a request crosses. */
const COMPLETION_DEBOUNCE_MS = 200;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function completionExtension(path: string): Extension {
  if (languageIdOf(path) === null) return [];
  return autocompletion({
    override: [
      async (context: CompletionContext): Promise<CompletionResult | null> => {
        const word = context.matchBefore(/[\w$]+/);
        if (word === null || (word.from === word.to && !context.explicit)) {
          return null; // not on a word: nothing to complete
        }
        await sleep(COMPLETION_DEBOUNCE_MS);
        if (context.aborted) return null; // typing continued: superseded
        const items = await languageIntel.completion(
          path,
          context.state.doc.toString(),
          context.pos,
        );
        if (context.aborted) return null; // superseded mid-flight
        if (items.length === 0) return null;
        return {
          from: word.from,
          options: items.map((item) => ({
            label: item.label,
            apply: item.apply,
            detail: item.detail,
            // The contract's seven kinds are CodeMirror's own type
            // strings — the normalization happened at the adapter.
            type: item.kind,
          })),
          validFor: /^[\w$]*$/,
        };
      },
    ],
  });
}
