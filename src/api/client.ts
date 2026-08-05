import { Capacitor, CapacitorHttp, type HttpResponse } from '@capacitor/core';
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
  return protocol === 'file:' ||
    protocol === 'capacitor:' ||
    protocol === 'ionic:' ||
    (protocol === 'https:' && ['localhost', '127.0.0.1', '::1'].includes(hostname));
}

const API_BASE_URL = configuredApiBaseUrl || (isNativeLocalOrigin() ? 'https://lembreto.vercel.app' : '');

interface ApiResponse {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
}

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

async function parseJsonSafe(res: ApiResponse) {
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

function normalizeRequestHeaders(headersInit?: HeadersInit) {
  const headers = new Headers(headersInit);
  headers.set('Cache-Control', 'no-cache');
  headers.set('Pragma', 'no-cache');
  return headers;
}

function headersToRecord(headers: Headers) {
  const output: Record<string, string> = {};
  headers.forEach((value, key) => {
    output[key] = value;
  });
  return output;
}

function getNativeRequestData(body: BodyInit | null | undefined) {
  if (typeof body !== 'string') return body ?? undefined;

  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

function createNativeApiResponse(response: HttpResponse): ApiResponse {
  return {
    status: response.status,
    ok: response.status >= 200 && response.status < 300,
    json: async () => {
      if (typeof response.data === 'string') {
        return JSON.parse(response.data || '{}');
      }

      return response.data ?? {};
    },
  };
}

async function fetchWithTimeout(path: string, init: RequestInit = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS): Promise<ApiResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const headers = normalizeRequestHeaders(init.headers);
  const url = resolveApiUrl(path);

  try {
    if (Capacitor.isNativePlatform()) {
      return createNativeApiResponse(await CapacitorHttp.request({
        url,
        method: init.method ?? 'GET',
        headers: headersToRecord(headers),
        data: getNativeRequestData(init.body),
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
        responseType: 'json',
      }));
    }

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
