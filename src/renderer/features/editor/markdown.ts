import { extensionOf } from "../../../shared/lang/languages";

/**
 * Path → preview affordance: the one place that knows which files earn
 * the editor's markdown preview. Consumer: EditorPane — it gates the
 * header's preview/source toggle on this. Classification rides
 * language.ts's extensionOf, so a path's type can never be judged
 * differently here than it is for grammar selection. Synthetic
 * virtual keys (`virtual:chat/7`) match nothing — the preview is a
 * file affordance; snapshots don't get one.
 */
export function isMarkdownPath(path: string): boolean {
  const ext = extensionOf(path);
  return ext === ".md" || ext === ".markdown";
}
