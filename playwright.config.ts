import { defineConfig, devices } from "@playwright/test";

const host = "127.0.0.1";
const webPort = Number.parseInt(process.env.CCB_E2E_WEB_PORT ?? "15173", 10);
const apiPort = Number.parseInt(process.env.CCB_E2E_API_PORT ?? "13030", 10);
const baseURL = process.env.CCB_E2E_BASE_URL ?? `http://${host}:${webPort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL,
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: "pnpm --filter su-oriel-server exec tsx ../e2e/harness.ts",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      CCB_E2E_WEB_PORT: String(webPort),
      CCB_E2E_API_PORT: String(apiPort),
      CCB_E2E_BASE_URL: baseURL,
      CCB_E2E_API_BASE_URL: process.env.CCB_E2E_API_BASE_URL ?? `http://${host}:${apiPort}`
    }
  }
});
