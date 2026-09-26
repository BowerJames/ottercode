import { FileTree } from "./features/file-tree/FileTree";

export function App() {
  return (
    <div className="app-shell">
      <FileTree />
      <main className="main-pane">
        <h1>ottercode</h1>
      </main>
    </div>
  );
}
