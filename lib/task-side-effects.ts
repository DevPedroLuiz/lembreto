import {
  removeTaskFromExternalCalendar,
  syncTaskToExternalCalendar,
} from './calendar/calendarSync.js';
import type { SqlClient } from './handlers/core.js';
import { logError, logInfo, logWarn } from './logger.js';
import {
  cancelPendingNotificationSchedulesForTask,
  ensureNotificationSchedulingInfrastructure,
  syncTaskNotificationSchedulesLightweight,
} from './notification-schedules.js';

export type TaskSideEffectKind =
  | 'sync_notification_schedules'
  | 'cancel_notification_schedules'
  | 'sync_external_calendar'
  | 'delete_external_calendar_event';

type TaskSideEffectStatus = 'pending' | 'processing' | 'done' | 'failed' | 'cancelled';

interface TaskSideEffectJob {
  id: string;
  userId: string;
  taskId: string;
  kind: TaskSideEffectKind;
  attempts: number;
  dedupeKey: string;
}

export interface ProcessTaskSideEffectsSummary {
  fetched: number;
  processed: number;
  done: number;
  failed: number;
  retried: number;
  cancelled: number;
  durationMs: number;
  hasMore: boolean;
  stoppedByTimeLimit: boolean;
}

const TASK_SIDE_EFFECT_LIMIT = 10;
const MAX_SIDE_EFFECT_DURATION_MS = 10000;
const STUCK_SIDE_EFFECT_RECLAIM_LIMIT = 10;
const MAX_SIDE_EFFECT_ATTEMPTS = 5;

export function buildTaskSideEffectDedupeKey(userId: string, taskId: string, kind: TaskSideEffectKind) {
  if (kind === 'sync_notification_schedules') return `user:${userId}:task:${taskId}:sync-schedules`;
  if (kind === 'cancel_notification_schedules') return `user:${userId}:task:${taskId}:cancel-schedules`;
  if (kind === 'sync_external_calendar') return `user:${userId}:task:${taskId}:sync-calendar`;
  return `user:${userId}:task:${taskId}:delete-calendar`;
}

export async function ensureTaskSideEffectsInfrastructure(sql: SqlClient) {
  await sql`
    CREATE TABLE IF NOT EXISTS task_side_effects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (
        kind IN (
          'sync_notification_schedules',
          'cancel_notification_schedules',
          'sync_external_calendar',
          'delete_external_calendar_event'
        )
      ),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'done', 'failed', 'cancelled')),
      dedupe_key TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processing_started_at TIMESTAMPTZ,
      done_at TIMESTAMPTZ,
      failed_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_task_side_effects_dedupe
    ON task_side_effects(user_id, dedupe_key)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_task_side_effects_due
    ON task_side_effects(status, available_at)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_task_side_effects_task
    ON task_side_effects(task_id, status)
  `;
}

export async function enqueueTaskSideEffect(
  sql: SqlClient,
  input: {
    userId: string;
    taskId: string;
    kind: TaskSideEffectKind;
    availableAt?: Date;
  },
) {
  const dedupeKey = buildTaskSideEffectDedupeKey(input.userId, input.taskId, input.kind);
  await sql`
    INSERT INTO task_side_effects (
      user_id,
      task_id,
      kind,
      status,
      dedupe_key,
      available_at,
      processing_started_at,
      done_at,
      failed_at,
      cancelled_at,
      error_message,
      updated_at
    )
    VALUES (
      ${input.userId},
      ${input.taskId},
      ${input.kind},
      'pending',
      ${dedupeKey},
      ${input.availableAt ?? new Date()},
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NOW()
    )
    ON CONFLICT (user_id, dedupe_key)
    DO UPDATE SET
      task_id = EXCLUDED.task_id,
      kind = EXCLUDED.kind,
      status = 'pending',
      attempts = 0,
      available_at = EXCLUDED.available_at,
      processing_started_at = NULL,
      done_at = NULL,
      failed_at = NULL,
      cancelled_at = NULL,
      error_message = NULL,
      updated_at = NOW()
  `;
}

