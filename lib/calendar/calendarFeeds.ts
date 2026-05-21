import { randomUUID } from 'node:crypto';
import {
  CALENDAR_FEED_TOKEN_TTL_SECONDS,
  signCalendarFeedToken,
  type CalendarFeedJwtPayload,
} from '../jwt.js';
import type { SqlClient } from '../handlers/core.js';
import { assertInfrastructure } from '../infrastructure.js';

let calendarFeedSchemaReady: Promise<void> | null = null;

export async function ensureCalendarFeedSchema(sql: SqlClient) {
  calendarFeedSchemaReady ??= (async () => {
    await assertInfrastructure(sql, 'calendar feeds', {
      relations: [
        { name: 'calendar_feeds' },
      ],
      columns: [
        { table: 'calendar_feeds', column: 'user_id' },
        { table: 'calendar_feeds', column: 'token_jti' },
        { table: 'calendar_feeds', column: 'expires_at' },
        { table: 'calendar_feeds', column: 'revoked_at' },
        { table: 'calendar_feeds', column: 'last_used_at' },
      ],
      indexes: [
        { name: 'idx_calendar_feeds_user_active' },
      ],
    });
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
