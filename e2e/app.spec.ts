import { test, expect, type Page, type Response } from '@playwright/test';
import {
  blacklistToken,
  buildE2ETestUser,
  cleanupUsersByEmail,
  runScheduledNotifications,
  seedCustomTasksForUser,
  seedNotificationForUser,
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

function nextWeekday(startDate: Date, weekday: number): Date {
  const date = new Date(startDate);
  date.setHours(12, 0, 0, 0);
  const diff = (weekday - date.getDay() + 7) % 7 || 7;
  date.setDate(date.getDate() + diff);
  return date;
}

async function waitForJsonResponse(
  page: Page,
  matcher: (response: Response) => boolean,
): Promise<Record<string, unknown>> {
  const response = await page.waitForResponse(matcher);
  return response.json() as Promise<Record<string, unknown>>;
}

async function ensureAuthPage(page: Page) {
  const logoutButton = page.getByTestId('sidebar-logout');
  const authEmailInput = page.getByTestId('auth-email-input');

  if (await authEmailInput.isVisible({ timeout: 1500 }).catch(() => false)) {
    return;
  }

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  if (await logoutButton.isVisible({ timeout: 1500 }).catch(() => false)) {
    await logoutButton.click();
  }

  if (await authEmailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    return;
  }

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(authEmailInput).toBeVisible({ timeout: 15000 });
}

async function refreshAuthenticatedPage(page: Page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sidebar-dashboard')).toBeVisible({ timeout: 15000 });
}

async function registerUser(page: Page, user: E2ETestUser): Promise<string> {
  await ensureAuthPage(page);

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
  await ensureAuthPage(page);

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
  await ensureAuthPage(page);

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
    await page.getByTestId('task-time-input').fill(options.time);
  }
  await page.getByTestId('task-priority-select').selectOption('high');
  await page.getByTestId('task-category-select').selectOption('Geral');
  await page.getByTestId('task-submit-button').click();
}

function taskCard(page: Page, title: string) {
  return page.locator(`[data-testid="task-item"][data-task-title="${title}"]`).first();
}

async function expectFirstTaskTitle(page: Page, title: string): Promise<void> {
  await expect(page.locator('[data-testid="task-item"]').first()).toHaveAttribute('data-task-title', title);
}

