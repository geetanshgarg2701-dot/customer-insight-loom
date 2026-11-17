import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Ledger and demo tests take 0.5 to 2 s alone but passed 5 s when 49 files run at once. The speed guards that
    // matter (time.test.ts) assert their own limits, so this only stops a loaded machine from failing slow tests.
    testTimeout: 30_000,
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.git/**", "e2e/**"],
    alias: { "@/": new URL("./src/", import.meta.url).pathname },
  },
});
