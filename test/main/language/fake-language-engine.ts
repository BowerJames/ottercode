import type {
  DocOverlay,
  LanguageEngine,
} from "../../../src/main/language/language-engine.js";
import type { LangPosition } from "../../../src/shared/ipc/lang.js";

/**
 * Scriptable fake for the LanguageEngine seam. Each method's behaviour
 * is a mutable impl field the test assigns (default: emptiness); every
 * call is recorded with its full arguments. `disposed` mirrors the
 * lifecycle obligation the service owns. Assign an impl that never
 * resolves to simulate a hung server for the timeout paths.
 */

export class FakeLanguageEngine implements LanguageEngine {
  definitionCalls: Array<{
    path: string;
    content: string;
    position: LangPosition;
  }> = [];
  renameCalls: Array<{
    path: string;
    content: string;
    position: LangPosition;
    newName: string;
    overlay: DocOverlay;
  }> = [];
  completionCalls: Array<{
    path: string;
    content: string;
    position: LangPosition;
  }> = [];
  disposed = false;

  definitionImpl: LanguageEngine["definition"] = async () => null;
  renameImpl: LanguageEngine["rename"] = async () => null;
  completionsImpl: LanguageEngine["completions"] = async () => [];

  definition(
    path: string,
    content: string,
    position: LangPosition,
  ): ReturnType<LanguageEngine["definition"]> {
    this.definitionCalls.push({ path, content, position });
    return this.definitionImpl(path, content, position);
  }

  rename(
    path: string,
    content: string,
    position: LangPosition,
    newName: string,
    overlay: DocOverlay,
  ): ReturnType<LanguageEngine["rename"]> {
    this.renameCalls.push({ path, content, position, newName, overlay });
    return this.renameImpl(path, content, position, newName, overlay);
  }

  completions(
    path: string,
    content: string,
    position: LangPosition,
  ): ReturnType<LanguageEngine["completions"]> {
    this.completionCalls.push({ path, content, position });
    return this.completionsImpl(path, content, position);
  }

  dispose(): void {
    this.disposed = true;
  }
}
