import { defineConfig } from '@playwright/test';
import webpush from 'web-push';
import { configureE2EDatabaseEnv } from './e2e/support/e2e-env';

configureE2EDatabaseEnv();

process.env.VITE_DISABLE_RECAPTCHA = 'true';
process.env.RECAPTCHA_SKIP_VERIFY = 'true';
process.env.CRON_SECRET ||= 'e2e-cron-secret-with-enough-entropy';

if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
  const vapidKeys = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = vapidKeys.publicKey;
  process.env.VAPID_PRIVATE_KEY = vapidKeys.privateKey;
}

process.env.VAPID_SUBJECT ||= 'mailto:e2e@example.com';

const PORT = Number(process.env.PORT ?? 3001);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const useSystemEdge = process.env.CI !== 'true' && process.env.PLAYWRIGHT_CHANNEL !== 'chromium';
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === 'true' || process.env.CI !== 'true';

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
    command: 'npm run dev:e2e',
    url: baseURL,
    reuseExistingServer,
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
