import { AgentRail } from "./features/agent-chat/AgentRail";
import { Composer } from "./features/agent-chat/Composer";
import { EditorPane } from "./features/editor/EditorPane";
import { FileTree } from "./features/file-tree/FileTree";
import { GitBar } from "./features/git/GitBar";
import { TerminalDock } from "./features/terminal/TerminalDock";

/** The shell: three panes. The left pane is a column — the tree fills
 * it, the git bar docks to its bottom. The center column stacks
 * editor, terminal dock, composer — so features compose without
 * reaching into each other's layout. */
export function App() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <FileTree />
        <GitBar />
      </aside>
      <main className="main-pane">
        <EditorPane />
        <TerminalDock />
        <Composer />
      </main>
      <AgentRail />
    </div>
  );
}
