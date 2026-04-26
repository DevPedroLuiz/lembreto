import React, { useState } from 'react';
import { CheckCircle2, Lock, ShieldCheck } from 'lucide-react';
import { apiPost } from '../api/client';

interface ResetPageProps {
  onBackToLogin: () => void;
}

export function ResetPage({ onBackToLogin }: ResetPageProps) {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('A senha deve ter, no mínimo, 6 caracteres.');
      return;
    }

    if (password !== confirm) {
      setError('As senhas não coincidem.');
      return;
    }

    setLoading(true);
    try {
      await apiPost('/api/auth/reset-password', { token, password });
      setSuccess(true);
    } catch (submissionError: unknown) {
      setError(submissionError instanceof Error ? submissionError.message : 'Erro ao redefinir a senha.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8">
      <div className="absolute inset-0 bg-grid opacity-50 dark:opacity-30" />

      <div className="relative w-full max-w-xl overflow-hidden rounded-[36px] border border-slate-200/80 bg-white/92 p-6 shadow-[0_40px_120px_-40px_rgba(15,23,42,0.35)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/80 dark:shadow-[0_40px_120px_-48px_rgba(0,0,0,0.85)] sm:p-8">
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[28px] bg-gradient-to-br from-blue-600 to-sky-500 text-white shadow-[0_18px_36px_-22px_rgba(37,99,235,0.65)]">
            <Lock size={30} />
          </div>
          <span className="section-eyebrow mt-6">
            <ShieldCheck size={14} />
            Segurança da conta
          </span>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
            {success ? 'Senha redefinida' : 'Criar nova senha'}
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
            {success
              ? 'Seu acesso foi atualizado com sucesso.'
              : 'Defina uma senha segura para voltar ao seu planejamento.'}
          </p>
        </div>

        {success ? (
          <div className="surface-soft mt-8 space-y-5 p-6 text-center">
            <CheckCircle2 size={48} className="mx-auto text-emerald-500" />
            <p className="text-sm leading-7 text-slate-500 dark:text-slate-400">
              A nova senha já está válida. Você pode retornar à tela inicial e fazer login normalmente.
            </p>
            <button type="button" onClick={onBackToLogin} className="action-primary w-full">
              Ir para o login
            </button>
          </div>
        ) : !token ? (
          <div className="surface-soft mt-8 space-y-5 p-6 text-center">
            <p className="text-sm font-medium text-rose-600 dark:text-rose-300">
              Link inválido ou expirado.
            </p>
            <button type="button" onClick={onBackToLogin} className="action-primary w-full">
              Voltar para o login
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <div className="surface-soft space-y-4 p-6">
              <div className="relative">
                <Lock size={18} className="field-icon" />
                <input
                  autoFocus
                  required
                  type="password"
                  autoComplete="new-password"
                  data-testid="reset-password-input"
                  placeholder="Nova senha"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="field-control field-control-with-icon"
                />
              </div>

              <div className="relative">
                <Lock size={18} className="field-icon" />
                <input
                  required
                  type="password"
                  autoComplete="new-password"
                  data-testid="reset-confirm-input"
                  placeholder="Confirmar nova senha"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  className="field-control field-control-with-icon"
                />
              </div>

              {error && (
                <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
                  {error}
                </p>
              )}

              <button
                type="submit"
                data-testid="reset-submit-button"
                disabled={loading}
                className="action-primary w-full disabled:cursor-wait disabled:opacity-60"
              >
                {loading ? 'Salvando...' : 'Redefinir senha'}
              </button>
            </div>

            <p className="text-center text-sm">
              <button
                type="button"
                onClick={onBackToLogin}
                className="font-semibold text-blue-600 hover:underline dark:text-blue-300"
              >
                Voltar para o login
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
