// src/pages/AuthPage.tsx
import React, { useState } from 'react';
import { Target, Mail, Lock, User as UserIcon, CheckCircle2 } from 'lucide-react';
import type { useAuth } from '../hooks/useAuth';

interface AuthPageProps {
  auth: ReturnType<typeof useAuth>;
  toastNotify: (title: string, msg: string) => void;
}

export function AuthPage({ auth, toastNotify }: AuthPageProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoverSuccess, setRecoverSuccess] = useState(false);

  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [recoverEmail, setRecoverEmail] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      const user = isLogin
        ? await auth.login(authEmail, authPassword)
        : await auth.register(authName, authEmail, authPassword);
      toastNotify('Bem-vindo!', `Olá, ${user.name}!`);
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Falha na comunicação com o servidor.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      await auth.recoverPassword(recoverEmail);
      setRecoverSuccess(true);
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Erro ao recuperar senha.');
    } finally {
      setAuthLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50 dark:bg-[#040814]">
      <div className="max-w-md w-full bg-white dark:bg-[#0a122a] rounded-3xl p-8 shadow-2xl border border-slate-200 dark:border-white/10">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl mx-auto flex items-center justify-center mb-4 text-white shadow-lg shadow-blue-500/20">
            <Target size={32} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Lembreto</h1>
          <p className="text-slate-500 mt-2 text-sm">
            {isRecovering
              ? recoverSuccess ? 'E-mail enviado!' : 'Recuperar senha'
              : isLogin ? 'Faça login para continuar' : 'Crie sua conta'}
          </p>
        </div>

        {/* Recuperação de senha */}
        {isRecovering ? (
          recoverSuccess ? (
            <div className="space-y-6 text-center">
              <div className="flex justify-center">
                <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-500/10 rounded-full flex items-center justify-center">
                  <Mail size={28} className="text-emerald-600 dark:text-emerald-400" />
                </div>
              </div>
              <div>
                <h3 className="font-bold text-slate-800 dark:text-slate-100 mb-2">
                  Verifique seu e-mail
                </h3>
                <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">
                  Se{' '}
                  <span className="font-semibold text-slate-700 dark:text-slate-200">
                    {recoverEmail}
                  </span>{' '}
                  estiver cadastrado, você receberá um link em breve.
                </p>
              </div>
              <button
                onClick={() => { setIsRecovering(false); setRecoverSuccess(false); setRecoverEmail(''); setAuthError(''); }}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-2xl py-3.5 font-bold transition-all active:scale-95"
              >
                Voltar ao Login
              </button>
            </div>
          ) : (
            <form onSubmit={handleRecover} className="space-y-4">
              <p className="text-sm text-slate-500 text-center">
                Informe seu email para recuperar sua senha.
              </p>
              <div className="relative">
                <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  required
                  type="email"
                  placeholder="Seu email"
                  value={recoverEmail}
                  onChange={(e) => setRecoverEmail(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 rounded-2xl py-3.5 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white text-sm"
                />
              </div>
              {authError && <p className="text-rose-500 text-sm text-center font-medium">{authError}</p>}
              <button
                type="submit"
                disabled={authLoading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-2xl py-3.5 font-bold transition-all active:scale-95"
              >
                {authLoading ? 'Enviando...' : 'Recuperar Senha'}
              </button>
              <p className="text-center text-sm">
                <button
                  type="button"
                  onClick={() => { setIsRecovering(false); setAuthError(''); }}
                  className="text-blue-600 font-semibold hover:underline"
                >
                  Voltar ao login
                </button>
              </p>
            </form>
          )
        ) : (
          /* Login / Registro */
          <form onSubmit={handleAuth} className="space-y-4">
            {!isLogin && (
              <div className="relative">
                <UserIcon size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  required
                  type="text"
                  placeholder="Seu nome completo"
                  value={authName}
                  onChange={(e) => setAuthName(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 rounded-2xl py-3.5 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white text-sm"
                />
              </div>
            )}
            <div className="relative">
              <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                required
                type="email"
                placeholder="Email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 rounded-2xl py-3.5 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white text-sm"
              />
            </div>
            <div className="relative">
              <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                required
                type="password"
                placeholder="Senha"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-white/10 rounded-2xl py-3.5 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white text-sm"
              />
            </div>
            {isLogin && (
              <div className="text-right">
                <button
                  type="button"
                  onClick={() => { setIsRecovering(true); setAuthError(''); }}
                  className="text-blue-600 text-sm font-semibold hover:underline"
                >
                  Esqueceu a senha?
                </button>
              </div>
            )}
            {authError && <p className="text-rose-500 text-sm text-center font-medium">{authError}</p>}
            <button
              type="submit"
              disabled={authLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-2xl py-3.5 font-bold shadow-lg shadow-blue-500/20 active:scale-95 transition-all"
            >
              {authLoading ? 'Aguarde...' : isLogin ? 'Entrar' : 'Criar Conta'}
            </button>
            <p className="text-center text-slate-500 text-sm">
              {isLogin ? 'Não tem uma conta?' : 'Já possui uma conta?'}{' '}
              <button
                type="button"
                onClick={() => { setIsLogin(!isLogin); setAuthError(''); }}
                className="text-blue-600 font-bold hover:underline"
              >
                {isLogin ? 'Registre-se' : 'Faça login'}
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
