// ─────────────────────────────────────────────────────────────────────────────
// SUBSTITUIR em src/App.tsx
// As seções abaixo substituem: LS, buildHeaders, apiPost/apiPut/apiGet/apiDelete
// e handleLogout. O restante do App.tsx permanece igual.
// ─────────────────────────────────────────────────────────────────────────────

// ── Session helpers (localStorage apenas para dados não-sensíveis) ────────────
// ANTES: token era o UUID do usuário — qualquer pessoa com o UUID podia se autenticar
// AGORA: token é um JWT assinado com JWT_SECRET, expira em 7 dias, inválido sem a chave
const LS = {
  getSession: (): { user: User; token: string } | null => {
    try {
      const r = localStorage.getItem('tm_session');
      return r ? JSON.parse(r) : null;
    } catch { return null; }
  },
  saveSession: (user: User, token: string) =>
    localStorage.setItem('tm_session', JSON.stringify({ user, token })),
  clearSession: () => localStorage.removeItem('tm_session'),
  getConfig: () => {
    try { return JSON.parse(localStorage.getItem('tm_config') || '{}'); } catch { return {}; }
  },
  saveConfig: (cfg: object) => localStorage.setItem('tm_config', JSON.stringify(cfg)),
};

// ── API Helpers ────────────────────────────────────────────────────────────────
// Header mudou de 'x-user-id: <uuid>' para 'Authorization: Bearer <jwt>'
const buildHeaders = (token?: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

async function apiPost(path: string, body: object, token?: string) {
  const res = await fetch(path, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro desconhecido');
  return data;
}

async function apiPut(path: string, body: object, token: string) {
  const res = await fetch(path, {
    method: 'PUT',
    headers: buildHeaders(token),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro desconhecido');
  return data;
}

async function apiGet(path: string, token: string) {
  const res = await fetch(path, { headers: buildHeaders(token) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro desconhecido');
  return data;
}

async function apiDelete(path: string, token: string) {
  const res = await fetch(path, {
    method: 'DELETE',
    headers: buildHeaders(token),
  });
  if (res.status !== 204 && !res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || 'Erro ao deletar');
  }
}

// ── Logout ─────────────────────────────────────────────────────────────────────
// ANTES: apenas limpava o localStorage
// AGORA: invalida o JWT no servidor (blacklist) e depois limpa o localStorage
// Substitua a função handleLogout existente por esta:
const handleLogout = async () => {
  if (token) {
    // Invalida o token no servidor — fire-and-forget, não bloqueia o logout local
    fetch('/api/auth/logout', {
      method: 'POST',
      headers: buildHeaders(token),
    }).catch(() => {/* ignora falha de rede — o token expira em 7 dias de qualquer forma */});
  }

  LS.clearSession();
  setCurrentUser(null);
  setToken(null);
  setTasks([]);
  setActiveTab('dashboard');
};

// ─────────────────────────────────────────────────────────────────────────────
// ADICIONAR em vercel.json — nova rota de logout:
//   { "source": "/api/auth/logout", "destination": "/api/auth/logout" }
// ─────────────────────────────────────────────────────────────────────────────
