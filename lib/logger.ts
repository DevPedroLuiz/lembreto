const SENSITIVE_KEY_PATTERN = /authorization|access[_-]?token|refresh[_-]?token|service[_-]?role|jwt|secret|password|cookie|p256dh|auth|endpoint|reset[_-]?link/i;
const SENSITIVE_VALUE_PATTERN = /(Bearer\s+)[A-Za-z0-9._~+/=-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

function redactString(value: string) {
  return value.replace(SENSITIVE_VALUE_PATTERN, (match, bearerPrefix?: string) => (
    bearerPrefix ? `${bearerPrefix}[REDACTED]` : '[REDACTED]'
  ));
}

function sanitizeForLog(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sanitizeForLog);

  const output: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : sanitizeForLog(nestedValue);
  }
  return output;
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactString(error.message),
    };
  }

  return sanitizeForLog(error);
}

function writeLog(level: 'info' | 'warn' | 'error', event: string, data?: Record<string, unknown>) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(data ? { data: sanitizeForLog(data) } : {}),
  };

  const message = JSON.stringify(payload);
  if (level === 'error') {
    console.error(message);
    return;
  }

  if (level === 'warn') {
    console.warn(message);
    return;
  }

  console.log(message);
}

export function logInfo(event: string, data?: Record<string, unknown>) {
  writeLog('info', event, data);
}

export function logWarn(event: string, data?: Record<string, unknown>) {
  writeLog('warn', event, data);
}

export function logError(event: string, error?: unknown, data?: Record<string, unknown>) {
  writeLog('error', event, {
    ...(data ?? {}),
    ...(error !== undefined ? { error: serializeError(error) } : {}),
  });
}
