import React, { useEffect, useRef, useState } from 'react';

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

  useEffect(() => {
    onChange('');

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
          callback: (token) => onChange(token),
          'expired-callback': () => onChange(''),
          'error-callback': () => onChange(''),
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
    <div className="space-y-2">
      <div ref={containerRef} className="min-h-[78px]" />
      {status === 'loading' && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Carregando verificacao de seguranca...
        </p>
      )}
      {status === 'error' && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
          Nao foi possivel carregar o reCAPTCHA. Verifique sua conexao e tente novamente.
        </p>
      )}
    </div>
  );
}
