import { usePanelSize } from "./app/use-panel-size";
import { Splitter } from "./components/Splitter";
import { AgentRail } from "./features/agent-chat/AgentRail";
import { Composer } from "./features/agent-chat/Composer";
import { EditorPane } from "./features/editor/EditorPane";
import { FileTree } from "./features/file-tree/FileTree";
import { GitBar } from "./features/git/GitBar";
import { TerminalDock } from "./features/terminal/TerminalDock";
import { VDocList } from "./features/vdocs/VDocList";

/** The shell: three panes. The left pane is a column — the tree fills
 * it, the git bar docks to its bottom. The center column stacks
 * editor, terminal dock, composer — so features compose without
 * reaching into each other's layout. The shell owns its direct
 * children's widths (sidebar, agent rail); the dock owns its own
 * height — each container drags at its own seam. */
export function App() {
  const sidebar = usePanelSize({
    axis: "x",
    min: 180,
    max: 480,
    initial: 260,
  });
  const rail = usePanelSize({
    axis: "x",
    min: 240,
    max: 800,
    initial: 320,
    invert: true, // anchored at the right edge: drag left to widen
  });

  return (
    <div className="app-shell">
      <aside className="sidebar" style={{ width: sidebar.size }}>
        <FileTree />
        <VDocList />
        <GitBar />
      </aside>
      <Splitter
        axis="x"
        title="drag to resize — double-click to reset"
        {...sidebar.handleProps}
      />
      <main className="main-pane">
        <EditorPane />
        <TerminalDock />
        <Composer />
      </main>
      <Splitter
        axis="x"
        title="drag to resize — double-click to reset"
        {...rail.handleProps}
      />
      <AgentRail width={rail.size} />
    </div>
  );
}
