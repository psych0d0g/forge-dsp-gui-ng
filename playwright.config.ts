// End-to-end tests (tests/e2e): the built page (dist/) in a real browser against the simulator of
// the firmware (tests/sim, scripts/build-sim.sh). Run `npm run build` first; PW_CHROMIUM may name a
// Chromium of the system instead of the one Playwright downloads.
import { defineConfig, devices } from "@playwright/test";

const port = 4180;
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,                      // one simulator per page, but keep the CI runner calm
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${port}/`,
    trace: "retain-on-failure",
    locale: "de-DE",                // the tests click German labels; tests/e2e/english.spec.ts sets English
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] }, testMatch: /layout\.spec\.ts/ },
  ],
  webServer: {
    command: `node scripts/serve-e2e.mjs ${port}`,
    port,
    reuseExistingServer: !process.env.CI,
  },
});
