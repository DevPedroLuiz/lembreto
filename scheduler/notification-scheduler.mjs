import http from 'node:http';

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_BACKLOG_INTERVAL_MS = 5_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 25_000;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 10_000;
const MIN_INTERVAL_MS = 10_000;
const DEFAULT_HEALTH_PORT = 8080;
const DEFAULT_STALE_AFTER_MS = 180_000;

let timer = null;
let stopped = false;
let running = false;
let healthServer = null;

const state = {
  startedAt: new Date().toISOString(),
  lastRunStartedAt: null,
  lastRunFinishedAt: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastStatusCode: null,
  lastError: null,
  lastDurationMs: null,
  lastResponse: null,
  nextRunAt: null,
  runCount: 0,
  successCount: 0,
  failureCount: 0,
  consecutiveFailures: 0,
};

class SchedulerHttpError extends Error {
  constructor(status, bodyText) {
    super(`cron_http_${status}`);
    this.name = 'SchedulerHttpError';
    this.status = status;
    this.bodyText = bodyText;
  }
}

function log(level, event, details = {}) {
  const record = {
    level,
    event,
    time: new Date().toISOString(),
    ...details,
  };

  const line = JSON.stringify(record);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function parsePositiveInteger(name, fallback, options = {}) {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    log('warn', 'invalid_env_number', { name, value: raw, fallback });
    return fallback;
  }

  return options.min ? Math.max(options.min, parsed) : parsed;
}

function parseBoolean(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'yes';
}

function resolveTargetUrl() {
  const explicit = process.env.SCHEDULER_TARGET_URL || process.env.CRON_TARGET_URL;
  if (explicit) return new URL(explicit).toString();

  const base = process.env.LEMBRETO_APP_URL || process.env.APP_URL;
  if (base) return new URL('/api/cron/notifications', base).toString();

  throw new Error('Set SCHEDULER_TARGET_URL or APP_URL.');
}

function loadConfig() {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) throw new Error('Set CRON_SECRET with the same value configured in Vercel.');

  return {
    targetUrl: resolveTargetUrl(),
    cronSecret,
    intervalMs: parsePositiveInteger('SCHEDULER_INTERVAL_MS', DEFAULT_INTERVAL_MS, { min: MIN_INTERVAL_MS }),
    backlogIntervalMs: parsePositiveInteger('SCHEDULER_BACKLOG_INTERVAL_MS', DEFAULT_BACKLOG_INTERVAL_MS, {
      min: 1_000,
    }),
    requestTimeoutMs: parsePositiveInteger('SCHEDULER_REQUEST_TIMEOUT_MS', DEFAULT_REQUEST_TIMEOUT_MS),
    retryAttempts: parsePositiveInteger('SCHEDULER_RETRY_ATTEMPTS', DEFAULT_RETRY_ATTEMPTS),
    retryBaseDelayMs: parsePositiveInteger('SCHEDULER_RETRY_BASE_DELAY_MS', DEFAULT_RETRY_BASE_DELAY_MS),
    retryMaxDelayMs: parsePositiveInteger('SCHEDULER_RETRY_MAX_DELAY_MS', DEFAULT_RETRY_MAX_DELAY_MS),
    runOnStart: parseBoolean('SCHEDULER_RUN_ON_START', true),
    healthEnabled: parseBoolean('SCHEDULER_HEALTH_ENABLED', true),
    healthPort: parsePositiveInteger('PORT', parsePositiveInteger('SCHEDULER_HEALTH_PORT', DEFAULT_HEALTH_PORT)),
    staleAfterMs: parsePositiveInteger('SCHEDULER_STALE_AFTER_MS', DEFAULT_STALE_AFTER_MS),
    exitAfterConsecutiveFailures: parsePositiveInteger('SCHEDULER_EXIT_AFTER_CONSECUTIVE_FAILURES', 0),
  };
}

let config = null;
let configError = null;

