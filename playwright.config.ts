import { defineConfig, devices } from '@playwright/test'

// E2E runs against the generated static output, so the production CSP is the one
// under test. `npm run test:e2e` generates first.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'dot' : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  // Chromium only: the File System Access API is the reason this project exists.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run serve:static',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
