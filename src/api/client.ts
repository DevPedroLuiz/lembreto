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
  window.dispatchEvent(new CustomEvent(AUTH_UNAUTHORIZED_EVENT));
}

async function parseJsonSafe(res: Response) {
  return res.json().catch(() => ({}));
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
  if (!res.ok) throw new ApiError((data as any).error || 'Erro desconhecido', res.status);
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
  if (!res.ok) throw new ApiError((data as any).error || 'Erro desconhecido', res.status);
  return data as T;
}

export async function apiGet<T = unknown>(
  path: string,
  token: string
): Promise<T> {
  const res = await fetch(path, { headers: buildHeaders(token) });
  const data = await parseJsonSafe(res);
  emitUnauthorizedIfNeeded(res.status, token);
  if (!res.ok) throw new ApiError((data as any).error || 'Erro desconhecido', res.status);
  return data as T;
}

export async function apiDelete(path: string, token: string): Promise<void> {
  const res = await fetch(path, {
    method: 'DELETE',
    headers: buildHeaders(token),
  });
  emitUnauthorizedIfNeeded(res.status, token);
  if (res.status !== 204 && !res.ok) {
    const d = await parseJsonSafe(res);
    throw new ApiError((d as any).error || 'Erro ao deletar', res.status);
  }
}
