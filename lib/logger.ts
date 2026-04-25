function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return error;
}

function writeLog(level: 'info' | 'warn' | 'error', event: string, data?: Record<string, unknown>) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(data ? { data } : {}),
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
