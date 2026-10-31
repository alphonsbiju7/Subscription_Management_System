import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 60000,
    include: ["tests/**/*.test.ts"],
    env: { NODE_ENV: "test" },
    maxWorkers: 2,
  },
});
