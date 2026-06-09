export interface SqlClient {
  (
    strings: TemplateStringsArray,
    ...params: unknown[]
  ): Promise<Array<Record<string, unknown>>>;
  json?: (value: unknown) => unknown;
  begin?: <T>(callback: (sql: SqlClient) => Promise<T>) => Promise<T>;
}

export interface HandlerRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  query?: Record<string, unknown>;
  params?: Record<string, string | undefined>;
  ip?: string;
  requestId?: string;
}

export interface HandlerContext {
  sql: SqlClient;
  request: HandlerRequest;
  defaultAppUrl?: string;
}

export interface HandlerResult {
  status: number;
  body?: unknown;
  headers?: Record<string, string | string[]>;
}

interface ResponseLike {
  setHeader: (name: string, value: string | string[]) => void;
  status: (status: number) => {
    send: (body: string) => unknown;
    end: () => unknown;
    json: (body: unknown) => unknown;
  };
}

interface RequestLike {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
  query?: Record<string, unknown>;
  params?: Record<string, string | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
  requestId?: string;
}

export function json(
  status: number,
  body: unknown,
  headers?: Record<string, string | string[]>,
): HandlerResult {
  return { status, body, headers };
}

export function empty(
  status: number,
  headers?: Record<string, string | string[]>,
): HandlerResult {
  return { status, headers };
}

export function methodNotAllowed(): HandlerResult {
  return json(405, { error: 'Método não permitido' });
}

function normalizeOrigin(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function getConfiguredCorsOrigins() {
  const values = [
    process.env.APP_URL,
    process.env.CORS_ALLOWED_ORIGINS,
  ].filter(Boolean).flatMap((value) => String(value).split(','));

  return new Set(values.map(normalizeOrigin).filter(Boolean));
}

function isLocalNativeOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch {
    return origin === 'capacitor://localhost' || origin === 'ionic://localhost';
  }
}

function buildCorsHeaders(request?: HandlerRequest): Record<string, string> {
  const originHeader = request?.headers.origin;
  const origin = typeof originHeader === 'string' ? normalizeOrigin(originHeader) : '';
  if (!origin) return {};

  const allowedOrigins = getConfiguredCorsOrigins();
  const allowed = allowedOrigins.has(origin) || isLocalNativeOrigin(origin);
  if (!allowed) return {};

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function handleCorsPreflight(request: HandlerRequest): HandlerResult | null {
  if (request.method !== 'OPTIONS') return null;
  return empty(204, buildCorsHeaders(request));
}

export function getRequestIp(request: HandlerRequest): string {
  const forwardedFor = request.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }

  return request.ip ?? 'unknown';
}

export function getRequestMeta(
  request: HandlerRequest,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(extra ?? {}),
    ...(request.requestId ? { requestId: request.requestId } : {}),
  };
}

export function sendHandlerResult(res: ResponseLike, result: HandlerResult, request?: HandlerRequest) {
  if (!result.headers?.['Cache-Control']) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }

  const corsHeaders = buildCorsHeaders(request);
  for (const [name, value] of Object.entries(corsHeaders)) {
    res.setHeader(name, value);
  }

  if (result.headers) {
    for (const [name, value] of Object.entries(result.headers)) {
      res.setHeader(name, value);
    }
  }

  if (result.status === 204) {
    return res.status(204).send('');
  }

  if (result.body === undefined) {
    return res.status(result.status).end();
  }

  if (typeof result.body === 'string') {
    return res.status(result.status).send(result.body);
  }

  return res.status(result.status).json(result.body);
}

export function buildHandlerRequest(req: RequestLike): HandlerRequest {
  return {
    method: req.method,
    headers: req.headers ?? {},
    body: req.body,
    query: req.query,
    params: req.params,
    ip:
      req.ip ??
      req.socket?.remoteAddress ??
      (typeof req.headers?.['x-forwarded-for'] === 'string'
        ? req.headers['x-forwarded-for'].split(',')[0].trim()
        : undefined),
    requestId: req.requestId,
  };
}
