import { defineConfig } from "vitest/config";

export default defineConfig({
  // Renderer sources use the automatic JSX runtime (tsconfig web +
  // vite); the same transform must apply when tests import .tsx
  // modules — esbuild's default (classic) would demand a React import
  // the sources don't have.
  esbuild: { jsx: "automatic" },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
