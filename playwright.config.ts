import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const PORT = Number(process.env.PORT ?? 3001);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const useSystemEdge = process.env.CI !== 'true' && process.env.PLAYWRIGHT_CHANNEL !== 'chromium';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: useSystemEdge ? 'edge' : 'chromium',
      use: {
        browserName: 'chromium',
        channel: useSystemEdge ? 'msedge' : undefined,
        viewport: {
          width: 1440,
          height: 960,
        },
      },
    },
  ],
});
