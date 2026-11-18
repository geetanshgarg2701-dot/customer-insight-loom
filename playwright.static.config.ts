import { defineConfig, devices } from "@playwright/test";

// Tests the static export served under a project page prefix. Build it first:
//   npm run build:static -- evidence-ledger
// Another prefix: set MIRROR_PREFIX to it, for example MIRROR_PREFIX=evidence-ledger-app.
// then: npx playwright test -c playwright.static.config.ts
const prefix = process.env.MIRROR_PREFIX ?? "evidence-ledger";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "static-mirror.spec.ts",
  reporter: "list",
  use: { baseURL: `http://localhost:3100/${prefix}/` },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: process.env.PW_CHANNEL } }],
  webServer: {
    command: `node scripts/serve-static-mirror.mjs /${prefix} 3100`,
    url: `http://localhost:3100/${prefix}/`,
    reuseExistingServer: !process.env.CI,
  },
});