export async function userHasActiveExternalCalendarSync(sql: SqlClient, userId: string) {
  const rows = await sql`
    SELECT 1
    FROM calendar_integrations
    WHERE user_id = ${userId}
      AND sync_enabled = TRUE
    LIMIT 1
  `;
  return rows.length > 0;
}

function mapJob(row: Record<string, unknown>): TaskSideEffectJob {
  return {
    id: String(row.id),
    userId: String(row.userId),
    taskId: String(row.taskId),
    kind: String(row.kind) as TaskSideEffectKind,
    attempts: typeof row.attempts === 'number' ? row.attempts : Number(row.attempts ?? 0),
    dedupeKey: String(row.dedupeKey),
  };
}

async function reclaimStuckProcessingSideEffects(sql: SqlClient, limit: number) {
  const rows = await sql`
    WITH stuck AS (
      SELECT id
      FROM task_side_effects
      WHERE status = 'processing'
        AND processing_started_at < NOW() - INTERVAL '10 minutes'
      ORDER BY processing_started_at ASC NULLS FIRST, available_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE task_side_effects
    SET
      status = 'pending',
      processing_started_at = NULL,
      available_at = NOW(),
      error_message = 'reclaimed_stuck_processing',
      updated_at = NOW()
    WHERE id IN (SELECT id FROM stuck)
    RETURNING id
  `;

  return rows.length;
}

async function claimDueSideEffects(sql: SqlClient, limit: number) {
  const rows = await sql`
    WITH due AS (
      SELECT id
      FROM task_side_effects
      WHERE status = 'pending'
        AND available_at <= NOW()
      ORDER BY available_at ASC, created_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE task_side_effects
    SET
      status = 'processing',
      processing_started_at = NOW(),
      updated_at = NOW()
    WHERE id IN (SELECT id FROM due)
    RETURNING
      id,
      user_id AS "userId",
      task_id AS "taskId",
      kind,
      attempts,
      dedupe_key AS "dedupeKey"
  `;

  return rows.map(mapJob);
}

async function updateJobStatus(
  sql: SqlClient,
  jobId: string,
  status: TaskSideEffectStatus,
  errorMessage?: string,
  availableAt?: Date,
) {
  await sql`
    UPDATE task_side_effects
    SET
      status = ${status},
      attempts = CASE WHEN ${status} IN ('pending', 'failed') THEN attempts + 1 ELSE attempts END,
      available_at = COALESCE(${availableAt ?? null}, available_at),
      processing_started_at = CASE WHEN ${status} = 'processing' THEN processing_started_at ELSE NULL END,
      done_at = CASE WHEN ${status} = 'done' THEN NOW() ELSE done_at END,
      failed_at = CASE WHEN ${status} = 'failed' THEN NOW() ELSE failed_at END,
      cancelled_at = CASE WHEN ${status} = 'cancelled' THEN NOW() ELSE cancelled_at END,
      error_message = ${errorMessage ?? null},
      updated_at = NOW()
    WHERE id = ${jobId}
      AND status = 'processing'
  `;
}

function getRetryAvailableAt(attemptsBeforeFailure: number) {
  const nextAttempt = attemptsBeforeFailure + 1;
  const backoffMinutes = Math.min(30, 2 ** Math.max(0, nextAttempt - 1));
  return new Date(Date.now() + backoffMinutes * 60 * 1000);
}

async function taskExists(sql: SqlClient, userId: string, taskId: string) {
  const rows = await sql`
    SELECT 1
    FROM tasks
    WHERE id = ${taskId}
      AND user_id = ${userId}
    LIMIT 1
  `;
  return rows.length > 0;
}

