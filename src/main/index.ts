import { existsSync } from "node:fs";
import path from "node:path";
import { app, BrowserWindow } from "electron";
import {
  AGENT_EVENTS_CHANNEL,
  TERMINAL_EVENTS_CHANNEL,
} from "../shared/ipc/channels.js";
import { AgentService } from "./agent/agent-service.js";
import { claudeProvider } from "./agent/providers/claude.js";
import { piProvider } from "./agent/providers/pi.js";
import { registerAgentIpc } from "./ipc/register-agent-ipc.js";
import { registerFsIpc } from "./ipc/register-fs-ipc.js";
import { registerGitIpc } from "./ipc/register-git-ipc.js";
import { registerLangIpc } from "./ipc/register-lang-ipc.js";
import { registerTerminalIpc } from "./ipc/register-terminal-ipc.js";
import { LanguageService } from "./language/language-service.js";
import { createStdioConnection } from "./language/real-lsp-connection.js";
import { createServerResolver } from "./language/server-resolver.js";
import { createLspEngine } from "./language/stdio-lsp-engine.js";
import { realTerminalSpawner } from "./terminal/real-terminal-spawner.js";
import { TerminalService } from "./terminal/terminal-service.js";
import { readGitStatus } from "./workspace/git-status.js";
import { realGitRunner } from "./workspace/real-git-runner.js";
import { realWorkspaceFs } from "./workspace/real-workspace-fs.js";
import { WorkspaceService } from "./workspace/workspace-service.js";

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    title: "ottercode",
    show: false,
    webPreferences: {
      // ESM preload (.mjs) requires a unsandboxed renderer in Electron >= 28.
      preload: path.join(import.meta.dirname, "../preload/index.mjs"),
      sandbox: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(path.join(import.meta.dirname, "../renderer/index.html"));
  }

  return win;
}

app.whenReady().then(async () => {
  const workspace = new WorkspaceService(process.cwd(), realWorkspaceFs);
  registerFsIpc(workspace);
  // One source of workspace root: the git read always agrees with the
  // fs services, whichever was constructed first.
  registerGitIpc(() => readGitStatus(workspace.getRoot(), realGitRunner));

  // Language intelligence degrades silently when a server binary is
  // missing — the editor works without it, the queries just refuse
  // with no-server. Everything environment-shaped is injected here,
  // the composition root, so the services stay pure.
  registerLangIpc(
    new LanguageService({
      resolver: createServerResolver({
        root: workspace.getRoot(),
        exists: existsSync,
        pathDirs: () => (process.env.PATH ?? "").split(path.delimiter),
        now: Date.now,
      }),
      createEngine: (_language, command) =>
        createLspEngine({
          root: workspace.getRoot(),
          connection: createStdioConnection(command, workspace.getRoot()),
          readFile: (filePath) => realWorkspaceFs.readFile(filePath),
        }),
    }),
  );

  const win = createWindow();

  // The terminal works regardless of agent auth — one command at a
  // time in the workspace root, events pushed to the renderer.
  const terminal = new TerminalService(
    workspace.getRoot(),
    realTerminalSpawner,
    (event) => {
      win.webContents.send(TERMINAL_EVENTS_CHANNEL, event);
    },
  );
  registerTerminalIpc(terminal);

  // The agent is created after the window so the app stays usable when
  // no provider auth is configured — the editor and tree work; the
  // composer just has nothing to talk to yet.
  try {
    const agent = await AgentService.create(
      process.cwd(),
      { pi: piProvider, claude: claudeProvider },
      "pi",
      (event) => {
        win.webContents.send(AGENT_EVENTS_CHANNEL, event);
      },
    );
    registerAgentIpc(agent);
  } catch (error) {
    console.error("agent unavailable:", error);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
