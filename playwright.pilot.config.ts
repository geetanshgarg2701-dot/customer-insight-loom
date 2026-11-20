import { defineConfig, devices } from "@playwright/test";

/**
 * Pilot account tests. The app is built with a made up project address, https://pilot-mock.test, and the browser is
 * given a fake service for that address, so no real project is ever contacted. Run it on its own, not alongside the main
 * suite, because both start a dev server from the same folder: npm run test:pilot
 */
export default defineConfig({
  testDir: "./e2e-pilot",
  retries: 0,
  reporter: "list",
  use: { baseURL: "http://localhost:3100" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: process.env.PW_CHANNEL } }],
  webServer: {
    command: "npx next dev -p 3100",
    url: "http://localhost:3100",
    timeout: 120 * 1000,
    reuseExistingServer: false,
    env: { NEXT_PUBLIC_SUPABASE_URL: "https://pilot-mock.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_mock" },
  },
});
