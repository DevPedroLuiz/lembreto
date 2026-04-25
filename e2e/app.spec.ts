import { test, expect, type Page, type Response } from '@playwright/test';
import {
  blacklistToken,
  buildE2ETestUser,
  cleanupUsersByEmail,
  seedCustomTasksForUser,
  seedPasswordResetToken,
  seedTasksForUser,
  type E2ETestUser,
} from './support/test-data';

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yf6QAAAAASUVORK5CYII=',
  'base64',
);

function formatDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
}

async function waitForJsonResponse(
  page: Page,
  matcher: (response: Response) => boolean,
): Promise<Record<string, any>> {
  const response = await page.waitForResponse(matcher);
  return response.json() as Promise<Record<string, any>>;
}

async function registerUser(page: Page, user: E2ETestUser): Promise<string> {
  await page.goto('/');

  const registerResponsePromise = waitForJsonResponse(
    page,
    (response) =>
      response.url().includes('/api/auth/register') &&
      response.request().method() === 'POST',
  );

  await page.getByTestId('auth-mode-toggle').click();
  await page.getByTestId('register-name-input').fill(user.name);
  await page.getByTestId('auth-email-input').fill(user.email);
  await page.getByTestId('auth-password-input').fill(user.password);
  await page.getByTestId('auth-submit-button').click();

  const registerPayload = await registerResponsePromise;
  await expect(page.getByTestId('sidebar-dashboard')).toBeVisible();
  return String(registerPayload.token);
}

async function loginUser(page: Page, email: string, password: string): Promise<string> {
  await page.goto('/');

  const loginResponsePromise = waitForJsonResponse(
    page,
    (response) =>
      response.url().includes('/api/auth/login') &&
      response.request().method() === 'POST',
  );

  await page.getByTestId('auth-email-input').fill(email);
  await page.getByTestId('auth-password-input').fill(password);
  await page.getByTestId('auth-submit-button').click();

  const loginPayload = await loginResponsePromise;
  await expect(page.getByTestId('sidebar-dashboard')).toBeVisible();
  return String(loginPayload.token);
}

async function loginUserWithRememberedEmail(
  page: Page,
  email: string,
  password: string,
): Promise<string> {
  await page.goto('/');

  const loginResponsePromise = waitForJsonResponse(
    page,
    (response) =>
      response.url().includes('/api/auth/login') &&
      response.request().method() === 'POST',
  );

  await page.getByTestId('auth-email-input').fill(email);
  await page.getByTestId('auth-password-input').fill(password);
  await page.getByTestId('remember-email-checkbox').check();
  await page.getByTestId('auth-submit-button').click();

  const loginPayload = await loginResponsePromise;
  await expect(page.getByTestId('sidebar-dashboard')).toBeVisible();
  return String(loginPayload.token);
}

async function createTask(page: Page, title: string, options?: { time?: string }): Promise<void> {
  await page.getByTestId('sidebar-tasks').click();
  await page.getByTestId('new-task-button').click();
  await page.getByTestId('task-title-input').fill(title);
  await page.getByTestId('task-description-input').fill('Fluxo automatizado de ponta a ponta.');
  await page.getByTestId('task-date-input').fill(formatDateLocal(new Date(Date.now() + 24 * 60 * 60 * 1000)));
  if (options?.time) {
    await page.getByTestId('task-time-select').selectOption(options.time);
  }
  await page.getByTestId('task-priority-select').selectOption('high');
  await page.getByTestId('task-category-select').selectOption('Trabalho');
  await page.getByTestId('task-submit-button').click();
}

function taskCard(page: Page, title: string) {
  return page.locator(`[data-testid="task-item"][data-task-title="${title}"]`).first();
}

async function expectFirstTaskTitle(page: Page, title: string): Promise<void> {
  await expect(page.locator('[data-testid="task-item"]').first()).toHaveAttribute('data-task-title', title);
}

