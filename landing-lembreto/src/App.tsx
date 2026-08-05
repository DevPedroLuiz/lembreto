import { useState } from 'react';
import { ArrowRight, X } from 'lucide-react';
import { LandingAuthPage } from './pages/LandingAuthPage';
import { useAuth } from './hooks/useAuth';

interface ToastState {
  title: string;
  message: string;
}

function Toast({ toast, onDismiss }: { toast: ToastState | null; onDismiss: () => void }) {
  if (!toast) return null;

  return (
    <div className="fixed bottom-5 right-5 z-[200] w-[min(420px,calc(100vw-2rem))] rounded-[22px] border border-white/10 bg-slate-950/90 p-4 text-white shadow-[0_28px_80px_-34px_rgba(0,0,0,0.9)] backdrop-blur-xl">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{toast.title}</p>
          <p className="mt-1 text-sm leading-6 text-slate-300">{toast.message}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Fechar aviso"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={17} />
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const auth = useAuth();
  const [toast, setToast] = useState<ToastState | null>(null);

  return (
    <>
      <LandingAuthPage
        auth={auth}
        toastNotify={(title, message) => setToast({ title, message })}
      />

      {!auth.restoring && auth.currentUser && (
        <button
          type="button"
          onClick={() => auth.openApp('/')}
          className="fixed bottom-5 left-5 z-[190] inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-bold text-slate-950 shadow-[0_22px_60px_-28px_rgba(14,165,233,0.8)] transition-all hover:-translate-y-0.5"
        >
          Abrir app
          <ArrowRight size={17} />
        </button>
      )}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
