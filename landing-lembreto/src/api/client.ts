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

export function resolveApiUrl(path: string) {
  if (/^[a-z][a-z\d+\-.]*:/i.test(path) || !configuredApiBaseUrl) {
    return path;
  }

  return `${configuredApiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

async function parseJsonSafe(response: Response) {
  return response.json().catch(() => ({})) as Promise<unknown>;
}

function getApiErrorMessage(data: unknown, fallback: string): string {
  if (typeof data === 'object' && data !== null && 'error' in data) {
    const error = (data as { error?: unknown }).error;
    if (typeof error === 'string' && error.trim().length > 0) return error;
  }

  return fallback;
}

async function fetchWithTimeout(path: string, init: RequestInit = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(resolveApiUrl(path), {
      ...init,
      cache: 'no-store',
      credentials: init.credentials ?? 'include',
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('Tempo esgotado ao falar com o servidor. Tente novamente em instantes.', 408);
    }

    if (error instanceof TypeError) {
      throw new ApiError('Nao foi possivel conectar a API. Verifique a URL configurada e tente novamente.', 0);
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function apiPost<T = unknown>(path: string, body: object, token?: string): Promise<T> {
  const response = await fetchWithTimeout(path, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify(body),
  });
  const data = await parseJsonSafe(response);
  if (!response.ok) throw new ApiError(getApiErrorMessage(data, 'Erro desconhecido'), response.status);
  return data as T;
}
