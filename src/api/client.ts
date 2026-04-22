// src/api/client.ts
// Centralized HTTP client for all API calls

export const buildHeaders = (token?: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

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
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro desconhecido');
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
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro desconhecido');
  return data as T;
}

export async function apiGet<T = unknown>(
  path: string,
  token: string
): Promise<T> {
  const res = await fetch(path, { headers: buildHeaders(token) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro desconhecido');
  return data as T;
}

export async function apiDelete(path: string, token: string): Promise<void> {
  const res = await fetch(path, {
    method: 'DELETE',
    headers: buildHeaders(token),
  });
  if (res.status !== 204 && !res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error((d as any).error || 'Erro ao deletar');
  }
}
