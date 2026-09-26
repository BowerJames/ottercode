# AGENTS.md

Guidance for coding agents (like pi) working in this repository.

## Commands

- `npm run dev` — run the Electron app with renderer HMR
- `npm run build` — build main + renderer to `out/`
- `npm start` — launch the built app
- `npm run typecheck` — typecheck main + renderer (must pass before finishing)
- `npm run lint` — Biome check (must pass before finishing)
- `npm run format` — apply Biome formatting
- `npm test` — Vitest

## Architecture

- **Electron app**, ESM-only (`"type": "module"`).
- `src/main/` — Electron main process (Node.js). The pi SDK
  (`@earendil-works/pi-coding-agent`) is imported **only** here.
- `src/renderer/` — React UI (browser context). No Node APIs, no pi imports.
  Communicates with main over IPC via a preload bridge.
- `bin/ottercode.mjs` — CLI entry that spawns Electron; wired as the
  `ottercode` bin.

## Conventions

- TypeScript strict mode; keep `noUncheckedIndexedAccess` and
  `verbatimModuleSyntax` enabled.
- Node-side code (main process, bin, tests) uses `NodeNext` resolution:
  relative imports must include the `.js` extension.
- Renderer uses Bundler resolution (Vite): extensionless relative imports.
- Formatting/lint is Biome — run `npm run format` rather than hand-formatting.
- Tests live in `test/` as `*.test.ts`.
- Node >= 22.19 is required (pi dependency); don't lower `engines`.
