import { EditorPane } from "./features/editor/EditorPane";
import { FileTree } from "./features/file-tree/FileTree";

export function App() {
  return (
    <div className="app-shell">
      <FileTree />
      <main className="main-pane">
        <EditorPane />
      </main>
    </div>
  );
}