test.describe('Lembreto critical flows', () => {
  test('registers, manages tasks, resets password and logs in again', async ({ page }) => {
    const user = buildE2ETestUser();

    await cleanupUsersByEmail([user.email]);

    try {
      await registerUser(page, user);

      const initialTaskTitle = 'Planejar release E2E';
      const updatedTaskTitle = 'Planejar release E2E revisado';

      await createTask(page, initialTaskTitle, { time: '08:00' });

      const createdTask = taskCard(page, initialTaskTitle);
      await expect(createdTask).toBeVisible();
      await expect(createdTask.getByTestId('task-time-badge')).toHaveText('08:00');
      await expect(createdTask.getByTestId('task-due-badge')).toHaveAttribute('title', 'Horario: 08:00');

      await createdTask.click();
      await page.getByTestId('task-title-input').fill(updatedTaskTitle);
      await page.getByTestId('task-category-select').selectOption('Estudos');
      await page.getByTestId('task-submit-button').click();

      const updatedTask = taskCard(page, updatedTaskTitle);
      await expect(updatedTask).toBeVisible();
      await expect(taskCard(page, initialTaskTitle)).toHaveCount(0);

      await updatedTask.getByTestId('task-toggle').click();
      await expect(updatedTask).toHaveAttribute('data-task-status', 'completed');

      await updatedTask.hover();
      await updatedTask.getByTestId('task-delete').click();
      await expect(page.getByTestId('confirm-dialog')).toBeVisible();
      await page.getByTestId('confirm-dialog-confirm').click();
      await expect(taskCard(page, updatedTaskTitle)).toHaveCount(0);

      await page.getByTestId('sidebar-logout').click();
      await expect(page.getByTestId('auth-submit-button')).toBeVisible();

      const resetToken = await seedPasswordResetToken(user.email);

      await page.goto(`/reset-password?token=${resetToken}`);
      await page.getByTestId('reset-password-input').fill(user.nextPassword);
      await page.getByTestId('reset-confirm-input').fill(user.nextPassword);
      await page.getByTestId('reset-submit-button').click();
      await expect(page.getByRole('link', { name: /Ir para o Login/i })).toBeVisible();

      await loginUser(page, user.email, user.nextPassword);
    } finally {
      await cleanupUsersByEmail([user.email]);
    }
  });

  test('updates profile with avatar and rotated credentials', async ({ page }) => {
    const user = buildE2ETestUser();
    const updatedEmail = user.email.replace('@', '.perfil@');
    const updatedName = `${user.name} Perfil`;
    const updatedPassword = 'PerfilNovo123!';

    await cleanupUsersByEmail([user.email, updatedEmail]);

    try {
      await registerUser(page, user);

      await page.getByTestId('sidebar-profile-button').click();
      await page.getByTestId('profile-name-input').fill(updatedName);
      await page.getByTestId('profile-email-input').fill(updatedEmail);
      await page.getByTestId('profile-password-input').fill(updatedPassword);
      await page.getByTestId('profile-avatar-input').setInputFiles({
        name: 'avatar.png',
        mimeType: 'image/png',
        buffer: tinyPng,
      });
      await page.getByTestId('profile-submit-button').click();

      await expect(page.getByTestId('profile-submit-button')).toHaveCount(0);
      await expect(page.getByTestId('sidebar-profile-name')).toHaveText(updatedName);
      await expect(page.getByTestId('sidebar-profile-email')).toHaveText(updatedEmail);
      await expect(page.getByTestId('sidebar-profile-avatar')).toHaveAttribute('src', /data:image\/png;base64,/);

      await createTask(page, 'Validar token rotacionado');
      const rotatedTokenTask = taskCard(page, 'Validar token rotacionado');
      await expect(rotatedTokenTask).toBeVisible();
      await expect(rotatedTokenTask.getByTestId('task-time-badge')).toHaveCount(0);
      await expect(rotatedTokenTask.getByTestId('task-due-badge')).toHaveAttribute('title', 'Dia todo');

      await page.getByTestId('sidebar-logout').click();
      await expect(page.getByTestId('auth-submit-button')).toBeVisible();

      await loginUser(page, updatedEmail, updatedPassword);
      await expect(page.getByTestId('sidebar-profile-name')).toHaveText(updatedName);
    } finally {
      await cleanupUsersByEmail([user.email, updatedEmail]);
    }
  });

  test('logs the user out when the token is blacklisted mid-session', async ({ page }) => {
    const user = buildE2ETestUser();

    await cleanupUsersByEmail([user.email]);

    try {
      const token = await registerUser(page, user);

      await page.getByTestId('sidebar-tasks').click();
      await blacklistToken(token);

      const unauthorizedResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes('/api/tasks') &&
          response.request().method() === 'POST' &&
          response.status() === 401,
      );

      await page.getByTestId('new-task-button').click();
      await page.getByTestId('task-title-input').fill('Falhar por sessão expirada');
      await page.getByTestId('task-date-input').fill(
        formatDateLocal(new Date(Date.now() + 24 * 60 * 60 * 1000)),
      );
      await page.getByTestId('task-submit-button').click();

      await unauthorizedResponsePromise;
      await expect(page.getByTestId('auth-submit-button')).toBeVisible();
      await expect(page.getByTestId('sidebar-dashboard')).toHaveCount(0);
    } finally {
      await cleanupUsersByEmail([user.email]);
    }
  });

  test('paginates long task lists instead of rendering everything at once', async ({ page }) => {
    const user = buildE2ETestUser();

    await cleanupUsersByEmail([user.email]);

    try {
      await registerUser(page, user);
      await seedTasksForUser(user.email, 26, { prefix: 'Tarefa paginada' });

      await page.reload();
      await expect(page.getByTestId('sidebar-dashboard')).toBeVisible();

      await page.getByTestId('sidebar-tasks').click();

      await expect(page.getByTestId('pending-pagination-summary')).toHaveText('Mostrando 1-20 de 26');
      await expect(page.getByTestId('pending-pagination-page')).toHaveText('Pagina 1 de 2');
      await expect(page.getByTestId('task-item')).toHaveCount(20);

      await page.getByTestId('pending-pagination-next').click();

      await expect(page.getByTestId('pending-pagination-summary')).toHaveText('Mostrando 21-26 de 26');
      await expect(page.getByTestId('pending-pagination-page')).toHaveText('Pagina 2 de 2');
      await expect(page.getByTestId('task-item')).toHaveCount(6);

      await page.getByTestId('pending-pagination-prev').click();
      await expect(page.getByTestId('pending-pagination-page')).toHaveText('Pagina 1 de 2');
    } finally {
      await cleanupUsersByEmail([user.email]);
    }
  });

  test('sorts task lists client-side by due date, priority and category', async ({ page }) => {
    const user = buildE2ETestUser();

    await cleanupUsersByEmail([user.email]);

    try {
      await registerUser(page, user);
      await seedCustomTasksForUser(user.email, [
        {
          title: 'Categoria estudo',
          dueDate: new Date('2026-05-05T09:00:00.000Z').toISOString(),
          priority: 'medium',
          category: 'Estudos',
        },
        {
          title: 'Prioridade alta amanha',
          dueDate: new Date('2026-04-26T09:00:00.000Z').toISOString(),
          priority: 'high',
          category: 'Trabalho',
        },
        {
          title: 'Prazo hoje baixa',
          dueDate: new Date('2026-04-25T12:00:00.000Z').toISOString(),
          priority: 'low',
          category: 'Pessoal',
        },
      ]);

      await page.reload();
      await expect(page.getByTestId('sidebar-dashboard')).toBeVisible();

      await page.getByTestId('sidebar-tasks').click();

      await page.getByTestId('task-sort-dueDate').click();
      await expectFirstTaskTitle(page, 'Prazo hoje baixa');

      await page.getByTestId('task-sort-priority').click();
      await expectFirstTaskTitle(page, 'Prioridade alta amanha');

      await page.getByTestId('task-sort-category').click();
      await expectFirstTaskTitle(page, 'Categoria estudo');
      await expect(page.getByTestId('task-sort-category')).toHaveAttribute('aria-pressed', 'true');

      await page.reload();
      await expect(page.getByTestId('sidebar-dashboard')).toBeVisible();
      await page.getByTestId('sidebar-tasks').click();

      await expect(page.getByTestId('task-sort-category')).toHaveAttribute('aria-pressed', 'true');
      await expectFirstTaskTitle(page, 'Categoria estudo');
    } finally {
      await cleanupUsersByEmail([user.email]);
    }
  });

  test('visually differentiates overdue all-day and timed tasks', async ({ page }) => {
    const user = buildE2ETestUser();
    const overdueAllDay = new Date();
    overdueAllDay.setDate(overdueAllDay.getDate() - 2);
    overdueAllDay.setHours(23, 59, 0, 0);

    const overdueTimed = new Date();
    overdueTimed.setDate(overdueTimed.getDate() - 2);
    overdueTimed.setHours(8, 0, 0, 0);

    await cleanupUsersByEmail([user.email]);

    try {
      await registerUser(page, user);
      await seedCustomTasksForUser(user.email, [
        {
          title: 'Atrasada dia todo',
          dueDate: overdueAllDay.toISOString(),
          priority: 'medium',
          category: 'Pessoal',
        },
        {
          title: 'Atrasada com horario',
          dueDate: overdueTimed.toISOString(),
          priority: 'high',
          category: 'Trabalho',
        },
      ]);

      await page.getByTestId('sidebar-logout').click();
      await expect(page.getByTestId('auth-submit-button')).toBeVisible();
      await loginUser(page, user.email, user.password);
      await page.getByTestId('sidebar-tasks').click();

      const allDayTask = taskCard(page, 'Atrasada dia todo');
      await expect(allDayTask.getByTestId('task-due-badge')).toHaveAttribute('data-overdue-kind', 'all-day');
      await expect(allDayTask.getByTestId('task-all-day-badge')).toHaveText('Dia todo');
      await expect(allDayTask.getByTestId('task-time-badge')).toHaveCount(0);

      const timedTask = taskCard(page, 'Atrasada com horario');
      await expect(timedTask.getByTestId('task-due-badge')).toHaveAttribute('data-overdue-kind', 'timed');
      await expect(timedTask.getByTestId('task-time-badge')).toHaveText('08:00');
      await expect(timedTask.getByTestId('task-all-day-badge')).toHaveCount(0);
    } finally {
      await cleanupUsersByEmail([user.email]);
    }
  });

  test('remembers the user email on the login screen when requested', async ({ page }) => {
    const user = buildE2ETestUser();

    await cleanupUsersByEmail([user.email]);

    try {
      await registerUser(page, user);
      await page.getByTestId('sidebar-logout').click();
      await expect(page.getByTestId('auth-submit-button')).toBeVisible();

      await loginUserWithRememberedEmail(page, user.email, user.password);
      await page.getByTestId('sidebar-logout').click();

      await expect(page.getByTestId('auth-email-input')).toHaveValue(user.email);
      await expect(page.getByTestId('remember-email-checkbox')).toBeChecked();
      await expect(page.getByTestId('auth-password-input')).toHaveValue('');
    } finally {
      await cleanupUsersByEmail([user.email]);
    }
  });
});
