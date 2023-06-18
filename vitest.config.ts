import { defineConfig } from "vitest/config";

// https://vitest.dev/config/
export default defineConfig({
  test: {
    setupFiles: ["./src/tests/setup.ts"],
  },
});
