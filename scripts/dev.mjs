#!/usr/bin/env node
// Dev launcher for `npm run dev`.
//
// Chromium's OS sandbox refuses to start as root, which happens in WSL
// distros that default to a root user. The check fires before any app JS
// runs, so the only effective workaround is setting ELECTRON_DISABLE_SANDBOX
// in the environment before Electron spawns. Dev only: packaged builds and
// non-root users are unaffected.
import { spawn } from "node:child_process";

const env = { ...process.env };
if (process.platform !== "win32" && process.getuid?.() === 0) {
  env.ELECTRON_DISABLE_SANDBOX ??= "1";
}

const child = spawn("electron-vite", ["dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
