# Developer's Guide

The general rules for how ottercode's code is organized and which parts are
responsible for what. This guide pins **invariants** — boundaries and
responsibilities that shouldn't drift — and deliberately leaves
implementation choices open.

## The mental model: three worlds and a contract

ottercode is an Electron app with three execution contexts that have
different powers:

```
┌─────────────────────────────────────────┐
│  MAIN (Node.js)                         │  Everything privileged: the pi SDK,
│                                         │  file system, subprocesses, windows
├─────────────────────────────────────────┤
│  PRELOAD (the door)                     │  Tiny, mechanical: exposes the typed
│                                         │  IPC bridge to the renderer
├─────────────────────────────────────────┤
│  RENDERER (Chromium / React)            │  Pure UI: no Node, no fs, no pi
└─────────────────────────────────────────┘
```

The boundary between them is a **typed IPC contract** that lives in
`src/shared/`. Both sides depend on it; nothing crosses the boundary outside
it.

### The classification rule

Decide where code goes by **what it depends on and who consumes it**, never
by the noun it represents:

1. Needs Node/Electron APIs (`fs`, `child_process`, the pi SDK)? → `src/main/`
2. Needs the DOM? → `src/renderer/`
3. Neither, but both sides care? → `src/shared/`

## Repository layout

```
src/
├── shared/                    # Importable by both processes. No Node, Electron, or DOM.
│   ├── ipc/                   # THE contract: channels + events + typed client
│   └── …                      # Pure domain logic (e.g. text buffer ops)
│
├── main/
│   ├── agent/                 # Owns the pi AgentSession: lifecycle + event mapping
│   ├── workspace/             # File services; the authority on disk state
│   ├── ipc/                   # Glue: maps contract channels to service calls
│   └── index.ts               # Window creation + wiring only. Stays thin.
│
├── preload/
│   └── index.ts               # Exposes the contract mechanically. No logic.
│
└── renderer/
    ├── app/                   # Shell: window layout, panels, keybindings
    ├── features/              # Most UI code lives here (see below)
    ├── components/            # Dumb shared primitives (Button, Panel…)
    └── stores/                # State that pushed IPC events feed into
```

Feature directories under `renderer/features/` are created as features are
built (editor, chat, files, …) — they're examples of the pattern, not a
pre-committed list. Don't pre-scaffold empty trees anywhere.

## Responsibilities and rules

### `src/shared/` — pure domain, zero privileges

- **May import:** other `shared/` modules, dependencies that work in any JS
  environment.
- **Must not import:** `electron`, Node builtins, the pi SDK (at runtime),
  or anything DOM-shaped.
- **Contains:** the IPC contract, plus any pure logic both processes care
  about (text operations, shared domain types).
- **Note:** `import type` from the pi SDK is allowed anywhere — type-only
  imports are erased at build time. Runtime imports are what's forbidden
  outside `main/`.
- This layer is trivially testable and should carry most unit tests.

### `src/main/agent/` — the pi session owner

- Owns the pi session/runtime: lifecycle, model selection, prompts, abort,
  session replacement (new/resume/fork).
- **Translates pi's events into contract events.** The renderer never
  consumes pi event shapes. The mapping is mechanical and boring on
  purpose: pi upgrades then touch only this module, and the UI can evolve
  without pi coupling.
- Known landmine fenced here: pi subscriptions attach to a *specific*
  `AgentSession`, so after session replacement you must re-subscribe. That
  logic lives in exactly one file.
- Reports file-writing tool results (`edit`/`write`) to the workspace
  service — it does not touch buffers or the UI itself.

### `src/main/workspace/` — the disk authority

- The **single choke point for "the disk changed,"** regardless of source:
  agent edits, user saves, external editors. The UI never needs to know
  *who* changed a file.
- Tracks enough state about open documents (e.g. versions) to detect
  divergence between disk and what the renderer last saw.
- Services here are plain classes/functions with **no Electron imports** so
  they can be unit-tested without a window.

### `src/main/ipc/` — glue only

- Maps contract channels to service calls. No business logic. If a handler
  is more than a few lines, the logic belongs in a service.

### `src/preload/` — the door

- `contextBridge.exposeInMainWorld` wrapping the contract. No decisions, no
  logic, no state. If you're tempted to write an `if` here, stop.

### `src/renderer/` — UI, organized feature-first

- `features/<name>/` owns its components, hooks, and state slice together.
  The test: deleting a feature is one `rm -rf`. Cross-feature communication
  happens through stores, not imports of each other's internals.
- `components/` holds only genuinely reusable dumb primitives.
- `stores/` is the reactive spine: pushed IPC events land in stores;
  components subscribe. Request/response (`invoke`) is for boring things;
  anything streaming is push.
- **The renderer never performs privileged operations and never talks to
  main outside the typed client in `shared/ipc/`.**

## The IPC contract

Every capability the app has is declared once in `src/shared/ipc/`:

- **Channels**: request/response, named with a `domain:action` convention
  (e.g. `fs:openDocument`, `agent:prompt`), each with request and response
  schemas.
- **Events**: main → renderer push. Everything the agent does arrives this
  way. Payloads are contract-owned types, never raw pi shapes.
- **A typed client**: the only renderer-side entry to `window.ottercode`.

Rules:

- The contract grows **before** the feature lands — the diff should show the
  boundary expanding first.
- Coarse-grained payloads only. Whole contents, op batches, or patches —
  never per-keystroke traffic.
- `preload` stays in sync with the contract mechanically; if it needs to
  grow logic, the contract is wrong.

## File editing by the agent: principles, not policies

One hard constraint shapes this area, stated as fact: **pi's `edit`/`write`
tools mutate real files on disk, in the main process, while the agent
runs.** From that, two invariants follow:

1. **The disk is the source of truth; renderer buffers are views that keep
   up.** There is no world in which the agent "proposes" edits unless we
   deliberately build that on top later.
2. **All disk-change notifications route through the workspace service** —
   agent edits arrive as in-process tool events; external changes via file
   watching. Exactly one place decides what the renderer hears.

Everything beyond that — conflict handling for dirty buffers, save
concurrency, undo strategy, how live edits are displayed — is deliberately
unpinned.

## Conventions

- ESM everywhere; Node-side relative imports need `.js` extensions
  (NodeNext). Renderer uses extensionless (Bundler). See `AGENTS.md`.
- Biome owns formatting and import order — run `npm run format`, don't
  hand-format.
- `npm run typecheck` and `npm run lint` must pass before finishing any
  change; `npm test` for unit tests.
- Tests live in `test/` as `*.test.ts`, mirroring the source path
  (`src/shared/text/buffer.ts` → `test/shared/text/buffer.test.ts`).
- No barrel files or re-export indexes — direct imports keep things greppable.

## What we deliberately avoid

- **Monorepo/packages split** — `shared/` gives the isolation at zero
  tooling cost; split only if something needs independent versioning.
- **Per-keystroke IPC** — mutations are local and instant; only coarse
  operations cross the boundary.
- **Raw pi types crossing the wire** — runtime pi stays in `main/`; UI
  consumes contract events only.
- **Logic in preload or IPC handlers** — they are doors and glue.
- **Premature abstraction** — features and modules are created when first
  needed, not pre-scaffolded.