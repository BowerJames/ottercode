#!/usr/bin/env node
// Launches the ottercode Electron app. Used as the `ottercode` bin entry,
// so `npm i -g ottercode` (or `npm link`) gives users the command.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");

// Electron resolves a relative app path against the *user's* cwd, so "." would
// point at whatever directory they launched from. Resolve the ottercode
// package root (bin/..) absolutely; the user's cwd is still inherited by the
// child and used as the workspace.
const appPath = fileURLToPath(new URL("..", import.meta.url));

// Chromium's sandbox cannot run as root (e.g. WSL distros defaulting to a
// root user). The failure happens before app JS runs, so the env var is the
// only way through. No-op for normal non-root users.
const env = { ...process.env };
if (process.platform !== "win32" && process.getuid?.() === 0) {
  env.ELECTRON_DISABLE_SANDBOX ??= "1";
}

const result = spawnSync(electronBinary, [appPath], { stdio: "inherit", env });
process.exit(result.status ?? 1);
