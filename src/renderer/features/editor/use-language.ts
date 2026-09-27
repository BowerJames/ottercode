import { client } from "../../ipc";
import { createLanguageIntel } from "./language-intel";
import { useEditor } from "./use-editor";

/**
 * The feature's language-intelligence composition root: the one place
 * the real client singleton is joined to the editor store hook.
 * Components and extensions import this; language-intel.ts stays pure
 * and testable.
 */
export const languageIntel = createLanguageIntel({
  lang: client.lang,
  editor: useEditor,
});
