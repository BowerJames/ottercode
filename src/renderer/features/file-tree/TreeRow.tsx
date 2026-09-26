import type { FileEntry } from "../../../shared/ipc/fs";
import { useFileTree } from "./use-file-tree";

/**
 * One row of the tree: a file leaf or an expandable directory. The row
 * is a real button, so keyboard activation comes for free; full tree
 * keyboard navigation (arrows, typeahead) is a deliberate later
 * affordance — proper role="tree" semantics arrive with it, not before.
 */
export function TreeRow({ entry, depth }: { entry: FileEntry; depth: number }) {
  const expanded = useFileTree((s) => s.expandedDirs[entry.path] === true);
  const selected = useFileTree((s) => s.selectedEntry?.path === entry.path);
  const toggle = useFileTree((s) => s.toggle);
  const select = useFileTree((s) => s.select);
  const isDir = entry.kind === "directory";

  return (
    <div>
      <button
        type="button"
        className="tree-row"
        data-selected={selected}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => {
          select(entry);
          if (isDir) void toggle(entry.path);
        }}
      >
        <span className="tree-twist">
          {isDir ? (expanded ? "▾" : "▸") : ""}
        </span>
        <span className="tree-name">{entry.name}</span>
      </button>
      {isDir && expanded && (
        <TreeChildren path={entry.path} depth={depth + 1} />
      )}
    </div>
  );
}

/** Renders the cached children of one directory. */
function TreeChildren({ path, depth }: { path: string; depth: number }) {
  const children = useFileTree((s) => s.childrenByDir[path]);
  if (children === undefined) return null; // defensive: invariant says unreachable
  return (
    <>
      {children.map((entry) => (
        <TreeRow key={entry.path} entry={entry} depth={depth} />
      ))}
    </>
  );
}
