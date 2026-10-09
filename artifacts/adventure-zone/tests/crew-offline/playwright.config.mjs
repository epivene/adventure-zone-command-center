import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.mjs",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  outputDir: "../../../../tmp/crew-offline-results",
  use: {
    baseURL: "http://127.0.0.1:4179",
    serviceWorkers: "allow",
    trace: "retain-on-failure",
    launchOptions: {
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
        : {}),
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command: "node tests/crew-offline/server.mjs",
    cwd: new URL("../..", import.meta.url).pathname,
    url: "http://127.0.0.1:4179/__test/state",
    reuseExistingServer: false,
  },
});
