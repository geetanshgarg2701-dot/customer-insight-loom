import { defineConfig, devices } from "@playwright/test";

// Tests the static export served under a project page prefix. Build it first:
//   STATIC_EXPORT=1 NEXT_PUBLIC_BASE_PATH=/evidence-ledger npm run build
// then: npx playwright test -c playwright.static.config.ts
export default defineConfig({
  testDir: "./e2e",
  testMatch: "static-mirror.spec.ts",
  reporter: "list",
  use: { baseURL: "http://localhost:3100/evidence-ledger/" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: process.env.PW_CHANNEL } }],
  webServer: {
    command: "node scripts/serve-static-mirror.mjs /evidence-ledger 3100",
    url: "http://localhost:3100/evidence-ledger/",
    reuseExistingServer: !process.env.CI,
  },
});
