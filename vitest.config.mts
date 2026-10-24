import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": root("./") },
  },
  test: {
    include: ["lib/**/*.test.ts", "app/**/*.test.ts", "mcp/**/*.test.ts", "*.test.ts"],
    // The first date formatting loads ICU data, which can take over 5 s on a cold Windows CI runner.
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts", "app/api/**/*.ts", "proxy.ts"],
      exclude: ["**/*.test.ts"],
      reporter: ["text-summary", "text", "json-summary"],
      // Raised as the port grows; CI fails when a change drops coverage below these.
      thresholds: { statements: 90, branches: 85, functions: 90, lines: 90 },
    },
  },
});
