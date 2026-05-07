export interface SqlClient {
  (
    strings: TemplateStringsArray,
    ...params: unknown[]
  ): Promise<Array<Record<string, unknown>>>;
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

export function sendHandlerResult(res: ResponseLike, result: HandlerResult) {
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
