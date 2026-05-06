import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';

declare global {
  interface Window {
    grecaptcha?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          'expired-callback': () => void;
          'error-callback': () => void;
        },
      ) => number;
      reset: (widgetId?: number) => void;
    };
    __lembretoRecaptchaReady?: () => void;
  }
}

const RECAPTCHA_SCRIPT_ID = 'google-recaptcha-api';

interface RecaptchaCheckboxProps {
  siteKey?: string;
  resetKey: number;
  onChange: (token: string) => void;
  onUnavailable?: () => void;
}

function loadRecaptchaScript(): Promise<void> {
  if (window.grecaptcha) return Promise.resolve();

  return new Promise((resolve, reject) => {
    window.__lembretoRecaptchaReady = () => resolve();

    const existing = document.getElementById(RECAPTCHA_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('reCAPTCHA indisponivel')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = RECAPTCHA_SCRIPT_ID;
    script.src = 'https://www.google.com/recaptcha/api.js?onload=__lembretoRecaptchaReady&render=explicit';
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error('reCAPTCHA indisponivel'));
    document.head.appendChild(script);
  });
}

export function RecaptchaCheckbox({
  siteKey,
  resetKey,
  onChange,
  onUnavailable,
}: RecaptchaCheckboxProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<number | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    siteKey ? 'loading' : 'idle',
  );
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    onChange('');
    setVerified(false);

    if (!siteKey) {
      setStatus('idle');
      return;
    }

    let cancelled = false;
    setStatus('loading');

    loadRecaptchaScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.grecaptcha) return;

        if (widgetIdRef.current !== null) {
          window.grecaptcha.reset(widgetIdRef.current);
          setStatus('ready');
          return;
        }

        widgetIdRef.current = window.grecaptcha.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => {
            setVerified(true);
            onChange(token);
          },
          'expired-callback': () => {
            setVerified(false);
            onChange('');
          },
          'error-callback': () => {
            setVerified(false);
            onChange('');
          },
        });
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('error');
        onUnavailable?.();
      });

    return () => {
      cancelled = true;
    };
  }, [onChange, onUnavailable, resetKey, siteKey]);

  if (!siteKey) return null;

  return (
    <div className="rounded-[24px] border border-slate-200/80 bg-white/80 p-4 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.45)] dark:border-white/10 dark:bg-white/[0.04]">
      <div className="mb-4 flex items-start gap-3">
        <div
          className={[
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl transition-colors',
            verified
              ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300'
              : 'bg-blue-100 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300',
          ].join(' ')}
        >
          <ShieldCheck size={18} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">
            Verificacao de seguranca
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
            {verified
              ? 'Confirmado. Voce pode continuar com seguranca.'
              : 'Confirme o desafio para proteger sua conta contra acessos automatizados.'}
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white p-2 ring-1 ring-slate-200/80 dark:ring-white/10">
        <div ref={containerRef} className="min-h-[78px] origin-top-left max-[390px]:scale-[0.88]" />
      </div>

      {status === 'loading' && (
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Carregando verificacao de seguranca...
        </p>
      )}
      {status === 'error' && (
        <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
          Nao foi possivel carregar o reCAPTCHA. Verifique sua conexao e tente novamente.
        </p>
      )}
    </div>
  );
}
