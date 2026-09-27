import { useEffect } from "react";
import { TreeRow } from "./TreeRow";
import { useFileTree } from "./use-file-tree";

/**
 * The workspace file tree: fills the left pane above the git bar.
 * Bootstraps itself on mount (loadRoot) and renders the root's
 * children as tree rows inside the pane's scroll area (the pane
 * itself — the aside in App — owns the column layout).
 */
export function FileTree() {
  const root = useFileTree((s) => s.root);
  const loadRoot = useFileTree((s) => s.loadRoot);

  useEffect(() => {
    void loadRoot();
  }, [loadRoot]);

  const rootName =
    root === null ? "" : (root.split(/[\\/]/).filter(Boolean).at(-1) ?? root);

  if (root === null) {
    return (
      <>
        <div className="sidebar-header">workspace</div>
        <div className="sidebar-empty">no workspace</div>
      </>
    );
  }

  return (
    <>
      <div className="sidebar-header">{rootName}</div>
      <div className="sidebar-tree">
        <RootChildren root={root} />
      </div>
    </>
  );
}

function RootChildren({ root }: { root: string }) {
  const children = useFileTree((s) => s.childrenByDir[root]);
  if (children === undefined) return null;
  return (
    <>
      {children.map((entry) => (
        <TreeRow key={entry.path} entry={entry} depth={0} />
      ))}
    </>
  );
}
