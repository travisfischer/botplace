import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // Mirror the `@/*` path alias from tsconfig.json so tests can
      // import code the same way the runtime does.
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts", "lib/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts", "lib/**/*.ts", "app/**/*.ts"],
      exclude: ["**/*.test.ts", "generated/**", "tests/**"],
      // Floors, not ceilings — raise as we add coverage. These match the
      // current lower-bound set by the M1-polish T2 fixture; the load-
      // bearing modules (`src/`, `lib/`) sit comfortably above. App-route
      // coverage is paced by the `tests/api/*` fixtures growing.
      thresholds: {
        statements: 70,
        branches: 60,
        functions: 70,
        lines: 70,
      },
    },
  },
});
