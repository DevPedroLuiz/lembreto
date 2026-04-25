// src/pages/ResetPage.tsx
import React, { useState } from 'react';
import { Lock, CheckCircle2 } from 'lucide-react';
import { apiPost } from '../api/client';

export function ResetPage() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) { setError('A senha deve ter no mínimo 6 caracteres.'); return; }
    if (password !== confirm) { setError('As senhas não coincidem.'); return; }
    setLoading(true);
    try {
      await apiPost('/api/auth/reset-password', { token, password });
      setSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao redefinir senha.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50 dark:bg-[#040814]">
      <div className="max-w-md w-full bg-white dark:bg-[#0a122a] rounded-3xl p-8 shadow-2xl border border-slate-200 dark:border-white/10">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl mx-auto flex items-center justify-center mb-4 text-white shadow-lg shadow-blue-500/20">
            <Lock size={32} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Lembreto</h1>
          <p className="text-slate-500 mt-2 text-sm">
            {success ? 'Senha redefinida!' : 'Crie uma nova senha'}
          </p>
        </div>

        {success ? (
          <div className="space-y-4 text-center">
            <CheckCircle2 size={48} className="mx-auto text-emerald-500" />
            <p className="text-slate-600 dark:text-slate-300 text-sm">
              Sua senha foi redefinida com sucesso.
            </p>
            <a
              href="/"
              className="block w-full bg-blue-600 hover:bg-blue-700 text-white rounded-2xl py-3.5 font-bold transition-all active:scale-95 text-center"
            >
              Ir para o Login
            </a>
          </div>
        ) : !token ? (
          <div className="text-center space-y-4">
            <p className="text-rose-500 font-medium text-sm">Link inválido ou expirado.</p>
            <a href="/" className="block w-full bg-blue-600 hover:bg-blue-700 text-white rounded-2xl py-3.5 font-bold text-center">
              Voltar ao Login
            </a>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                required
                type="password"
                data-testid="reset-password-input"
                placeholder="Nova senha (mín. 6 caracteres)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 rounded-2xl py-3.5 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white text-sm"
              />
            </div>
            <div className="relative">
              <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                required
                type="password"
                data-testid="reset-confirm-input"
                placeholder="Confirmar nova senha"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 rounded-2xl py-3.5 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white text-sm"
              />
            </div>
            {error && <p className="text-rose-500 text-sm text-center font-medium">{error}</p>}
            <button
              type="submit"
              data-testid="reset-submit-button"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-2xl py-3.5 font-bold transition-all active:scale-95"
            >
              {loading ? 'Salvando...' : 'Redefinir Senha'}
            </button>
            <p className="text-center text-sm">
              <a href="/" className="text-blue-600 font-semibold hover:underline">
                Voltar ao login
              </a>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
