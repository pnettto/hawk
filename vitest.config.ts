import { defineConfig } from "vitest/config";

// Backend unit tests only. The frontend has its own config in app/.
export default defineConfig({
  test: { include: ["server/**/*.test.ts"] },
});
