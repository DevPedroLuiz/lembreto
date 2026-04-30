import type { SqlClient } from './handlers/core.js';
import { DEFAULT_CATEGORIES } from '../src/types/index.js';

const CATEGORY_LIMIT = 20;
const TAG_LIMIT = 32;

function normalizeUnique(values: string[]) {
  const seen = new Set<string>();
  const next: string[] = [];

  for (const rawValue of values) {
    const value = rawValue.trim();
    if (!value) continue;

    const key = value.toLocaleLowerCase('pt-BR');
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(value);
  }

  return next;
}

export async function ensureTaskTaxonomySchema(sql: SqlClient) {
  await sql`
    ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_tasks_tags_gin
    ON tasks USING GIN(tags)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS user_categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_categories_unique_name
    ON user_categories(user_id, lower(name))
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS user_tags (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_tags_unique_name
    ON user_tags(user_id, lower(name))
  `;
}

export async function upsertUserCategory(sql: SqlClient, userId: string, name: string) {
  await ensureTaskTaxonomySchema(sql);
  const trimmedName = name.trim();
  if (!trimmedName) return;

  await sql`
    INSERT INTO user_categories (user_id, name)
    VALUES (${userId}, ${trimmedName})
    ON CONFLICT (user_id, lower(name)) DO NOTHING
  `;
}

export async function upsertUserTags(sql: SqlClient, userId: string, tags: string[]) {
  await ensureTaskTaxonomySchema(sql);
  const normalizedTags = normalizeUnique(tags).slice(0, TAG_LIMIT);

  for (const tag of normalizedTags) {
    await sql`
      INSERT INTO user_tags (user_id, name)
      VALUES (${userId}, ${tag})
      ON CONFLICT (user_id, lower(name)) DO NOTHING
    `;
  }
}

async function notesTableExists(sql: SqlClient) {
  const rows = await sql`
    SELECT to_regclass('public.notes') IS NOT NULL AS exists
  `;

  return Boolean(rows[0]?.exists);
}

export async function deleteUserCategory(sql: SqlClient, userId: string, name: string) {
  await ensureTaskTaxonomySchema(sql);
  const normalizedName = name.trim();
  if (!normalizedName) return null;

  if (DEFAULT_CATEGORIES.some((category) => category.localeCompare(normalizedName, 'pt-BR', { sensitivity: 'accent' }) === 0)) {
    throw new Error('As categorias padrao nao podem ser excluidas.');
  }

  await sql`
    UPDATE tasks
    SET category = 'Geral'
    WHERE user_id = ${userId}
      AND lower(category) = lower(${normalizedName})
  `;

  if (await notesTableExists(sql)) {
    await sql`
      UPDATE notes
      SET category = 'Geral',
          updated_at = NOW()
      WHERE user_id = ${userId}
        AND lower(category) = lower(${normalizedName})
    `;
  }

  await sql`
    DELETE FROM user_categories
    WHERE user_id = ${userId}
      AND lower(name) = lower(${normalizedName})
  `;

  return normalizedName;
}

export async function deleteUserTag(sql: SqlClient, userId: string, tag: string) {
  await ensureTaskTaxonomySchema(sql);
  const normalizedTag = tag.trim();
  if (!normalizedTag) return null;

  await sql`
    UPDATE tasks
    SET tags = COALESCE(array_remove(tags, ${normalizedTag}), ARRAY[]::TEXT[])
    WHERE user_id = ${userId}
      AND ${normalizedTag} = ANY(tags)
  `;

  if (await notesTableExists(sql)) {
    await sql`
      UPDATE notes
      SET tags = COALESCE(array_remove(tags, ${normalizedTag}), ARRAY[]::TEXT[]),
          updated_at = NOW()
      WHERE user_id = ${userId}
        AND ${normalizedTag} = ANY(tags)
    `;
  }

  await sql`
    DELETE FROM user_tags
    WHERE user_id = ${userId}
      AND lower(name) = lower(${normalizedTag})
  `;

  return normalizedTag;
}

export async function getTaskTaxonomy(sql: SqlClient, userId: string) {
  await ensureTaskTaxonomySchema(sql);

  const categoriesRows = await sql`
    SELECT DISTINCT name
    FROM (
      SELECT name FROM user_categories WHERE user_id = ${userId}
      UNION
      SELECT category AS name FROM tasks WHERE user_id = ${userId}
    ) category_names
    WHERE name IS NOT NULL AND btrim(name) != ''
    ORDER BY name ASC
  `;

  const tagsRows = await sql`
    SELECT DISTINCT tag_name AS name
    FROM (
      SELECT name AS tag_name FROM user_tags WHERE user_id = ${userId}
      UNION
      SELECT unnest(tags) AS tag_name FROM tasks WHERE user_id = ${userId}
    ) tag_names
    WHERE tag_name IS NOT NULL AND btrim(tag_name) != ''
    ORDER BY tag_name ASC
  `;

  const categories = normalizeUnique([
    ...DEFAULT_CATEGORIES,
    ...categoriesRows.map((row) => String(row.name ?? '')),
  ]).slice(0, CATEGORY_LIMIT);

  const tags = normalizeUnique(
    tagsRows.map((row) => String(row.name ?? '')),
  ).slice(0, TAG_LIMIT);

  return { categories, tags };
}

export function sanitizeTaskTags(tags: string[] | undefined) {
  return normalizeUnique(tags ?? []).slice(0, TAG_LIMIT);
}
