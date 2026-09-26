import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Remove once real tests exist.
    passWithNoTests: true,
  },
});
