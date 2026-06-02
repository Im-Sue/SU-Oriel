import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true
      }
    },
    globalSetup: ["./scripts/setup-test-db.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage",
      all: true,
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.spec.ts", "src/**/*.test.ts", "src/**/*.d.ts"]
    }
  }
});