function configureScheduler() {
  try {
    config = loadConfig();
    configError = null;
    state.lastError = null;
    return true;
  } catch (error) {
    config = null;
    configError = error instanceof Error ? error.message : String(error);
    state.lastError = configError;
    state.lastFailureAt = new Date().toISOString();
    log('error', 'scheduler_configuration_failed', { error: configError });
    return false;
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function jitter(ms) {
  const spread = Math.floor(ms * 0.25);
  return Math.max(0, ms - spread + Math.floor(Math.random() * spread * 2));
}

function getRetryDelay(attempt) {
  if (!config) return DEFAULT_RETRY_BASE_DELAY_MS;
  const exponential = config.retryBaseDelayMs * 2 ** Math.max(0, attempt - 1);
  return jitter(Math.min(config.retryMaxDelayMs, exponential));
}

function isTransientError(error) {
  if (error instanceof SchedulerHttpError) {
    return error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
  }

  return true;
}

async function invokeCron() {
  if (!config) throw new Error(configError ?? 'scheduler_not_configured');

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const response = await fetch(config.targetUrl, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${config.cronSecret}`,
        accept: 'application/json',
        'user-agent': 'lembreto-notification-scheduler/1.0',
        'x-lembreto-scheduler': 'external',
      },
      signal: controller.signal,
      cache: 'no-store',
    });
    const bodyText = await response.text();

    if (!response.ok) {
      throw new SchedulerHttpError(response.status, bodyText.slice(0, 500));
    }

    let body = null;
    if (bodyText) {
      try {
        body = JSON.parse(bodyText);
      } catch {
        body = { raw: bodyText.slice(0, 500) };
      }
    }

    return {
      status: response.status,
      durationMs: Date.now() - startedAt,
      body,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeResponse(body) {
  if (!body || typeof body !== 'object') return null;

  const processedSchedules = body.schedules?.processed ?? body.processedSchedules ?? 0;
  const sentSchedules = body.schedules?.sent ?? body.sentSchedules ?? 0;
  const failedSchedules = body.schedules?.failed ?? body.failedSchedules ?? 0;
  const reclaimedSchedules = body.schedules?.reclaimed ?? body.reclaimedSchedules ?? 0;
  const sideEffectsProcessed = body.sideEffects?.processed ?? 0;
  const backfilledSchedules = body.backfill?.backfilledSchedules ?? body.backfilledSchedules ?? 0;
  const detectedOverdueTasks = body.overdueDetection?.detectedOverdueTasks ?? body.detectedOverdueTasks ?? 0;
  const hasMore = Boolean(body.hasMore || body.schedules?.hasMore || body.sideEffects?.hasMore);
  const movedWork =
    processedSchedules > 0 ||
    sentSchedules > 0 ||
    failedSchedules > 0 ||
    reclaimedSchedules > 0 ||
    sideEffectsProcessed > 0 ||
    backfilledSchedules > 0 ||
    detectedOverdueTasks > 0;

  return {
    ok: body.ok ?? null,
    hasMore,
    shouldAccelerate: hasMore && movedWork,
    processedSchedules,
    sentSchedules,
    failedSchedules,
    reclaimedSchedules,
    sideEffectsProcessed,
    backfilledSchedules,
    detectedOverdueTasks,
    durationMs: body.durationMs ?? null,
  };
}

async function runCronWithRetry() {
  if (!config) throw new Error(configError ?? 'scheduler_not_configured');

  let lastError = null;

  for (let attempt = 1; attempt <= config.retryAttempts; attempt += 1) {
    try {
      return await invokeCron();
    } catch (error) {
      lastError = error;
      const transient = isTransientError(error);
      const canRetry = transient && attempt < config.retryAttempts;

      log(canRetry ? 'warn' : 'error', 'cron_attempt_failed', {
        attempt,
        maxAttempts: config.retryAttempts,
        retrying: canRetry,
        error: error instanceof Error ? error.message : String(error),
        status: error instanceof SchedulerHttpError ? error.status : null,
      });

      if (!canRetry) break;
      await delay(getRetryDelay(attempt));
    }
  }

  throw lastError;
}

async function runCycle(reason) {
  if (!config) {
    log('warn', 'cron_cycle_skipped_unconfigured', { reason, error: configError });
    return DEFAULT_INTERVAL_MS;
  }

  if (running) {
    log('warn', 'cron_cycle_skipped_overlap', { reason });
    return config.intervalMs;
  }

  running = true;
  state.runCount += 1;
  state.lastRunStartedAt = new Date().toISOString();
  state.lastError = null;

  log('info', 'cron_cycle_started', {
    reason,
    runCount: state.runCount,
    targetUrl: config.targetUrl,
  });

  try {
    const result = await runCronWithRetry();
    const summary = summarizeResponse(result.body);

    state.successCount += 1;
    state.consecutiveFailures = 0;
    state.lastSuccessAt = new Date().toISOString();
    state.lastRunFinishedAt = state.lastSuccessAt;
    state.lastStatusCode = result.status;
    state.lastDurationMs = result.durationMs;
    state.lastResponse = summary;

    log('info', 'cron_cycle_succeeded', {
      status: result.status,
      durationMs: result.durationMs,
      response: summary,
    });

    return summary?.shouldAccelerate ? config.backlogIntervalMs : config.intervalMs;
  } catch (error) {
    state.failureCount += 1;
    state.consecutiveFailures += 1;
    state.lastFailureAt = new Date().toISOString();
    state.lastRunFinishedAt = state.lastFailureAt;
    state.lastStatusCode = error instanceof SchedulerHttpError ? error.status : null;
    state.lastError = error instanceof Error ? error.message : String(error);
    state.lastResponse = error instanceof SchedulerHttpError ? { body: error.bodyText } : null;

    log('error', 'cron_cycle_failed', {
      consecutiveFailures: state.consecutiveFailures,
      error: state.lastError,
      status: state.lastStatusCode,
    });

    if (
      config.exitAfterConsecutiveFailures > 0 &&
      state.consecutiveFailures >= config.exitAfterConsecutiveFailures
    ) {
      log('error', 'scheduler_exiting_after_failures', {
        consecutiveFailures: state.consecutiveFailures,
      });
      process.exitCode = 1;
      await shutdown();
    }

    return config.intervalMs;
  } finally {
    running = false;
  }
}

function scheduleNext(delayMs, reason = 'interval') {
  if (stopped) return;

  const safeDelay = Math.max(1_000, delayMs);
  state.nextRunAt = new Date(Date.now() + safeDelay).toISOString();
  timer = setTimeout(async () => {
    timer = null;
    const nextDelay = await runCycle(reason);
    scheduleNext(nextDelay, 'interval');
  }, safeDelay);
}

function getHealthStatus() {
  const now = Date.now();
  const lastSuccessMs = state.lastSuccessAt ? Date.parse(state.lastSuccessAt) : null;
  const staleAfterMs = config?.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const stale = lastSuccessMs === null
    ? state.runCount > 0
    : now - lastSuccessMs > staleAfterMs;

  return {
    ok: Boolean(config) && !stale && state.consecutiveFailures === 0,
    configured: Boolean(config),
    configError,
    stale,
    running,
    uptimeSeconds: Math.floor(process.uptime()),
    config: config ? {
      targetUrl: config.targetUrl,
      intervalMs: config.intervalMs,
      backlogIntervalMs: config.backlogIntervalMs,
      requestTimeoutMs: config.requestTimeoutMs,
      retryAttempts: config.retryAttempts,
    } : null,
    state,
  };
}

function startHealthServer() {
  const healthEnabled = parseBoolean('SCHEDULER_HEALTH_ENABLED', true);
  if (!healthEnabled) return;

  const healthPort = parsePositiveInteger(
    'PORT',
    parsePositiveInteger('SCHEDULER_HEALTH_PORT', DEFAULT_HEALTH_PORT),
  );

  healthServer = http.createServer((request, response) => {
    if (request.url !== '/health' && request.url !== '/ready') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'not_found' }));
      return;
    }

    const health = getHealthStatus();
    response.writeHead(health.ok ? 200 : 503, { 'content-type': 'application/json' });
    response.end(JSON.stringify(health));
  });

  healthServer.listen(healthPort, () => {
    log('info', 'health_server_started', { port: healthPort });
  });
}

async function shutdown() {
  if (stopped) return;
  stopped = true;

  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  if (healthServer) {
    await new Promise((resolve) => healthServer.close(resolve));
    healthServer = null;
  }

  log('info', 'scheduler_stopped');
}

process.on('SIGINT', () => {
  void shutdown().then(() => process.exit(0));
});

process.on('SIGTERM', () => {
  void shutdown().then(() => process.exit(0));
});

process.on('uncaughtException', (error) => {
  log('error', 'uncaught_exception', { error: error instanceof Error ? error.stack : String(error) });
});

process.on('unhandledRejection', (error) => {
  log('error', 'unhandled_rejection', { error: error instanceof Error ? error.stack : String(error) });
});

startHealthServer();

if (configureScheduler() && config) {
  log('info', 'scheduler_started', {
    targetUrl: config.targetUrl,
    intervalMs: config.intervalMs,
    backlogIntervalMs: config.backlogIntervalMs,
  });

  if (config.runOnStart) {
    const nextDelay = await runCycle('startup');
    scheduleNext(nextDelay, 'interval');
  } else {
    scheduleNext(config.intervalMs, 'interval');
  }
} else {
  log('warn', 'scheduler_waiting_for_valid_configuration');
}