async function processSingleSideEffect(sql: SqlClient, job: TaskSideEffectJob) {
  if (job.kind === 'sync_notification_schedules') {
    await syncTaskNotificationSchedulesLightweight(sql, job.userId, job.taskId, {
      ensureInfrastructure: false,
    });
    return;
  }

  if (job.kind === 'cancel_notification_schedules') {
    await cancelPendingNotificationSchedulesForTask(sql, job.taskId, job.userId, {
      ensureInfrastructure: false,
    });
    return;
  }

  if (!(await taskExists(sql, job.userId, job.taskId))) {
    return;
  }

  if (job.kind === 'sync_external_calendar') {
    const result = await syncTaskToExternalCalendar({
      sql,
      userId: job.userId,
      taskId: job.taskId,
    });
    if (!result.ok) throw new Error(result.error ?? 'Falha ao sincronizar calendario externo');
    return;
  }

  const result = await removeTaskFromExternalCalendar({
    sql,
    userId: job.userId,
    taskId: job.taskId,
    clearLocalState: true,
  });
  if (!result.ok) throw new Error(result.error ?? 'Falha ao remover evento externo');
}

export async function processTaskSideEffects(
  sql: SqlClient,
  limit = TASK_SIDE_EFFECT_LIMIT,
  maxDurationMs = MAX_SIDE_EFFECT_DURATION_MS,
): Promise<ProcessTaskSideEffectsSummary> {
  const startedAt = Date.now();
  const processLimit = Math.min(Math.max(1, limit), TASK_SIDE_EFFECT_LIMIT);

  await ensureTaskSideEffectsInfrastructure(sql);
  await ensureNotificationSchedulingInfrastructure(sql);
  const reclaimed = await reclaimStuckProcessingSideEffects(sql, STUCK_SIDE_EFFECT_RECLAIM_LIMIT);
  if (reclaimed > 0) {
    logWarn('task_side_effects_reclaimed', { reclaimed });
  }

  const jobs = await claimDueSideEffects(sql, processLimit);
  const summary: ProcessTaskSideEffectsSummary = {
    fetched: jobs.length,
    processed: 0,
    done: 0,
    failed: 0,
    retried: 0,
    cancelled: 0,
    durationMs: 0,
    hasMore: reclaimed >= STUCK_SIDE_EFFECT_RECLAIM_LIMIT || jobs.length >= processLimit,
    stoppedByTimeLimit: false,
  };

  for (const job of jobs) {
    if (Date.now() - startedAt >= maxDurationMs) {
      summary.hasMore = true;
      summary.stoppedByTimeLimit = true;
      await updateJobStatus(sql, job.id, 'pending', 'side_effect_time_limit', new Date());
      continue;
    }

    try {
      await processSingleSideEffect(sql, job);
      await updateJobStatus(sql, job.id, 'done');
      summary.done += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      const attemptsAfterFailure = job.attempts + 1;
      if (attemptsAfterFailure >= MAX_SIDE_EFFECT_ATTEMPTS) {
        await updateJobStatus(sql, job.id, 'failed', message);
        summary.failed += 1;
      } else {
        await updateJobStatus(sql, job.id, 'pending', message, getRetryAvailableAt(job.attempts));
        summary.retried += 1;
        summary.hasMore = true;
      }
      logError('task_side_effect_failed', error, {
        userId: job.userId,
        taskId: job.taskId,
        jobId: job.id,
        kind: job.kind,
        attempts: attemptsAfterFailure,
      });
    } finally {
      summary.processed += 1;
    }
  }

  summary.durationMs = Date.now() - startedAt;
  logInfo('side-effects:processed', {
    fetched: summary.fetched,
    processed: summary.processed,
    done: summary.done,
    failed: summary.failed,
    retried: summary.retried,
    durationMs: summary.durationMs,
    hasMore: summary.hasMore,
    stoppedByTimeLimit: summary.stoppedByTimeLimit,
  });
  logInfo('side-effects:duration-ms', { durationMs: summary.durationMs });

  return summary;
}
