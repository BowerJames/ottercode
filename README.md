# ottercode

A local AI text editor powered by [pi-coding-agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent).

## Stack

| Layer | Choice |
| --- | --- |
| Shell | Electron (main process = Node.js, runs the pi SDK in-process) |
| Build/dev | electron-vite (Vite) |
| UI | React + TypeScript (strict) |
| Editor component | CodeMirror 6 *(planned)* |
| State | Zustand *(planned)* |
| Tests | Vitest (Playwright for E2E later) |
| Lint/format | Biome |
| Distribution | npm global install providing the `ottercode` command |

### Architecture

See [DEVELOPMENT.md](DEVELOPMENT.md) for the developer guide: code
layout, module responsibilities, and IPC contract rules. Summary:

- **Main process** (`src/main`) — full Node.js access. Owns the pi
  `AgentSession`, model runtime, and session/settings managers. The pi SDK
  must never be imported from the renderer.
- **Renderer** (`src/renderer`) — browser context. Pure UI. Talks to the main
  process over IPC (preload bridge to be added with the first IPC surface).
- **Package style** — ESM-only (`"type": "module"`).

## Getting started

Requires Node.js >= 22.19 (see `.nvmrc`).

```bash
npm install
npm run dev        # opens the app with HMR on the renderer
```

> **WSL note:** if your WSL distro defaults to a root user, Chromium's
> sandbox cannot start (it aborts before any app code runs). The `dev`
> script and the `ottercode` bin detect root and set
> `ELECTRON_DISABLE_SANDBOX=1` automatically, so `npm run dev` just works.
> The clean fix is a non-root default WSL user.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Run the app in dev mode (Vite HMR for renderer) |
| `npm run build` | Build main + renderer to `out/` |
| `npm start` | Run the built app with Electron |
| `npm run typecheck` | `tsc --noEmit` for main + renderer configs |
| `npm run lint` | Biome lint + format check |
| `npm run format` | Biome format (write) |
| `npm test` | Vitest |

## Installing the CLI locally

```bash
npm link
ottercode
```

When published, `npm i -g ottercode` provides the `ottercode` command.

## pi integration notes

The pi SDK (`@earendil-works/pi-coding-agent`) runs in the Electron main
process so the agent, its event stream, and session state are directly
accessible with full type safety:

```ts
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
```

Agent events (`message_update`, `tool_execution_start`, ...) are forwarded to
the renderer over IPC and rendered as the editor's AI surface.

If process isolation is ever needed instead, pi also supports JSON-RPC mode
(`pi --mode rpc`); the in-process SDK is the preferred default here.
