import { AgentRail } from "./features/agent-chat/AgentRail";
import { Composer } from "./features/agent-chat/Composer";
import { EditorPane } from "./features/editor/EditorPane";
import { FileTree } from "./features/file-tree/FileTree";

export function App() {
  return (
    <div className="app-shell">
      <FileTree />
      <main className="main-pane">
        <EditorPane />
        <Composer />
      </main>
      <AgentRail />
    </div>
  );
}
