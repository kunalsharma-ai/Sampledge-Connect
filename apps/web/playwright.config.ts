import { defineConfig, devices } from '@playwright/test';

/**
 * Accessibility checks against a running web app and API (see docs/launch-readiness.md).
 *   WEB_URL=http://localhost:3000 API_URL=http://localhost:4000 pnpm --filter @sampledge/web e2e
 * CHROMIUM_PATH points at a preinstalled Chromium when the bundled one isn't downloaded.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.WEB_URL ?? 'http://localhost:3000',
    trace: 'off',
    ...(process.env.CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.CHROMIUM_PATH } }
      : {}),
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
});
