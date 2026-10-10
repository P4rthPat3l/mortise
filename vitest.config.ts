import { defineConfig } from "vitest/config"

// One test run for the whole repo. Tests live next to the code as *.test.ts(x).
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.{ts,tsx}", "apps/*/src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    passWithNoTests: true,
    environment: "node",
  },
})
