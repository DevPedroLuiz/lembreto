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

const DEFAULT_FETCH_TIMEOUT_MS = 15000;
const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim().replace(/\/+$/, '') ?? '';

function isNativeLocalOrigin() {
  if (typeof window === 'undefined') return false;
  const { protocol, hostname } = window.location;
  return protocol === 'capacitor:' ||
    protocol === 'ionic:' ||
    (protocol === 'https:' && ['localhost', '127.0.0.1', '::1'].includes(hostname));
}

const API_BASE_URL = configuredApiBaseUrl || (isNativeLocalOrigin() ? 'https://lembreto.vercel.app' : '');

interface ApiRequestOptions {
  timeoutMs?: number;
}

export function resolveApiUrl(path: string) {
  if (/^[a-z][a-z\d+\-.]*:/i.test(path) || !API_BASE_URL) {
    return path;
  }

  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
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

async function fetchWithTimeout(path: string, init: RequestInit = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-cache');
  headers.set('Pragma', 'no-cache');
  const url = resolveApiUrl(path);

  try {
    return await fetch(url, {
      ...init,
      cache: 'no-store',
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('Tempo esgotado ao falar com o servidor. Tente novamente em instantes.', 408);
    }

    if (error instanceof TypeError) {
      throw new ApiError(`Nao foi possivel conectar a API (${url}). Verifique sua internet e tente novamente.`, 0);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function apiPost<T = unknown>(
  path: string,
  body: object,
  token?: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const res = await fetchWithTimeout(path, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify(body),
  }, options.timeoutMs);
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
  const res = await fetchWithTimeout(path, {
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
  const res = await fetchWithTimeout(path, { headers: buildHeaders(token) });
  const data = await parseJsonSafe(res);
  emitUnauthorizedIfNeeded(res.status, token);
  if (!res.ok) throw new ApiError(getApiErrorMessage(data, 'Erro desconhecido'), res.status);
  return data as T;
}

export async function apiDelete<T = void>(path: string, token: string, body?: object): Promise<T> {
  const res = await fetchWithTimeout(path, {
    method: 'DELETE',
    headers: buildHeaders(token),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  emitUnauthorizedIfNeeded(res.status, token);
  if (res.status !== 204 && !res.ok) {
    const data = await parseJsonSafe(res);
    throw new ApiError(getApiErrorMessage(data, 'Erro ao deletar'), res.status);
  }
  if (res.status === 204) return undefined as T;
  const data = await parseJsonSafe(res);
  return data as T;
}
