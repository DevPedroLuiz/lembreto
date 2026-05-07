import { AUTH_UNAUTHORIZED_EVENT } from '../lib/authEvents';

export const buildHeaders = (token?: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function emitUnauthorizedIfNeeded(status: number, token?: string) {
  if (status !== 401 || !token || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(AUTH_UNAUTHORIZED_EVENT, { detail: { token } }));
}

async function parseJsonSafe(res: Response) {
  return res.json().catch(() => ({})) as Promise<unknown>;
}

function getApiErrorMessage(data: unknown, fallback: string): string {
  if (typeof data === 'object' && data !== null && 'error' in data) {
    const error = (data as { error?: unknown }).error;
    if (typeof error === 'string' && error.trim().length > 0) {
      return error;
    }
  }

  return fallback;
}

export async function apiPost<T = unknown>(
  path: string,
  body: object,
  token?: string
): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify(body),
  });
  const data = await parseJsonSafe(res);
  emitUnauthorizedIfNeeded(res.status, token);
  if (!res.ok) throw new ApiError(getApiErrorMessage(data, 'Erro desconhecido'), res.status);
  return data as T;
}

export async function apiPut<T = unknown>(
  path: string,
  body: object,
  token: string
): Promise<T> {
  const res = await fetch(path, {
    method: 'PUT',
    headers: buildHeaders(token),
    body: JSON.stringify(body),
  });
  const data = await parseJsonSafe(res);
  emitUnauthorizedIfNeeded(res.status, token);
  if (!res.ok) throw new ApiError(getApiErrorMessage(data, 'Erro desconhecido'), res.status);
  return data as T;
}

export async function apiGet<T = unknown>(
  path: string,
  token: string
): Promise<T> {
  const res = await fetch(path, { headers: buildHeaders(token) });
  const data = await parseJsonSafe(res);
  emitUnauthorizedIfNeeded(res.status, token);
  if (!res.ok) throw new ApiError(getApiErrorMessage(data, 'Erro desconhecido'), res.status);
  return data as T;
}

export async function apiDelete(path: string, token: string, body?: object): Promise<void> {
  const res = await fetch(path, {
    method: 'DELETE',
    headers: buildHeaders(token),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  emitUnauthorizedIfNeeded(res.status, token);
  if (res.status !== 204 && !res.ok) {
    const data = await parseJsonSafe(res);
    throw new ApiError(getApiErrorMessage(data, 'Erro ao deletar'), res.status);
  }
}
