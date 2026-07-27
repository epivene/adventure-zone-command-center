import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL: "http://127.0.0.1:3105",
    storageState: process.env.PLAYWRIGHT_AUTH_STATE,
  },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3105",
    reuseExistingServer: true,
    url: "http://127.0.0.1:3105/api/health",
  },
});