test.describe('Lembreto critical flows', () => {
  test('exposes drawer semantics and focus for keyboard users', async ({ page }) => {
    const user = buildE2ETestUser();

    await cleanupUsersByEmail([user.email]);

    try {
      await registerUser(page, user);

      await page.getByTestId('dashboard-create-first-task').click();
      await expect(page.getByRole('dialog', { name: /novo lembrete/i })).toBeVisible();
      await expect(page.getByTestId('task-title-input')).toBeFocused();
      await page.getByRole('button', { name: /Fechar formul/i }).click();
      await expect(page.getByTestId('task-title-input')).toHaveCount(0);

      await page.getByTestId('sidebar-profile-button').click();
      await expect(page.getByRole('dialog', { name: /editar perfil/i })).toBeVisible();
      await expect(page.getByTestId('profile-name-input')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('profile-name-input')).toHaveCount(0);

      await page.getByTestId('sidebar-settings-button').click();
      await expect(page.locator('[role="dialog"][aria-labelledby="settings-drawer-title"]')).toBeVisible();
      await expect(page.getByRole('switch', { name: 'Alternar modo escuro' })).toBeFocused();
    } finally {
      await cleanupUsersByEmail([user.email]);
    }
  });

  test('shows a guided empty state for first-time users', async ({ page }) => {
    const user = buildE2ETestUser();

    await cleanupUsersByEmail([user.email]);

    try {
      await registerUser(page, user);

      await expect(page.getByTestId('dashboard-welcome-state')).toBeVisible();
      await expect(page.getByTestId('dashboard-create-first-task')).toBeVisible();
      await expect(page.getByTestId('dashboard-explore-categories')).toBeVisible();
      await expect(page.getByTestId('dashboard-use-example')).toBeVisible();

      await page.getByTestId('dashboard-template-trabalho').click();

      await expect(page.getByTestId('task-title-input')).toHaveValue('Planejar a semana');
      await expect(page.getByTestId('task-description-input')).toHaveValue(/próximos dias\./i);
      await expect(page.getByTestId('task-category-select')).toHaveValue('Trabalho');
      await expect(page.getByTestId('task-priority-select')).toHaveValue('high');
      await expect(page.getByTestId('task-time-input')).toHaveValue('09:00');
    } finally {
      await cleanupUsersByEmail([user.email]);
    }
  });

  test('highlights an invalid past due date before submitting', async ({ page }) => {
    const user = buildE2ETestUser();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    await cleanupUsersByEmail([user.email]);

    try {
      await registerUser(page, user);

      await page.getByTestId('dashboard-create-first-task').click();
      await page.getByTestId('task-title-input').fill('Validar prazo visual');
      await page.getByTestId('task-date-input').fill(formatDateLocal(yesterday));

      await expect(page.getByTestId('task-date-help')).toHaveText('Escolha uma data de hoje em diante.');
      await expect(page.getByTestId('task-submit-button')).toBeDisabled();
    } finally {
      await cleanupUsersByEmail([user.email]);
    }
  });

  test('uses the configured default time when a reminder is saved without time', async ({ page }) => {
    const user = buildE2ETestUser();

    await cleanupUsersByEmail([user.email]);

    try {
      await registerUser(page, user);

      await page.getByTestId('sidebar-settings-button').click();
      await page.getByTestId('settings-nav-organization').click();
      await page.getByTestId('settings-no-time-hours-input').fill('2');
      await page.getByTestId('settings-no-time-minutes-input').fill('30');
      await page.getByRole('button', { name: /fechar configura/i }).click();

      await createTask(page, 'Sem horário usa padrão');
      const task = taskCard(page, 'Sem horário usa padrão');
      await expect(task.getByTestId('task-time-badge')).toHaveText('02:30');
      await expect(task.getByTestId('task-all-day-badge')).toHaveCount(0);
    } finally {
      await cleanupUsersByEmail([user.email]);
    }
  });

  test('requires an end time for work reminders', async ({ page }) => {
    const user = buildE2ETestUser();

    await cleanupUsersByEmail([user.email]);

    try {
      await registerUser(page, user);

      await page.getByTestId('dashboard-create-first-task').click();
      await page.getByTestId('task-title-input').fill('Reunião de trabalho');
      await page.getByTestId('task-date-input').fill(formatDateLocal(new Date(Date.now() + 24 * 60 * 60 * 1000)));
      await page.getByTestId('task-time-input').fill('09:00');
      await page.getByTestId('task-category-select').selectOption('Trabalho');
      await expect(page.getByTestId('task-submit-button')).toBeDisabled();
      await expect(page.getByTestId('task-date-help')).toContainText('Horário final obrigatório');

      await page.getByTestId('task-end-time-input').fill('10:00');
      await expect(page.getByTestId('task-submit-button')).toBeEnabled();
      await page.getByTestId('task-submit-button').click();

      await page.getByTestId('sidebar-tasks').click();
      const task = taskCard(page, 'Reunião de trabalho');
      await expect(task).toBeVisible();
      await expect(task.getByTestId('task-time-badge')).toHaveText('09:00 - 10:00');
    } finally {
      await cleanupUsersByEmail([user.email]);
    }
  });

  test('closes the reminder view after completing overdue imported work reminders without an end time', async ({ page }) => {
    const user = buildE2ETestUser();
    const title = 'Trabalho importado sem fim';
    const overdue = new Date();
    overdue.setDate(overdue.getDate() - 1);
    overdue.setHours(20, 0, 0, 0);

    await cleanupUsersByEmail([user.email]);

    try {
      await registerUser(page, user);
      await seedCustomTasksForUser(user.email, [{
        title,
        dueDate: overdue.toISOString(),
        priority: 'high',
        category: 'Trabalho',
      }]);
      await refreshAuthenticatedPage(page);

      await page.getByTestId('dashboard-metric-overdue').click();
      const dashboardMetricDialog = page.getByTestId('dashboard-metric-dialog');
      await expect(dashboardMetricDialog).toBeVisible();
      await dashboardMetricDialog.locator(`[data-testid="task-item"][data-task-title="${title}"]`).click();
      const taskDetailsDialog = page.getByTestId('task-details-dialog');
      await expect(taskDetailsDialog).toBeVisible();
      await expect(page.getByTestId('task-details-back')).toContainText(/Voltar para atrasados/i);

      const updateResponsePromise = page.waitForResponse((response) =>
        response.url().includes('/api/tasks/') &&
        response.request().method() === 'PUT',
      );
      await taskDetailsDialog.getByTestId('task-details-toggle').click();
      await expect(taskDetailsDialog).toHaveCount(0);
      const updateResponse = await updateResponsePromise;

      expect(updateResponse.status()).toBe(200);
      await expect(page.getByText(`"${title}" foi concluído.`)).toBeVisible();
    } finally {
      await cleanupUsersByEmail([user.email]);
    }
  });

  test('saves drafts and promotes them from the drafts tab', async ({ page }) => {
    const user = buildE2ETestUser();
    const title = 'Rascunho de proposta';

    await cleanupUsersByEmail([user.email]);

    try {
      await registerUser(page, user);

      await page.getByTestId('dashboard-create-first-task').click();
      await page.getByTestId('task-title-input').fill(title);
      await page.getByTestId('task-description-input').fill('Ainda vou revisar antes de publicar.');
      await page.getByTestId('task-date-input').fill(formatDateLocal(new Date(Date.now() + 24 * 60 * 60 * 1000)));
      await page.getByTestId('task-save-draft-button').click();

      await page.getByTestId('sidebar-tasks').click();
      const pendingDraft = taskCard(page, title);
      await expect(pendingDraft).toBeVisible();
      await expect(pendingDraft).toHaveAttribute('data-task-status', 'draft');
      await expect(pendingDraft).toContainText('Rascunho');

      await page.getByTestId('sidebar-drafts').click();
      await expect(taskCard(page, title)).toBeVisible();

      await page.getByTestId('draft-edit-button').click();
      await page.getByTestId('task-description-input').fill('Rascunho revisado antes de virar lembrete.');
      await page.getByTestId('task-save-draft-button').click();

      await page.getByTestId('draft-promote-button').click();
      await expect(taskCard(page, title)).toHaveCount(0);

      await page.getByTestId('sidebar-tasks').click();
      const promotedTask = taskCard(page, title);
      await expect(promotedTask).toBeVisible();
      await expect(promotedTask).toHaveAttribute('data-task-status', 'pending');
      await expect(promotedTask).toContainText('Pendente');
    } finally {
      await cleanupUsersByEmail([user.email]);
    }
  });

  test('toggles reminder activation from card and details', async ({ page }) => {
    const user = buildE2ETestUser();
    const title = 'Alternar ativação';

    await cleanupUsersByEmail([user.email]);

    try {
      await registerUser(page, user);
      await createTask(page, title);

      const task = taskCard(page, title);
      await expect(task).toHaveAttribute('data-task-status', 'pending');

      await task.getByTestId('task-actions-button').click();
      await page.getByTestId('task-activation-toggle').click();
      await expect(task).toHaveAttribute('data-task-status', 'inactive');
      await expect(task).toContainText('Desativado');

      await task.click();
      await expect(page.getByTestId('task-details-dialog')).toBeVisible();
      await page.getByTestId('task-details-activation-toggle').click();
      await expect(page.getByTestId('task-details-dialog')).toContainText('Pendente');
      await page.getByRole('button', { name: /fechar visualiza/i }).click();
      await expect(task).toHaveAttribute('data-task-status', 'pending');
    } finally {
      await cleanupUsersByEmail([user.email]);
    }
  });

  test('configures alarm only after date and initial time are set', async ({ page }) => {
    const user = buildE2ETestUser();

    await cleanupUsersByEmail([user.email]);

    try {
      await registerUser(page, user);

      await page.getByTestId('dashboard-create-first-task').click();
      await page.getByTestId('task-title-input').fill('Lembrete com alarme');
      await page.getByTestId('task-date-input').fill(formatDateLocal(new Date(Date.now() + 24 * 60 * 60 * 1000)));
      await page.getByTestId('task-tab-alarm').click();
      await expect(page.getByTestId('task-alarm-toggle')).toBeDisabled();

      await page.getByTestId('task-tab-details').click();
      await page.getByTestId('task-time-input').fill('09:30');
      await page.getByTestId('task-tab-alarm').click();
      await page.getByTestId('task-alarm-toggle').check();
      await expect(page.getByTestId('task-alarm-toggle')).toBeChecked();
      await page.getByTestId('task-submit-button').click();

      await page.getByTestId('sidebar-tasks').click();
      await expect(taskCard(page, 'Lembrete com alarme')).toBeVisible();
    } finally {
      await cleanupUsersByEmail([user.email]);
    }
  });

  test('creates recurring reminders across a chosen date range', async ({ page }) => {
    const user = buildE2ETestUser();
    const nextMonday = nextWeekday(new Date(), 1);
    const nextFriday = new Date(nextMonday);
    nextFriday.setDate(nextMonday.getDate() + 4);

    await cleanupUsersByEmail([user.email]);

    try {
      await registerUser(page, user);

      await page.getByTestId('dashboard-create-first-task').click();
      await page.getByTestId('task-title-input').fill('Rotina recorrente');
      await page.getByTestId('task-description-input').fill('Criado em série para validar repetição.');
      await page.getByTestId('task-date-input').fill(formatDateLocal(nextMonday));
      await page.getByTestId('task-tab-recurrence').click();
      await page.getByTestId('task-recurrence-toggle').check();
      await page.getByTestId('task-holiday-notification-toggle').check();
      await page.getByTestId('task-recurrence-suggestion-weekdays').click();
      await expect(page.getByTestId('task-recurrence-mode')).toHaveValue('weekdays');
      await page.getByTestId('task-recurrence-until').fill(formatDateLocal(nextFriday));
      await expect(page.getByTestId('task-recurrence-count')).toContainText('5 lembretes');
      await page.getByTestId('task-submit-button').click();
      await page.getByTestId('sidebar-tasks').click();
      await page.reload();
      await expect(page.locator('[data-testid="task-item"][data-task-title="Rotina recorrente"]')).toHaveCount(5);
    } finally {
      await cleanupUsersByEmail([user.email]);
    }
  });

  test('creates custom categories and tags for reminders', async ({ page }) => {
    const user = buildE2ETestUser();

    await cleanupUsersByEmail([user.email]);

    try {
      await registerUser(page, user);

      await page.getByTestId('sidebar-category-manager-button').click();
      await page.getByTestId('sidebar-category-create-input').fill('Saúde');
      await page.getByTestId('sidebar-category-create-button').click();
      await expect(page.getByText('Categoria "Saúde" criada com sucesso.')).toBeVisible();

      await page.getByTestId('sidebar-settings-button').click();
      await page.getByTestId('settings-nav-organization').click();
      await page.getByTestId('settings-tag-create-input').fill('Consulta');
      await page.getByTestId('settings-tag-create-button').click();
      await expect(page.getByText('Tag "Consulta" criada com sucesso.')).toBeVisible();
      await page.getByRole('button', { name: /fechar configura/i }).click();

      await page.getByTestId('dashboard-create-first-task').click();
      await page.getByTestId('task-title-input').fill('Consulta de rotina');
      await page.getByTestId('task-date-input').fill(formatDateLocal(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)));

      await page.getByTestId('task-category-search-input').fill('saude');
      await expect(page.getByTestId('task-category-select')).toHaveValue('Saúde');
      await page.getByTestId('task-tag-input').fill('Consulta');
      await page.getByTestId('task-tag-add-button').click();
      await expect(page.getByTestId('task-tag-chip')).toContainText('Consulta');
      await page.getByTestId('task-tag-input').fill('Retorno');
      await page.getByTestId('task-tag-add-button').click();
      await expect(page.getByTestId('task-tag-chip').filter({ hasText: 'Retorno' })).toBeVisible();

      await page.getByTestId('task-submit-button').click();

      const createdTask = taskCard(page, 'Consulta de rotina');
      await expect(createdTask).toBeVisible();
      await expect(createdTask).toContainText('Saúde');
      await expect(createdTask).toContainText('Consulta');

      await page.getByTestId('sidebar-tasks').click();
      await page.getByTestId('new-task-button').click();
      await expect(page.getByTestId('task-tag-suggestion-retorno')).toBeVisible();
      await page.getByRole('button', { name: /fechar formulário de lembrete/i }).click();

      await createdTask.click();
      const taskDetailsDialog = page.getByTestId('task-details-dialog');
      await expect(taskDetailsDialog).toContainText('Saúde');
      await expect(taskDetailsDialog).toContainText('Consulta');

      await page.getByRole('button', { name: /fechar visualização do lembrete/i }).click();
      await page.getByTestId('sidebar-tasks').click();
      await page.locator('aside').getByText('Saúde', { exact: true }).click();
      await expect(createdTask).toBeVisible();

      await page.getByTestId('sidebar-settings-button').click();
      await page.getByTestId('settings-nav-organization').click();
      const settingsDialog = page.getByRole('dialog', { name: /config/i });
      await page.getByRole('button', { name: 'Excluir tag Consulta' }).click();
      await expect(settingsDialog.getByRole('button', { name: 'Excluir tag Consulta' })).toHaveCount(0);
      await page.getByRole('button', { name: /fechar configura/i }).click();
      await page.getByTestId('sidebar-category-manager-button').click();
      await page.getByRole('button', { name: 'Excluir categoria Saúde' }).click();
      await expect(page.getByRole('dialog', { name: 'Gerenciar categorias' }).getByRole('button', { name: 'Excluir categoria Saúde' })).toHaveCount(0);
      await page.getByRole('button', { name: 'Fechar categorias' }).click();

      await page.locator('aside').getByText('Todas', { exact: true }).click();
      await createdTask.click();
      await expect(taskDetailsDialog).toContainText('Geral');
      await expect(taskDetailsDialog.getByText('Consulta', { exact: true })).toHaveCount(0);
    } finally {
      await cleanupUsersByEmail([user.email]);
    }
  });

  test('creates, edits and deletes linked notes from inside a reminder', async ({ page }) => {
    const user = buildE2ETestUser();

    await cleanupUsersByEmail([user.email]);

    try {
      await registerUser(page, user);

      await page.getByTestId('sidebar-settings-button').click();
      await page.getByTestId('settings-nav-organization').click();
      await page.getByTestId('settings-category-create-input').fill('Referencias');
      await page.getByTestId('settings-category-create-button').click();
      await page.getByTestId('settings-tag-create-input').fill('Ata');
      await page.getByTestId('settings-tag-create-button').click();
      await page.getByRole('button', { name: /fechar configura/i }).click();

      await createTask(page, 'Reuniao com cliente');

      const createdTask = taskCard(page, 'Reuniao com cliente');
      await createdTask.click();
      await expect(page.getByTestId('task-details-dialog')).toBeVisible();

      await page.getByTestId('task-details-add-note').click();
      await expect(page.getByRole('dialog', { name: /nova nota/i })).toBeVisible();
      await page.getByTestId('note-title-input').fill('Ata inicial');
      await page.getByTestId('note-content-input').fill('Registrar pontos de alinhamento e proximos passos.');
      await page.getByTestId('note-priority-select').selectOption('high');
      await page.getByTestId('note-category-select').selectOption('Referencias');
      await page.getByTestId('note-mode-fixed').click();
      await expect(page.getByTestId('note-task-select')).toBeDisabled();
      await page.getByTestId('note-tag-input').fill('Ata');
      await page.getByTestId('note-tag-add-button').click();
      await expect(page.getByTestId('note-tag-chip')).toContainText('Ata');
      await page.getByTestId('note-submit-button').click();
      await expect(page.getByRole('dialog', { name: /nova nota/i })).toHaveCount(0);

      const linkedNoteCard = page.getByTestId('task-details-dialog').getByTestId('note-card').first();
      await expect(linkedNoteCard).toContainText('Ata inicial');
      await expect(linkedNoteCard).toContainText('Referencias');
      await expect(linkedNoteCard).toContainText('Ata');

      await linkedNoteCard.getByTestId('note-edit-button').click();
      await expect(page.getByRole('dialog', { name: /editar nota/i })).toBeVisible();
      await page.getByTestId('note-title-input').fill('Ata final');
      await page.getByTestId('note-submit-button').click();
      await expect(page.getByRole('dialog', { name: /editar nota/i })).toHaveCount(0);

      await expect(page.getByTestId('task-details-dialog').getByTestId('note-card').first()).toContainText('Ata final');

      await page.getByTestId('sidebar-notes').click();
      const noteCard = page.locator('[data-testid="note-card"][data-note-title="Ata final"]').first();
      await expect(noteCard).toBeVisible();
      await expect(noteCard.getByTestId('note-linked-task')).toContainText('Reuniao com cliente');

      await noteCard.getByTestId('note-delete-button').click();
      await expect(page.getByTestId('confirm-dialog')).toBeVisible();
      await page.getByTestId('confirm-dialog-confirm').click();
      await expect(page.locator('[data-testid="note-card"][data-note-title="Ata final"]')).toHaveCount(0);
    } finally {
      await cleanupUsersByEmail([user.email]);
    }
  });

  test('uses dashboard metrics as shortcuts and filtered views', async ({ page }) => {
    const user = buildE2ETestUser();
    const today = new Date();
    if (today.getHours() >= 22) {
      today.setHours(23, 55, 0, 0);
    } else {
      today.setHours(today.getHours() + 1, 0, 0, 0);
    }

    const overdue = new Date();
    overdue.setDate(overdue.getDate() - 2);
    overdue.setHours(9, 0, 0, 0);

    const completed = new Date();
    completed.setDate(completed.getDate() - 1);
    completed.setHours(14, 0, 0, 0);

    await cleanupUsersByEmail([user.email]);

    try {
      await registerUser(page, user);
      await seedCustomTasksForUser(user.email, [
        {
          title: 'Concluído no painel',
          dueDate: completed.toISOString(),
          priority: 'medium',
          category: 'Geral',
          status: 'completed',
        },
        {
          title: 'Hoje no painel',
          dueDate: today.toISOString(),
          priority: 'high',
          category: 'Trabalho',
        },
        {
          title: 'Atrasado no painel',
          dueDate: overdue.toISOString(),
          priority: 'high',
          category: 'Pessoal',
        },
      ]);

      await refreshAuthenticatedPage(page);

      await page.getByTestId('dashboard-metric-completed').click();
      const dashboardMetricDialog = page.getByTestId('dashboard-metric-dialog');
      await expect(dashboardMetricDialog).toBeVisible();
      await expect(dashboardMetricDialog).toContainText(/Lembretes conclu/i);
      const completedDashboardTask = dashboardMetricDialog.getByTestId('task-item').first();
      await expect(completedDashboardTask).toBeVisible();
      await completedDashboardTask.click();
      await expect(page.getByTestId('task-details-dialog')).toBeVisible();
      await expect(page.getByTestId('task-details-back')).toContainText(/Voltar para conclu/i);
      await page.getByTestId('task-details-back').click();
      await expect(dashboardMetricDialog).toBeVisible();

      await dashboardMetricDialog.getByRole('button', { name: /Fechar vis.o filtrada/i }).click();
      await page.getByTestId('dashboard-metric-today').click();
      await expect(dashboardMetricDialog).toContainText('Lembretes para hoje');
      await expect(dashboardMetricDialog.locator('[data-testid="task-item"][data-task-title="Hoje no painel"]')).toBeVisible();

      await dashboardMetricDialog.getByRole('button', { name: /Fechar vis.o filtrada/i }).click();
      await page.getByTestId('dashboard-metric-overdue').click();
      await expect(dashboardMetricDialog).toContainText('Lembretes atrasados');
      await expect(dashboardMetricDialog.locator('[data-testid="task-item"][data-task-title="Atrasado no painel"]')).toBeVisible();

      await dashboardMetricDialog.getByRole('button', { name: /Fechar vis.o filtrada/i }).click();
      await page.getByTestId('dashboard-metric-total').click();
      await page.getByTestId('task-filters-toggle').click();
      await expect(page.getByTestId('task-search-input')).toBeVisible();
    } finally {
      await cleanupUsersByEmail([user.email]);
    }
  });

  test('highlights the next best action and supports quick reschedule from the reminder view', async ({ page }) => {
    const user = buildE2ETestUser();
    const overdue = new Date();
    overdue.setDate(overdue.getDate() - 1);
    overdue.setHours(10, 0, 0, 0);

    const upcoming = new Date();
    upcoming.setDate(upcoming.getDate() + 3);
    upcoming.setHours(16, 0, 0, 0);

    await cleanupUsersByEmail([user.email]);

    try {
      await registerUser(page, user);
      await seedCustomTasksForUser(user.email, [
        {
          title: 'Revisar contrato importante',
          dueDate: overdue.toISOString(),
          priority: 'high',
          category: 'Trabalho',
        },
        {
          title: 'Planejar próxima apresentação',
          dueDate: upcoming.toISOString(),
          priority: 'medium',
          category: 'Trabalho',
        },
      ]);

      await refreshAuthenticatedPage(page);

      await expect(page.getByTestId('assistant-focus-card')).toBeVisible();
      await expect(page.getByTestId('assistant-focus-card')).toContainText('Revisar contrato importante');

      await page.getByTestId('assistant-open-focus').click();
      await expect(page.getByTestId('task-details-dialog')).toBeVisible();

      const rescheduleResponsePromise = waitForJsonResponse(
        page,
        (response) =>
          response.url().includes('/api/tasks/') &&
          response.request().method() === 'PUT',
      );

      await page.getByTestId('task-details-snooze-tomorrow').click();

      const updatedTask = await rescheduleResponsePromise;
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      expect(formatDateLocal(new Date(String(updatedTask.dueDate)))).toBe(formatDateLocal(tomorrow));
      expect(String(JSON.stringify(updatedTask.history ?? []))).toContain('Prazo reagendado');
      await expect(page.getByTestId('task-details-dialog')).toBeVisible();
      await expect(page.getByTestId('task-details-dialog')).toContainText('Revisar contrato importante');
      await expect(page.getByTestId('task-history-list')).toContainText('Prazo reagendado');
    } finally {
      await cleanupUsersByEmail([user.email]);
    }
  });

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
      await expect(createdTask.getByTestId('task-due-badge')).toHaveAttribute('title', /08:00/);

      await createdTask.click();
      const taskDetailsDialog = page.getByTestId('task-details-dialog');
      await expect(taskDetailsDialog).toBeVisible();
      await expect(taskDetailsDialog.getByRole('heading', { name: initialTaskTitle })).toBeVisible();
      await expect(taskDetailsDialog.getByTestId('task-history-list')).toContainText('Lembrete criado');
      await page.getByTestId('task-details-duplicate').click();
      await expect(page.getByTestId('task-title-input')).toHaveValue(new RegExp(`${initialTaskTitle} \\(c.pia\\)$`, 'i'));
      await page.getByRole('button', { name: /Fechar formul/i }).click();
      await createdTask.click();
      await expect(taskDetailsDialog).toBeVisible();
      await page.getByTestId('task-details-edit').click();
      await page.getByTestId('task-title-input').fill(updatedTaskTitle);
      await page.getByTestId('task-category-select').selectOption('Estudos');
      await page.getByTestId('task-submit-button').click();

      const updatedTask = taskCard(page, updatedTaskTitle);
      await expect(updatedTask).toBeVisible();
      await expect(taskCard(page, initialTaskTitle)).toHaveCount(0);

      await updatedTask.click();
      await expect(taskDetailsDialog).toBeVisible();
      await expect(taskDetailsDialog.getByTestId('task-history-list')).toContainText('Lembrete atualizado');
      await expect(taskDetailsDialog.getByTestId('task-history-list')).toContainText('Título atualizado.');
      await expect(taskDetailsDialog.getByTestId('task-history-list')).toContainText('Categoria alterada.');
      await page.getByTestId('task-details-toggle').click();
      await expect(taskDetailsDialog).toHaveCount(0);
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
      await expect(page.getByRole('button', { name: /Ir para o login/i })).toBeVisible();

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

      await expect(page.getByTestId('sidebar-profile-name')).toHaveText(updatedName);
      await expect(page.getByTestId('sidebar-profile-email')).toHaveText(updatedEmail);
      await expect(page.getByTestId('sidebar-profile-avatar')).toHaveAttribute('src', /data:image\/png;base64,/);
      await expect(page.getByTestId('profile-submit-button')).toHaveCount(0, { timeout: 4000 });

      await createTask(page, 'Validar token rotacionado');
      const rotatedTokenTask = taskCard(page, 'Validar token rotacionado');
      await expect(rotatedTokenTask).toBeVisible();
      await expect(rotatedTokenTask.getByTestId('task-time-badge')).toHaveText('01:00');
      await expect(rotatedTokenTask.getByTestId('task-all-day-badge')).toHaveCount(0);

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

      await blacklistToken(token);
      await page.reload();

      await expect(page.getByTestId('auth-submit-button')).toBeVisible({ timeout: 15000 });
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

      await refreshAuthenticatedPage(page);

      await page.getByTestId('sidebar-tasks').click();

      await expect(page.getByTestId('pending-pagination-summary')).toHaveText('Mostrando 1-20 de 26');
      await expect(page.getByTestId('pending-pagination-page')).toHaveText(/1 de 2/);
      await expect(page.getByTestId('task-item')).toHaveCount(20);

      await page.getByTestId('pending-pagination-next').click();

      await expect(page.getByTestId('pending-pagination-summary')).toHaveText('Mostrando 21-26 de 26');
      await expect(page.getByTestId('pending-pagination-page')).toHaveText(/2 de 2/);
      await expect(page.getByTestId('task-item')).toHaveCount(6);

      await page.getByTestId('pending-pagination-prev').click();
      await expect(page.getByTestId('pending-pagination-page')).toHaveText(/1 de 2/);
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

      await refreshAuthenticatedPage(page);

      await page.getByTestId('sidebar-tasks').click();
      await page.getByTestId('task-filters-toggle').click();

      await page.getByTestId('task-sort-dueDate').click();
      await expectFirstTaskTitle(page, 'Prazo hoje baixa');

      await page.getByTestId('task-sort-priority').click();
      await expectFirstTaskTitle(page, 'Prioridade alta amanha');

      await page.getByTestId('task-sort-category').click();
      await expectFirstTaskTitle(page, 'Categoria estudo');
      await expect(page.getByTestId('task-sort-category')).toHaveAttribute('aria-pressed', 'true');
      await refreshAuthenticatedPage(page);
      await page.getByTestId('sidebar-tasks').click();
      await page.getByTestId('task-filters-toggle').click();

      await expect(page.getByTestId('task-sort-category')).toHaveAttribute('aria-pressed', 'true');
      await expectFirstTaskTitle(page, 'Categoria estudo');
    } finally {
      await cleanupUsersByEmail([user.email]);
    }
  });

  test('supports core keyboard shortcuts and shows password strength during registration', async ({ page }) => {
    const user = buildE2ETestUser();

    await cleanupUsersByEmail([user.email]);

    try {
      await page.goto('/');
      await page.getByTestId('auth-mode-toggle').click();
      await page.getByTestId('auth-password-input').fill('123456');
      await expect(page.getByTestId('password-strength-indicator')).toContainText(/senha fraca/i);
      await page.getByTestId('auth-password-input').fill('SenhaSuper123!');
      await expect(page.getByTestId('password-strength-indicator')).toContainText(/senha forte/i);

      await page.getByTestId('register-name-input').fill(user.name);
      await page.getByTestId('auth-email-input').fill(user.email);
      await page.getByTestId('auth-submit-button').click();
      await expect(page.getByTestId('sidebar-dashboard')).toBeVisible();

      await page.keyboard.press('n');
      await expect(page.getByRole('dialog', { name: /novo lembrete/i })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('task-title-input')).toHaveCount(0);

      await createTask(page, 'Atalho para exclusão');
      const shortcutTask = taskCard(page, 'Atalho para exclusão');
      await shortcutTask.hover();
      await shortcutTask.getByTestId('task-delete').click();
      await expect(page.getByTestId('confirm-dialog')).toBeVisible();
      await page.keyboard.press('Enter');
      await expect(taskCard(page, 'Atalho para exclusão')).toHaveCount(0);
    } finally {
      await cleanupUsersByEmail([user.email]);
    }
  });

  test('filters task lists by priority and status', async ({ page }) => {
    const user = buildE2ETestUser();

    await cleanupUsersByEmail([user.email]);

    try {
      await registerUser(page, user);
      await seedCustomTasksForUser(user.email, [
        {
          title: 'Alta pendente',
          dueDate: new Date('2026-04-26T09:00:00.000Z').toISOString(),
          priority: 'high',
          category: 'Trabalho',
          tags: ['Casa'],
        },
        {
          title: 'Baixa pendente',
          dueDate: new Date('2026-04-27T09:00:00.000Z').toISOString(),
          priority: 'low',
          category: 'Pessoal',
          tags: ['Estudo'],
        },
        {
          title: 'Alta concluída',
          dueDate: new Date('2026-04-25T09:00:00.000Z').toISOString(),
          priority: 'high',
          category: 'Trabalho',
          status: 'completed',
          tags: ['Casa'],
        },
      ]);

      await page.reload();
      await expect(page.getByTestId('sidebar-dashboard')).toBeVisible();

      await page.getByTestId('sidebar-tasks').click();
      await page.getByTestId('task-filters-toggle').click();

      await page.getByTestId('task-priority-filter-high').click();
      await expect(page.getByTestId('task-priority-summary')).toContainText('Alta');
      await expect(page.locator('[data-testid="task-item"][data-task-title="Alta pendente"]')).toBeVisible();
      await expect(page.locator('[data-testid="task-item"][data-task-title="Baixa pendente"]')).toHaveCount(0);

      await page.getByTestId('task-status-filter-completed').click();
      await expect(page.getByTestId('task-status-summary')).toContainText('Concluídos');
      await expect(page.locator('[data-testid="task-item"][data-task-title="Alta concluída"]')).toBeVisible();
      await expect(page.locator('[data-testid="task-item"][data-task-title="Alta pendente"]')).toHaveCount(0);

      await page.getByTestId('task-status-filter-pending').click();
      await expect(page.getByTestId('task-status-summary')).toContainText('Pendentes');
      await expect(page.locator('[data-testid="task-item"][data-task-title="Alta pendente"]')).toBeVisible();
      await expect(page.locator('[data-testid="task-item"][data-task-title="Alta concluída"]')).toHaveCount(0);

      await page.getByTestId('task-tag-filter-casa').click();
      await expect(page.getByTestId('task-tag-summary')).toContainText('Casa');
      await expect(page.locator('[data-testid="task-item"][data-task-title="Alta pendente"]')).toBeVisible();
      await expect(page.locator('[data-testid="task-item"][data-task-title="Baixa pendente"]')).toHaveCount(0);
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

  test('opens the notification center from settings and shows recent notifications from the bell', async ({ page }) => {
    const user = buildE2ETestUser();

    await cleanupUsersByEmail([user.email]);

    try {
      await registerUser(page, user);
      await seedNotificationForUser(user.email, {
        title: 'Bem-vindo!',
        message: `Ola, ${user.name}!`,
        tone: 'success',
        target: { type: 'notifications' },
        dedupeKey: `test:welcome:${user.email}`,
      });
      await page.reload();

      await page.getByTestId('header-notifications-button').click();
      const firstRecentNotification = page.getByTestId('recent-notification-item').first();
      await expect(firstRecentNotification).toContainText('Bem-vindo!');
      await firstRecentNotification.hover();
      await page.getByRole('button', { name: /Fechar notifica/i }).click();

      await page.getByTestId('sidebar-settings-button').click();
      await page.getByTestId('settings-nav-center').click();
      await page.getByTestId('settings-open-notifications-center').click();
      await expect(page.getByRole('heading', { name: /Central de notifica/i })).toBeVisible();
      const initialNotifications = page.getByTestId('notification-item');
      await expect(initialNotifications.first()).toContainText('Bem-vindo!');
      const initialCount = await initialNotifications.count();

      await page.getByTestId('sidebar-settings-button').click();
      await page.getByTestId('settings-nav-notifications').click();
      await page.getByRole('switch', { name: /notifica/i }).click();
      await page.getByRole('button', { name: /Fechar configura/i }).click();

      await page.getByTestId('sidebar-tasks').click();
      await createTask(page, 'Nao deve notificar');

      await page.getByTestId('header-notifications-button').click();
      await expect(page.getByTestId('recent-notification-item').first()).toContainText('Bem-vindo!');
      await page.getByTestId('notifications-open-center').click();
      await expect(page.getByTestId('notification-item')).toHaveCount(initialCount);
    } finally {
      await cleanupUsersByEmail([user.email]);
    }
  });

  test('opens the exact reminder from an overdue notification', async ({ page }) => {
    const user = buildE2ETestUser();
    const overdue = new Date();
    overdue.setDate(overdue.getDate() - 2);
    overdue.setHours(8, 0, 0, 0);

    await cleanupUsersByEmail([user.email]);

    try {
      await registerUser(page, user);
      await seedCustomTasksForUser(user.email, [
        {
          title: 'Lembrete em atraso com alerta',
          dueDate: overdue.toISOString(),
          priority: 'high',
          category: 'Trabalho',
        },
      ]);
      await runScheduledNotifications();
      await page.getByTestId('sidebar-logout').click();
      await expect(page.getByTestId('auth-submit-button')).toBeVisible();
      await loginUser(page, user.email, user.password);

      await page.getByTestId('header-notifications-button').click();
      const overdueNotification = page
        .getByTestId('recent-notification-item')
        .filter({ hasText: 'Lembrete atrasado' })
        .first();

      await expect(overdueNotification).toContainText('Lembrete em atraso com alerta');
      await overdueNotification.click();

      const taskDetailsDialog = page.getByTestId('task-details-dialog');
      await expect(taskDetailsDialog).toBeVisible();
      await expect(taskDetailsDialog.getByRole('heading', { name: 'Lembrete em atraso com alerta' })).toBeVisible();
    } finally {
      await cleanupUsersByEmail([user.email]);
    }
  });

  test('warns before alarm time and repeats alerts for overdue reminders', async ({ page }) => {
    const user = buildE2ETestUser();
    const upcoming = new Date(Date.now() + 10 * 60 * 1000);
    upcoming.setSeconds(0, 0);
    const upcomingWithoutAlarm = new Date(Date.now() + 12 * 60 * 1000);
    upcomingWithoutAlarm.setSeconds(0, 0);

    const overdue = new Date(Date.now() - 40 * 60 * 1000);
    overdue.setSeconds(0, 0);

    await cleanupUsersByEmail([user.email]);

    try {
      await registerUser(page, user);
      await seedCustomTasksForUser(user.email, [
        {
          title: 'Lembrete prestes a vencer',
          dueDate: upcoming.toISOString(),
          priority: 'high',
          category: 'Trabalho',
          alarmEnabled: true,
        },
        {
          title: 'Lembrete comum prestes a vencer',
          dueDate: upcomingWithoutAlarm.toISOString(),
          priority: 'medium',
          category: 'Geral',
        },
        {
          title: 'Lembrete atrasado recorrente',
          dueDate: overdue.toISOString(),
          priority: 'medium',
          category: 'Pessoal',
        },
      ]);
      await runScheduledNotifications();

      await page.getByTestId('sidebar-logout').click();
      await expect(page.getByTestId('auth-submit-button')).toBeVisible();
      await loginUser(page, user.email, user.password);

      await page.getByTestId('header-notifications-button').click();
      const notificationItems = page.getByTestId('recent-notification-item');

      await expect(notificationItems.filter({ hasText: 'O alarme do seu lembrete vai tocar em 15 minutos!' }).first()).toBeVisible();
      await expect(notificationItems.filter({ hasText: 'Lembrete comum prestes a vencer' }).first()).toBeVisible();
      await expect(notificationItems.filter({ hasText: 'Lembrete atrasado recorrente' }).first()).toBeVisible();
    } finally {
      await cleanupUsersByEmail([user.email]);
    }
  });
});

