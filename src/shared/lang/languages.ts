/**
 * The app's single path→language classifier, imported by BOTH
 * processes: the renderer gates grammar bundles and language-intel
 * extensions on it, main routes requests to language servers by it.
 * One classifier means a file's grammar and its server can never
 * disagree about what the file is.
 *
 * `extensionOf` (moved here from the renderer's language.ts when main
 * grew a second consumer) stays the primitive: the final dot-segment
 * of the last path component, lowercased. Dotfiles and extensionless
 * names match nothing — deliberately, so synthetic editor keys
 * ("virtual:chat/7") can never claim a language.
 */

export type LanguageId = "typescript" | "javascript" | "python";

export function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).at(-1) ?? path;
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

export function languageIdOf(path: string): LanguageId | null {
  switch (extensionOf(path)) {
    case ".py":
      return "python";
    case ".ts":
    case ".mts":
    case ".cts":
    case ".tsx":
      return "typescript";
    case ".js":
    case ".mjs":
    case ".cjs":
    case ".jsx":
      return "javascript";
    default:
      return null;
  }
}
