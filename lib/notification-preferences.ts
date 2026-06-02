import type { SqlClient } from './handlers/core.js';
import { assertInfrastructure } from './infrastructure.js';

export type CategoryMessageTemplates = Record<string, string>;

export interface NotificationPreferences {
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  mutedCategories: string[];
  categoryMessageTemplates: CategoryMessageTemplates;
}

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  mutedCategories: [],
  categoryMessageTemplates: {},
};

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
let notificationPreferencesInfrastructureReady: Promise<void> | null = null;

function normalizeTime(value: unknown, fallback: string) {
  return typeof value === 'string' && TIME_PATTERN.test(value) ? value : fallback;
}

function normalizeCategoryList(value: unknown) {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  return value
    .map((item) => (typeof item === 'string' ? item.trim().replace(/\s+/g, ' ') : ''))
    .filter((item) => {
      if (!item || item.length > 40 || seen.has(item.toLocaleLowerCase('pt-BR'))) return false;
      seen.add(item.toLocaleLowerCase('pt-BR'));
      return true;
    })
    .slice(0, 80);
}

function normalizeTemplates(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([category, template]) => [
        category.trim().replace(/\s+/g, ' '),
        typeof template === 'string' ? template.trim() : '',
      ])
      .filter(([category, template]) => category && category.length <= 40 && template && template.length <= 500)
      .slice(0, 80),
  );
}

export function normalizeNotificationPreferences(input: Partial<NotificationPreferences> | null | undefined): NotificationPreferences {
  return {
    quietHoursEnabled: Boolean(input?.quietHoursEnabled),
    quietHoursStart: normalizeTime(input?.quietHoursStart, DEFAULT_NOTIFICATION_PREFERENCES.quietHoursStart),
    quietHoursEnd: normalizeTime(input?.quietHoursEnd, DEFAULT_NOTIFICATION_PREFERENCES.quietHoursEnd),
    mutedCategories: normalizeCategoryList(input?.mutedCategories),
    categoryMessageTemplates: normalizeTemplates(input?.categoryMessageTemplates),
  };
}

export async function ensureNotificationPreferencesInfrastructure(sql: SqlClient) {
  notificationPreferencesInfrastructureReady ??= assertInfrastructure(sql, 'notification preferences', {
    relations: [
      { name: 'notification_preferences' },
    ],
    columns: [
      { table: 'notification_preferences', column: 'user_id' },
      { table: 'notification_preferences', column: 'quiet_hours_enabled' },
      { table: 'notification_preferences', column: 'quiet_hours_start' },
      { table: 'notification_preferences', column: 'quiet_hours_end' },
      { table: 'notification_preferences', column: 'muted_categories' },
      { table: 'notification_preferences', column: 'category_message_templates' },
      { table: 'notification_preferences', column: 'updated_at' },
    ],
  }).catch((error) => {
    notificationPreferencesInfrastructureReady = null;
    throw error;
  });

  await notificationPreferencesInfrastructureReady;
}

export async function getNotificationPreferences(sql: SqlClient, userId: string) {
  await ensureNotificationPreferencesInfrastructure(sql);

  const rows = await sql`
    SELECT
      quiet_hours_enabled AS "quietHoursEnabled",
      quiet_hours_start AS "quietHoursStart",
      quiet_hours_end AS "quietHoursEnd",
      muted_categories AS "mutedCategories",
      category_message_templates AS "categoryMessageTemplates"
    FROM notification_preferences
    WHERE user_id = ${userId}
    LIMIT 1
  `;

  return normalizeNotificationPreferences(rows[0] as Partial<NotificationPreferences> | undefined);
}

export async function setNotificationPreferences(
  sql: SqlClient,
  userId: string,
  input: Partial<NotificationPreferences>,
) {
  await ensureNotificationPreferencesInfrastructure(sql);
  const preferences = normalizeNotificationPreferences(input);

  await sql`
    INSERT INTO notification_preferences (
      user_id,
      quiet_hours_enabled,
      quiet_hours_start,
      quiet_hours_end,
      muted_categories,
      category_message_templates,
      updated_at
    )
    VALUES (
      ${userId},
      ${preferences.quietHoursEnabled},
      ${preferences.quietHoursStart},
      ${preferences.quietHoursEnd},
      ${preferences.mutedCategories},
      ${JSON.stringify(preferences.categoryMessageTemplates)}::jsonb,
      NOW()
    )
    ON CONFLICT (user_id)
    DO UPDATE SET
      quiet_hours_enabled = EXCLUDED.quiet_hours_enabled,
      quiet_hours_start = EXCLUDED.quiet_hours_start,
      quiet_hours_end = EXCLUDED.quiet_hours_end,
      muted_categories = EXCLUDED.muted_categories,
      category_message_templates = EXCLUDED.category_message_templates,
      updated_at = NOW()
  `;

  return preferences;
}
