import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.git/**", "e2e/**"],
    alias: { "@/": new URL("./src/", import.meta.url).pathname },
  },
});
