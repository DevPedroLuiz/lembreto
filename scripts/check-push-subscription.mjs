import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.LEMBRETO_BASE_URL ?? 'http://127.0.0.1:3001';
const timestamp = Date.now();
const email = process.env.LEMBRETO_TEST_EMAIL ?? `push-check-${timestamp}@example.com`;
const password = process.env.LEMBRETO_TEST_PASSWORD ?? 'CodexPush123!';
const name = process.env.LEMBRETO_TEST_NAME ?? 'Push Check';

const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lembreto-push-'));

const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'msedge',
  headless: true,
  permissions: ['notifications'],
});

const page = await context.newPage();

page.on('console', (message) => {
  console.log(`[console:${message.type()}] ${message.text()}`);
});

page.on('pageerror', (error) => {
  console.error(`[pageerror] ${error.message}`);
});

const subscriptionRequests = [];
const failedRequests = [];
const notificationsResponses = [];
page.on('request', (request) => {
  if (request.url().includes('/api/notifications/push-subscriptions')) {
    subscriptionRequests.push({
      phase: 'started',
      url: request.url(),
      method: request.method(),
      postData: request.postData(),
    });
  }
});

page.on('requestfinished', async (request) => {
  if (!request.url().includes('/api/notifications/push-subscriptions')) return;

  const response = await request.response();
  subscriptionRequests.push({
    phase: 'finished',
    url: request.url(),
    method: request.method(),
    status: response?.status(),
  });
});

page.on('requestfailed', (request) => {
  if (!request.url().includes('/api/notifications/push-subscriptions')) return;

  failedRequests.push({
    url: request.url(),
    method: request.method(),
    failure: request.failure(),
  });
});

page.on('response', async (response) => {
  if (!response.url().includes('/api/notifications') || response.request().method() !== 'GET') {
    return;
  }

  try {
    const json = await response.json();
    notificationsResponses.push({
      url: response.url(),
      status: response.status(),
      body: json,
    });
  } catch {
    notificationsResponses.push({
      url: response.url(),
      status: response.status(),
      body: null,
    });
  }
});

await page.goto(baseUrl, { waitUntil: 'networkidle' });

await page.getByTestId('auth-mode-toggle').click();
await page.getByTestId('register-name-input').fill(name);
await page.getByTestId('auth-email-input').fill(email);
await page.getByTestId('auth-password-input').fill(password);
await page.getByTestId('auth-submit-button').click();

await page.waitForSelector('[data-testid="sidebar-dashboard"]', { timeout: 30000 });

await page.waitForResponse(
  (response) =>
    response.url().includes('/api/notifications/push-subscriptions')
    && response.request().method() === 'POST',
  { timeout: 15000 },
).catch(() => null);

await page.waitForTimeout(1500);

const diagnostics = await page.evaluate(async () => {
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = registration
    ? await registration.pushManager.getSubscription()
    : null;

  return {
    notificationPermission: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
    serviceWorkerController: Boolean(navigator.serviceWorker.controller),
    registrationFound: Boolean(registration),
    subscriptionFound: Boolean(subscription),
    subscriptionEndpoint: subscription?.endpoint ?? null,
  };
});

console.log(JSON.stringify({
  diagnostics,
  notificationsResponses,
  subscriptionRequests,
  failedRequests,
}, null, 2));

await context.close();
