import { randomUUID } from 'node:crypto';
import {
  CALENDAR_FEED_TOKEN_TTL_SECONDS,
  signCalendarFeedToken,
  type CalendarFeedJwtPayload,
} from '../jwt.js';
import type { SqlClient } from '../handlers/core.js';

let calendarFeedSchemaReady: Promise<void> | null = null;

export async function ensureCalendarFeedSchema(sql: SqlClient) {
  calendarFeedSchemaReady ??= (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS calendar_feeds (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_jti TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        last_used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_calendar_feeds_user_active
      ON calendar_feeds(user_id, expires_at DESC)
      WHERE revoked_at IS NULL
    `;
  })().catch((error) => {
    calendarFeedSchemaReady = null;
    throw error;
  });

  return calendarFeedSchemaReady;
}

export async function createCalendarFeedToken(
  sql: SqlClient,
  input: { userId: string; email: string },
) {
  await ensureCalendarFeedSchema(sql);

  const feedId = randomUUID();
  const tokenJti = randomUUID();
  const expiresAt = new Date(Date.now() + CALENDAR_FEED_TOKEN_TTL_SECONDS * 1000);

  await sql`
    INSERT INTO calendar_feeds (id, user_id, token_jti, expires_at)
    VALUES (${feedId}, ${input.userId}, ${tokenJti}, ${expiresAt.toISOString()})
  `;

  return {
    token: signCalendarFeedToken({
      sub: input.userId,
      email: input.email,
      fid: feedId,
      jti: tokenJti,
    }),
    expiresAt: expiresAt.toISOString(),
  };
}

export async function revokeActiveCalendarFeeds(sql: SqlClient, userId: string): Promise<number> {
  await ensureCalendarFeedSchema(sql);

  const rows = await sql`
    UPDATE calendar_feeds
    SET revoked_at = NOW()
    WHERE user_id = ${userId}
      AND revoked_at IS NULL
      AND expires_at > NOW()
    RETURNING id
  `;

  return rows.length;
}

export async function assertCalendarFeedActive(
  sql: SqlClient,
  payload: CalendarFeedJwtPayload,
) {
  await ensureCalendarFeedSchema(sql);

  const rows = await sql`
    SELECT 1
    FROM calendar_feeds
    WHERE id = ${payload.fid}
      AND user_id = ${payload.sub}
      AND token_jti = ${payload.jti}
      AND revoked_at IS NULL
      AND expires_at > NOW()
    LIMIT 1
  `;

  if (rows.length === 0) {
    throw new Error('Calendar feed token revoked or expired');
  }

  await sql`
    UPDATE calendar_feeds
    SET last_used_at = NOW()
    WHERE id = ${payload.fid}
  `;
}
