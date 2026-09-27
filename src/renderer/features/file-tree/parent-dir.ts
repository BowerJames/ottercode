/**
 * Parent directory of an absolute path — renderer-side path math
 * (the renderer has no node:path). Accepts both separators, since
 * entry paths are produced by main's path.join and the app runs on
 * Windows too. Returns "" when no separator remains — defensive:
 * callers compare the result against listed directory paths, which
 * are never "", so an unmatchable parent degrades to "unverifiable",
 * never to a wrong match.
 */
export function parentDir(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, "");
  const i = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (i < 0) return "";
  if (i === 0) return trimmed.slice(0, 1); // "/x" → "/"
  return trimmed.slice(0, i);
}
