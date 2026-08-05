import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BellRing,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  Globe2,
  Layers3,
  Lock,
  Mail,
  MonitorDown,
  Moon,
  PlayCircle,
  ShieldCheck,
  Smartphone,
  Sun,
  User as UserIcon,
} from 'lucide-react';
import type { useAuth } from '../hooks/useAuth';
import { resolveApiUrl } from '../api/client';
import { LS } from '../lib/storage';
import { RecaptchaCheckbox } from '../components/RecaptchaCheckbox';
import { BrandMark } from '../components/BrandLogo';

interface AuthPageProps {
  auth: ReturnType<typeof useAuth>;
  toastNotify: (title: string, message: string) => void;
}

type PasswordStrength = 'weak' | 'medium' | 'strong';

interface AuthConfig {
  recaptchaRequired?: boolean;
  recaptchaSiteKey?: string | null;
}

type Language = 'pt' | 'en' | 'es';
type ThemeMode = 'dark' | 'light';

const desktopDownloadUrl = (import.meta.env.VITE_DESKTOP_DOWNLOAD_URL as string | undefined)?.trim() || '/downloads/lembreto-desktop.exe';
const mobileDownloadUrl = (import.meta.env.VITE_MOBILE_DOWNLOAD_URL as string | undefined)?.trim() || '/downloads/lembreto-mobile.apk';
const demoVideoUrl = '/videos/lembreto-demo.mp4';

const languageOptions: Array<{ code: Language; label: string; short: string }> = [
  { code: 'pt', label: 'Português', short: 'PT' },
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'es', label: 'Español', short: 'ES' },
];

const copy = {
  pt: {
    nav: { rhythm: 'Ritmo', central: 'Central', plans: 'Planos', access: 'Acesso', login: 'Entrar', download: 'Baixar' },
    theme: { light: 'Claro', dark: 'Escuro' },
    hero: {
      eyebrow: 'Rotina, alarmes e notas em um só lugar',
      title: 'Lembreto',
      subtitle: 'Uma central rápida para lembrar, priorizar e agir antes que o dia vire urgência.',
      description: 'Organize tarefas, notas, alarmes, prioridades e calendário em uma experiência feita para uso diário.',
      primary: 'Começar agora',
      secondary: 'Ver o painel',
      stats: [['15 min', 'pré-aviso'], ['4 áreas', 'do seu dia'], ['1 painel', 'para decidir']],
    },
    video: {
      eyebrow: 'Demonstração do sistema',
      title: 'Veja o Lembreto em ação',
      description: 'Um tour rápido pelo fluxo real: painel, lembretes, notas, prioridades e organização da rotina.',
      badge: 'Vídeo do produto',
    },
    download: {
      desktop: 'Baixar app desktop',
      mobile: 'Baixar versão mobile',
      desktopHelper: 'Instale no computador',
      mobileHelper: 'Instale no celular',
    },
    rhythm: {
      title: 'Automação sem perder contexto',
      cards: [
        ['Tudo respira junto', 'Notas, tarefas, categorias e tags ficam no mesmo mapa mental.'],
        ['Alarmes com contexto', 'Avisos chegam com prioridade, horário e ação clara para o próximo passo.'],
        ['Conta pronta para crescer', 'Login, recuperação de senha, sessões e preferências seguem o fluxo do produto.'],
      ],
    },
    plans: {
      eyebrow: 'Planos e assinatura',
      title: 'Comece leve. Assine quando o Lembreto virar parte da rotina.',
      description: 'Os upgrades ficam dentro do app, em Configurações > Organização, com checkout recorrente pelo Mercado Pago.',
      note: 'Planos reais do app. A assinatura acontece depois do login, no workspace certo.',
      footer: 'Pro e Equipe usam assinatura mensal. O gerenciamento da cobrança abre pelo próprio painel do Mercado Pago.',
      ctas: ['Começar grátis', 'Criar conta para assinar', 'Criar workspace'],
    },
    faq: {
      title: 'Perguntas frequentes',
      items: [
        ['O Lembreto funciona no celular?', 'Sim. O projeto já está preparado como PWA e também tem estrutura mobile com Capacitor.'],
        ['Posso usar para trabalho e vida pessoal?', 'Pode. Categorias, tags, notas e prioridades ajudam a separar contextos sem criar várias ferramentas.'],
        ['Os alarmes aparecem no navegador?', 'Sim. O sistema tem fluxo de notificações, alarmes e preferências para chamar atenção no momento certo.'],
        ['A landing está pronta para Vercel?', 'Está. O build usa Vite e a saída fica em dist.'],
      ],
    },
    access: {
      eyebrow: 'Acesso ao Lembreto',
      title: 'Entre, cadastre-se ou recupere sua conta no mesmo lugar.',
      description: 'Quem já usa entra rápido; quem está chegando cria a conta sem sair da página.',
      bullets: ['Autenticação por e-mail e senha.', 'Entrar com Google quando configurado.', 'Recuperação de senha integrada ao fluxo público.'],
    },
    auth: {
      access: 'Acesso',
      login: 'Entrar',
      register: 'Criar conta',
      welcome: 'Bem-vindo de volta',
      create: 'Crie sua conta',
      recover: 'Recuperar senha',
      verifyEmail: 'Verifique seu e-mail',
      loginCopy: 'Faça login para continuar seu planejamento.',
      registerCopy: 'Comece a organizar sua rotina em poucos minutos.',
      recoverCopy: 'Informe o e-mail da conta para iniciar a recuperação.',
      recoverSuccess: 'Se o endereço estiver cadastrado, você receberá um link de recuperação em instantes.',
    },
  },
  en: {
    nav: { rhythm: 'Flow', central: 'Product', plans: 'Plans', access: 'Access', login: 'Sign in', download: 'Download' },
    theme: { light: 'Light', dark: 'Dark' },
    hero: {
      eyebrow: 'Routine, alarms and notes in one place',
      title: 'Lembreto',
      subtitle: 'A fast command center to remember, prioritize and act before the day turns urgent.',
      description: 'Organize tasks, notes, alarms, priorities and calendar in an experience made for daily use.',
      primary: 'Start now',
      secondary: 'View dashboard',
      stats: [['15 min', 'early notice'], ['4 areas', 'of your day'], ['1 dashboard', 'to decide']],
    },
    video: {
      eyebrow: 'Product demo',
      title: 'See Lembreto in action',
      description: 'A quick tour through the real workflow: dashboard, reminders, notes, priorities and routine planning.',
      badge: 'Product video',
    },
    download: {
      desktop: 'Download desktop app',
      mobile: 'Download mobile version',
      desktopHelper: 'Install on your computer',
      mobileHelper: 'Install on your phone',
    },
    rhythm: {
      title: 'Automation with context',
      cards: [
        ['Everything works together', 'Notes, tasks, categories and tags stay on the same mental map.'],
        ['Contextual alarms', 'Alerts arrive with priority, time and a clear next action.'],
        ['Account ready to scale', 'Login, password recovery, sessions and preferences follow the product flow.'],
      ],
    },
    plans: {
      eyebrow: 'Plans and subscription',
      title: 'Start light. Upgrade when Lembreto becomes part of the routine.',
      description: 'Upgrades live inside the app, under Settings > Organization, with recurring checkout through Mercado Pago.',
      note: 'Real app plans. Subscription happens after login, inside the right workspace.',
      footer: 'Pro and Team use monthly billing. Charge management opens from the Mercado Pago panel.',
      ctas: ['Start free', 'Create account to subscribe', 'Create workspace'],
    },
    faq: {
      title: 'Frequently asked questions',
      items: [
        ['Does Lembreto work on mobile?', 'Yes. The project is prepared as a PWA and also has a mobile structure with Capacitor.'],
        ['Can I use it for work and personal life?', 'Yes. Categories, tags, notes and priorities help separate contexts without multiple tools.'],
        ['Do alarms appear in the browser?', 'Yes. The system has notifications, alarms and preferences to get attention at the right moment.'],
        ['Is the landing ready for Vercel?', 'Yes. The build uses Vite and outputs to dist.'],
      ],
    },
    access: {
      eyebrow: 'Access Lembreto',
      title: 'Sign in, create an account or recover access in one place.',
      description: 'Existing users get in quickly; new users can create an account without leaving the page.',
      bullets: ['Email and password authentication.', 'Google sign-in when configured.', 'Password recovery integrated into the public flow.'],
    },
    auth: {
      access: 'Access',
      login: 'Sign in',
      register: 'Create account',
      welcome: 'Welcome back',
      create: 'Create your account',
      recover: 'Recover password',
      verifyEmail: 'Check your email',
      loginCopy: 'Sign in to continue planning.',
      registerCopy: 'Start organizing your routine in a few minutes.',
      recoverCopy: 'Enter your account email to start recovery.',
      recoverSuccess: 'If the address is registered, you will receive a recovery link shortly.',
    },
  },
  es: {
    nav: { rhythm: 'Ritmo', central: 'Producto', plans: 'Planes', access: 'Acceso', login: 'Entrar', download: 'Descargar' },
    theme: { light: 'Claro', dark: 'Oscuro' },
    hero: {
      eyebrow: 'Rutina, alarmas y notas en un solo lugar',
      title: 'Lembreto',
      subtitle: 'Una central rápida para recordar, priorizar y actuar antes de que el día se vuelva urgente.',
      description: 'Organiza tareas, notas, alarmas, prioridades y calendario en una experiencia hecha para uso diario.',
      primary: 'Comenzar ahora',
      secondary: 'Ver panel',
      stats: [['15 min', 'aviso previo'], ['4 áreas', 'de tu día'], ['1 panel', 'para decidir']],
    },
    video: {
      eyebrow: 'Demostración del sistema',
      title: 'Mira Lembreto en acción',
      description: 'Un recorrido rápido por el flujo real: panel, recordatorios, notas, prioridades y organización de la rutina.',
      badge: 'Video del producto',
    },
    download: {
      desktop: 'Descargar app desktop',
      mobile: 'Descargar versión móvil',
      desktopHelper: 'Instala en tu computadora',
      mobileHelper: 'Instala en tu celular',
    },
    rhythm: {
      title: 'Automatización sin perder contexto',
      cards: [
        ['Todo respira junto', 'Notas, tareas, categorías y etiquetas quedan en el mismo mapa mental.'],
        ['Alarmas con contexto', 'Los avisos llegan con prioridad, horario y una acción clara.'],
        ['Cuenta lista para crecer', 'Login, recuperación, sesiones y preferencias siguen el flujo del producto.'],
      ],
    },
    plans: {
      eyebrow: 'Planes y suscripción',
      title: 'Empieza simple. Suscríbete cuando Lembreto sea parte de tu rutina.',
      description: 'Los upgrades están dentro de la app, en Configuración > Organización, con checkout recurrente por Mercado Pago.',
      note: 'Planes reales de la app. La suscripción ocurre después del login, en el workspace correcto.',
      footer: 'Pro y Equipo usan suscripción mensual. La gestión de cobro abre en el panel de Mercado Pago.',
      ctas: ['Comenzar gratis', 'Crear cuenta para suscribirse', 'Crear workspace'],
    },
    faq: {
      title: 'Preguntas frecuentes',
      items: [
        ['¿Lembreto funciona en celular?', 'Sí. El proyecto está preparado como PWA y también tiene estructura mobile con Capacitor.'],
        ['¿Puedo usarlo para trabajo y vida personal?', 'Sí. Categorías, etiquetas, notas y prioridades ayudan a separar contextos sin varias herramientas.'],
        ['¿Las alarmas aparecen en el navegador?', 'Sí. El sistema tiene notificaciones, alarmas y preferencias para llamar la atención en el momento correcto.'],
        ['¿La landing está lista para Vercel?', 'Sí. El build usa Vite y la salida queda en dist.'],
      ],
    },
    access: {
      eyebrow: 'Acceso a Lembreto',
      title: 'Entra, crea una cuenta o recupera tu acceso en un solo lugar.',
      description: 'Quien ya usa entra rápido; quien llega ahora crea la cuenta sin salir de la página.',
      bullets: ['Autenticación por e-mail y contraseña.', 'Entrar con Google cuando esté configurado.', 'Recuperación de contraseña integrada al flujo público.'],
    },
    auth: {
      access: 'Acceso',
      login: 'Entrar',
      register: 'Crear cuenta',
      welcome: 'Bienvenido de nuevo',
      create: 'Crea tu cuenta',
      recover: 'Recuperar contraseña',
      verifyEmail: 'Revisa tu e-mail',
      loginCopy: 'Inicia sesión para continuar tu planificación.',
      registerCopy: 'Empieza a organizar tu rutina en pocos minutos.',
      recoverCopy: 'Informa el e-mail de la cuenta para iniciar la recuperación.',
      recoverSuccess: 'Si la dirección está registrada, recibirás un enlace de recuperación pronto.',
    },
  },
};


function isMobileUserAgent() {
  if (typeof navigator === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function getPasswordStrength(password: string): {
  level: PasswordStrength;
  label: string;
  width: string;
  tone: string;
  helper: string;
} {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  if (score >= 5) {
    return {
      level: 'strong',
      label: 'Senha forte',
      width: '100%',
      tone: 'bg-emerald-500',
      helper: 'Boa combinação de tamanho e variedade de caracteres.',
    };
  }

  if (score >= 3) {
    return {
      level: 'medium',
      label: 'Senha média',
      width: '68%',
      tone: 'bg-amber-500',
      helper: 'Já está melhor. Vale adicionar mais variedade para ficar mais segura.',
    };
  }

  return {
    level: 'weak',
    label: 'Senha fraca',
    width: '34%',
    tone: 'bg-rose-500',
    helper: 'Use pelo menos 8 caracteres com letras maiúsculas, números e símbolos.',
  };
}

function SecurityVerificationUnavailable() {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200">
          <ShieldCheck size={17} />
        </div>
        <div>
          <p className="font-semibold">Verificação de segurança indisponível</p>
          <p className="mt-1 leading-6">
            Atualize a página e tente novamente. Se continuar assim, a chave pública do reCAPTCHA precisa ser configurada no ambiente.
          </p>
        </div>
      </div>
    </div>
  );
}

const rhythmCards = [
  {
    icon: <Layers3 size={20} />,
    title: 'Tudo respira junto',
    copy: 'Notas, tarefas, categorias e tags ficam no mesmo mapa mental.',
  },
  {
    icon: <BellRing size={20} />,
    title: 'Alarmes com contexto',
    copy: 'Avisos chegam com prioridade, horário e ação clara para o próximo passo.',
  },
  {
    icon: <ShieldCheck size={20} />,
    title: 'Conta pronta para crescer',
    copy: 'Login, recuperação de senha, sessões e preferências seguem o fluxo do produto.',
  },
];

const pricingPlans = [
  {
    name: 'Gratuito',
    price: 'R$ 0',
    period: 'para começar',
    badge: 'Entrada simples',
    description: 'Para organizar a rotina pessoal sem atrito e entender o fluxo do Lembreto.',
    features: [
      'Até 100 tarefas',
      '1 integrante',
      '1 integração de calendário',
      '25 mensagens de IA por mês',
    ],
    cta: 'Começar grátis',
    featured: false,
  },
  {
    name: 'Pro',
    price: 'R$ 29,90',
    period: 'por mês',
    badge: 'Mais escolhido',
    description: 'Para quem usa o Lembreto todos os dias e precisa de mais automação.',
    features: [
      'Tarefas ilimitadas',
      'Notificações push nativas',
      '3 integrações de calendário',
      '500 mensagens de IA por mês',
    ],
    cta: 'Criar conta para assinar',
    featured: true,
  },
  {
    name: 'Equipe',
    price: 'R$ 79,90',
    period: 'por mês',
    badge: 'Para times',
    description: 'Para centralizar prioridades, membros e lembretes de um workspace.',
    features: [
      'Até 10 membros',
      'Tarefas ilimitadas',
      '10 integrações de calendário',
      'Suporte prioritário',
    ],
    cta: 'Criar workspace',
    featured: false,
  },
];

function LandingProductMock() {
  const sidebarItems = ['Painel', 'Calendário', 'Meus lembretes', 'Notas', 'Ferramentas'];
  const stats = [
    ['Total', '0', 'bg-blue-500/15 text-blue-200'],
    ['Concluídos', '0', 'bg-emerald-500/15 text-emerald-200'],
    ['Hoje', '0', 'bg-violet-500/15 text-violet-200'],
    ['Atrasados', '0', 'bg-rose-500/15 text-rose-200'],
  ];
  const priorityCards = [
    ['Alta prioridade', '0', 'Tarefas que pedem decisão', 'bg-rose-500/15 text-rose-200'],
    ['Média prioridade', '0', 'Itens para manter em ritmo', 'bg-amber-500/15 text-amber-200'],
    ['Baixa prioridade', '0', 'Pode esperar um pouco', 'bg-emerald-500/15 text-emerald-200'],
    ['Sem prazo', '0', 'Bom para revisar e datar', 'bg-slate-500/15 text-slate-200'],
  ];

  return (
    <div className="relative mx-auto w-full max-w-7xl">
      <div className="absolute -inset-x-10 bottom-0 h-52 rounded-full bg-cyan-400/20 blur-3xl" />
      <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[#020817] shadow-[0_42px_120px_-46px_rgba(0,216,245,0.7)]">
        <div className="grid min-h-[610px] grid-cols-[220px_1fr_340px] gap-5 bg-[#020817] p-5 text-left max-xl:grid-cols-[200px_1fr] max-lg:grid-cols-1 max-sm:p-3">
          <aside className="flex min-h-[570px] flex-col rounded-[24px] border border-white/10 bg-[#050a1a] p-4 max-lg:hidden">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-black ring-1 ring-cyan-300/25">
                <img src="/logo-mark.svg" alt="" className="h-7 w-7" />
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-slate-500">Organização pessoal</p>
                <p className="font-display text-2xl font-semibold text-white">Lembreto</p>
              </div>
            </div>

            <div className="mt-7 grid grid-cols-2 gap-3">
              {['Hoje', 'Atrasados'].map((label) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                  <p className="text-xs font-medium text-slate-400">{label}</p>
                  <p className="mt-2 font-display text-3xl font-semibold text-white">0</p>
                </div>
              ))}
            </div>

            <nav className="mt-7 space-y-2">
              {sidebarItems.map((item, index) => (
                <div
                  key={item}
                  className={[
                    'flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-semibold',
                    index === 0
                      ? 'bg-gradient-to-r from-blue-500 to-cyan-400 text-white'
                      : 'text-slate-300',
                  ].join(' ')}
                >
                  <span className={[
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border',
                    index === 0 ? 'border-white/20 bg-white/10' : 'border-white/10 bg-white/[0.04]',
                  ].join(' ')}
                  >
                    {index === 0 ? '□' : '•'}
                  </span>
                  <span>
                    {item}
                    <span className="block text-xs font-medium text-slate-400">Acesse rapidamente</span>
                  </span>
                </div>
              ))}
            </nav>

            <div className="mt-auto space-y-3 border-t border-white/10 pt-4">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <p className="font-semibold text-white">orbydata</p>
                <p className="truncate text-xs text-slate-500">orbydata@gm...</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm font-semibold text-slate-300">
                Configurações
              </div>
            </div>
          </aside>

          <main className="space-y-5">
            <section className="rounded-[26px] border border-white/10 bg-[#060b1d] p-6 max-sm:p-4">
              <div className="flex items-center justify-between gap-6 max-md:flex-col max-md:items-start">
                <div>
                  <span className="inline-flex rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-slate-300">
                    Visão geral do dia
                  </span>
                  <h2 className="mt-5 max-w-lg font-display text-4xl font-semibold leading-tight text-white max-sm:text-3xl">
                    Clareza para decidir o que vem primeiro.
                  </h2>
                  <p className="mt-4 max-w-xl text-sm leading-7 text-slate-400">
                    Centralize prioridades, acompanhe prazos e mantenha uma rotina mais leve com um painel simples de consultar.
                  </p>
                </div>
                <div className="grid gap-3 max-md:w-full">
                  <button type="button" className="rounded-2xl bg-gradient-to-r from-blue-500 to-cyan-400 px-5 py-4 text-sm font-bold text-white">
                    + Novo lembrete
                  </button>
                  <button type="button" className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 text-sm font-bold text-white">
                    Ver agenda
                  </button>
                </div>
              </div>

              <div className="mt-8 grid gap-3 sm:grid-cols-4">
                {stats.map(([label, value, tone]) => (
                  <div key={label} className="rounded-[22px] border border-white/10 bg-white/[0.025] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-bold text-slate-400">{label}</p>
                      <span className={`h-9 w-9 rounded-2xl ${tone}`} />
                    </div>
                    <p className="mt-4 font-display text-4xl font-semibold text-white">{value}</p>
                    <div className="mt-4 h-1.5 rounded-full bg-white/10">
                      <div className="h-full w-[16%] rounded-full bg-blue-400" />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="grid gap-3 sm:grid-cols-2">
              {priorityCards.map(([title, value, copy, tone]) => (
                <article key={title} className="rounded-[22px] border border-white/10 bg-white/[0.045] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">{title}</p>
                      <p className="mt-3 font-display text-4xl font-semibold text-white">{value}</p>
                      <p className="mt-1 text-sm text-slate-400">{copy}</p>
                    </div>
                    <span className={`h-10 w-10 shrink-0 rounded-2xl ${tone}`} />
                  </div>
                </article>
              ))}
            </section>

            <section className="rounded-[26px] border border-white/10 bg-[#060b1d] p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-xl font-semibold text-white">Próximos lembretes</h3>
                  <p className="mt-1 text-sm text-slate-400">Veja o que merece sua atenção imediata.</p>
                </div>
                <span className="text-sm font-bold text-slate-300">Ver tudo →</span>
              </div>
              <div className="mt-5 rounded-[22px] border border-dashed border-white/10 bg-white/[0.02] p-5">
                <span className="inline-flex rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-slate-300">
                  Primeiro acesso
                </span>
                <p className="mt-4 text-2xl font-semibold text-white">Vamos preparar seu espaço de trabalho</p>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-400">
                  Você ainda não criou nenhum lembrete. Comece pelo essencial ou use um exemplo pronto para sentir o fluxo do aplicativo.
                </p>
              </div>
            </section>
          </main>

          <aside className="space-y-5 max-xl:col-span-2 max-lg:hidden">
            <section className="rounded-[26px] border border-white/10 bg-[#060b1d] p-6">
              <span className="inline-flex rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-slate-300">
                Progresso
              </span>
              <p className="mt-6 text-sm text-slate-400">Desempenho da sua lista</p>
              <div className="mt-3 flex items-end gap-3">
                <p className="font-display text-6xl font-semibold text-white">0%</p>
                <p className="pb-3 text-sm text-slate-500">concluído</p>
              </div>
              <div className="mt-6 h-2 rounded-full border border-white/10 bg-white/10" />
              <div className="mt-4 flex items-center gap-3 text-sm text-slate-400">
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 font-bold text-slate-200">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  Tudo em dia
                </span>
                Sua agenda está sob controle.
              </div>

              <div className="mt-6 rounded-[22px] border border-white/10 bg-white/[0.035] p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-white">Gráfico do dia</p>
                    <p className="text-xs text-slate-500">0 agendados hoje</p>
                  </div>
                  <span className="h-9 w-9 rounded-full bg-white/10" />
                </div>
                <div className="mt-5 flex h-28 items-end gap-1 rounded-2xl bg-white/[0.04] px-2 pb-3">
                  {Array.from({ length: 24 }).map((_, index) => (
                    <span
                      key={index}
                      className="flex-1 rounded-full bg-white/10"
                      style={{ height: `${index % 5 === 0 ? 74 : 58}%` }}
                    />
                  ))}
                </div>
                <div className="mt-3 flex justify-between text-[11px] text-slate-500">
                  <span>00</span>
                  <span>03</span>
                  <span>06</span>
                  <span>09</span>
                  <span>12</span>
                  <span>15</span>
                  <span>18</span>
                  <span>21</span>
                </div>
              </div>
            </section>

            <section className="rounded-[26px] border border-white/10 bg-[#060b1d] p-6">
              <span className="inline-flex rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-slate-300">
                Resumo útil
              </span>
              <h3 className="mt-5 text-2xl font-semibold text-white">Modelos rápidos</h3>
              <p className="mt-2 text-sm leading-6 text-slate-400">Comece com um lembrete pré-preenchido.</p>
              <div className="mt-5 space-y-3">
                {['Planejar a semana', 'Organizar a rotina pessoal'].map((item) => (
                  <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                    <p className="font-semibold text-white">{item}</p>
                    <p className="mt-1 text-xs text-slate-500">Trabalho · Alta prioridade</p>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

export function LandingAuthPage({ auth, toastNotify }: AuthPageProps) {
  const configuredRecaptchaSiteKey = (import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined)?.trim() ?? '';
  const recaptchaDisabledForTest = import.meta.env.VITE_DISABLE_RECAPTCHA === 'true';
  const [recaptchaSiteKey, setRecaptchaSiteKey] = useState(configuredRecaptchaSiteKey);
  const [recaptchaRequired, setRecaptchaRequired] = useState(Boolean(import.meta.env.PROD));
  const recaptchaEnabled = Boolean(recaptchaSiteKey) && !recaptchaDisabledForTest;
  const recaptchaMissingRequired = recaptchaRequired && !recaptchaEnabled && !recaptchaDisabledForTest;
  const [isLogin, setIsLogin] = useState(true);
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoverSuccess, setRecoverSuccess] = useState(false);

  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [rememberEmail, setRememberEmail] = useState(false);
  const [recoverEmail, setRecoverEmail] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [recaptchaToken, setRecaptchaToken] = useState('');
  const [recaptchaResetKey, setRecaptchaResetKey] = useState(0);
  const [recaptchaUnavailable, setRecaptchaUnavailable] = useState(false);
  const [isMobileDownload, setIsMobileDownload] = useState(false);
  const [language, setLanguage] = useState<Language>('pt');
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
  const t = copy[language];

  const passwordStrength = useMemo(
    () => getPasswordStrength(authPassword),
    [authPassword],
  );

  useEffect(() => {
    const pointerQuery = window.matchMedia('(pointer: coarse)');
    const widthQuery = window.matchMedia('(max-width: 767px)');

    const updateDeviceDownload = () => {
      setIsMobileDownload(isMobileUserAgent() || pointerQuery.matches || widthQuery.matches);
    };

    updateDeviceDownload();
    pointerQuery.addEventListener('change', updateDeviceDownload);
    widthQuery.addEventListener('change', updateDeviceDownload);

    return () => {
      pointerQuery.removeEventListener('change', updateDeviceDownload);
      widthQuery.removeEventListener('change', updateDeviceDownload);
    };
  }, []);

  const downloadCta = useMemo(() => {
    if (isMobileDownload) {
      return {
        href: mobileDownloadUrl,
        label: t.download.mobile,
        helper: t.download.mobileHelper,
        Icon: Smartphone,
      };
    }

    return {
      href: desktopDownloadUrl,
      label: t.download.desktop,
      helper: t.download.desktopHelper,
      Icon: MonitorDown,
    };
  }, [isMobileDownload, t.download.desktop, t.download.desktopHelper, t.download.mobile, t.download.mobileHelper]);

  useEffect(() => {
    const rememberedEmail = LS.loadRememberedEmail();
    if (!rememberedEmail) return;

    setAuthEmail(rememberedEmail);
    setRecoverEmail(rememberedEmail);
    setRememberEmail(true);
  }, []);

  useEffect(() => {
    if (recaptchaDisabledForTest) return;

    let cancelled = false;

    fetch(resolveApiUrl('/api/auth/config'), { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Configuração de autenticação indisponível');
        return response.json() as Promise<AuthConfig>;
      })
      .then((config) => {
        if (cancelled) return;

        const runtimeSiteKey = config.recaptchaSiteKey?.trim();
        if (!configuredRecaptchaSiteKey && runtimeSiteKey) {
          setRecaptchaSiteKey(runtimeSiteKey);
        }
        setRecaptchaRequired(Boolean(config.recaptchaRequired));
      })
      .catch(() => {
        if (cancelled) return;
        setRecaptchaRequired(Boolean(import.meta.env.PROD));
      });

    return () => {
      cancelled = true;
    };
  }, [configuredRecaptchaSiteKey, recaptchaDisabledForTest]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const googleError = params.get('auth_error');
    if (!googleError) return;

    setAuthError(googleError);
    params.delete('auth_error');
    const nextSearch = params.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`,
    );
  }, []);

  useEffect(() => {
    const targetId = window.location.hash.slice(1);
    if (!targetId) return;

    const frame = window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ block: 'start' });
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!isLogin) return;

    if (!rememberEmail) {
      LS.clearRememberedEmail();
      return;
    }

    const normalizedEmail = authEmail.trim();
    if (normalizedEmail) {
      LS.saveRememberedEmail(normalizedEmail);
    }
  }, [authEmail, isLogin, rememberEmail]);

  const resetRecaptcha = useCallback(() => {
    setRecaptchaToken('');
    setRecaptchaUnavailable(false);
    setRecaptchaResetKey((value) => value + 1);
  }, []);

  const handleRecaptchaUnavailable = useCallback(() => {
    setRecaptchaUnavailable(true);
  }, []);

  const validateRecaptcha = useCallback(() => {
    if (recaptchaMissingRequired) {
      setAuthError('A verificação de segurança não está disponível. Atualize a página e tente novamente.');
      return false;
    }
    if (!recaptchaEnabled || recaptchaToken) return true;
    if (recaptchaUnavailable) {
      setAuthError('Não foi possível carregar o reCAPTCHA. Atualize a página e tente novamente.');
      return false;
    }
    setAuthError('Confirme que você não é um robô.');
    return false;
  }, [recaptchaEnabled, recaptchaMissingRequired, recaptchaToken, recaptchaUnavailable]);

  const handleAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError('');

    if (!validateRecaptcha()) return;

    setAuthLoading(true);

    try {
      const normalizedEmail = authEmail.trim();
      const user = isLogin
        ? await auth.login(normalizedEmail, authPassword, recaptchaToken)
        : await auth.register(authName, normalizedEmail, authPassword, recaptchaToken);

      toastNotify('Bem-vindo!', `Olá, ${user.name}!`);
    } catch (error: unknown) {
      setAuthError(error instanceof Error ? error.message : 'Falha na comunicação com o servidor.');
      resetRecaptcha();
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRecover = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError('');

    if (!validateRecaptcha()) return;

    setAuthLoading(true);

    try {
      await auth.recoverPassword(recoverEmail.trim(), recaptchaToken);
      setRecoverSuccess(true);
    } catch (error: unknown) {
      setAuthError(error instanceof Error ? error.message : 'Erro ao recuperar a senha.');
      resetRecaptcha();
    } finally {
      setAuthLoading(false);
    }
  };

  const focusSignup = useCallback(() => {
    setIsLogin(false);
    setIsRecovering(false);
    setRecoverSuccess(false);
    setAuthError('');
    resetRecaptcha();
    window.requestAnimationFrame(() => {
      document.getElementById('acesso')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [resetRecaptcha]);

  const DownloadIcon = downloadCta.Icon;

  return (
    <div className={[
      'lembreto-landing relative h-[100dvh] min-h-[100dvh] overflow-y-auto overflow-x-hidden text-white transition-colors duration-300',
      themeMode === 'light' ? 'theme-light bg-[#f5f8fb] text-slate-950' : 'theme-dark bg-[#050607]',
    ].join(' ')}
    >
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-[0.08]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[34rem] bg-[radial-gradient(circle_at_50%_100%,rgba(20,184,166,0.42),rgba(14,165,233,0.16)_32%,transparent_66%)]" />

      <header className="sticky top-0 z-20 px-4 pt-4">
        <nav className="mx-auto flex w-full max-w-6xl items-center justify-between rounded-[18px] border border-white/10 bg-white/[0.035] px-4 py-3 shadow-[0_18px_60px_-36px_rgba(0,0,0,0.9)] backdrop-blur-xl">
          <a href="#inicio" className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-black shadow-[0_18px_34px_-22px_rgba(14,165,255,0.9)] ring-1 ring-cyan-300/25">
              <img src="/logo-mark.svg" alt="" className="h-8 w-8" />
            </span>
            <span className="font-display text-lg font-semibold text-white">
              Lembreto
            </span>
          </a>

          <div className="hidden items-center gap-8 text-sm font-semibold text-slate-300 md:flex">
            <a href="#ritmo" className="transition-colors hover:text-white">{t.nav.rhythm}</a>
            <a href="#central" className="transition-colors hover:text-white">{t.nav.central}</a>
            <a href="#planos" className="transition-colors hover:text-white">{t.nav.plans}</a>
            <a href="#acesso" className="transition-colors hover:text-white">{t.nav.access}</a>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setThemeMode((current) => current === 'dark' ? 'light' : 'dark')}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-3 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-white/10"
              aria-label={themeMode === 'dark' ? t.theme.light : t.theme.dark}
            >
              {themeMode === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              <span className="hidden lg:inline">{themeMode === 'dark' ? t.theme.light : t.theme.dark}</span>
            </button>

            <div className="flex items-center gap-1 rounded-2xl border border-white/10 bg-white/[0.05] p-1">
              <Globe2 size={15} className="ml-2 text-slate-400" />
              {languageOptions.map((option) => (
                <button
                  key={option.code}
                  type="button"
                  onClick={() => setLanguage(option.code)}
                  className={[
                    'min-h-8 rounded-xl px-2 text-xs font-bold transition-colors',
                    language === option.code ? 'bg-white text-slate-950' : 'text-slate-400 hover:text-white',
                  ].join(' ')}
                  aria-label={option.label}
                >
                  {option.short}
                </button>
              ))}
            </div>

            <a
              href={downloadCta.href}
              download
              data-testid="header-download-link"
              className="hidden min-h-10 items-center justify-center gap-2 rounded-2xl bg-white px-4 text-sm font-semibold text-slate-950 transition-all hover:-translate-y-0.5 hover:bg-cyan-100 sm:inline-flex"
            >
              <DownloadIcon size={16} />
              {t.nav.download}
            </a>

            <a
              href="#acesso"
              className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] px-4 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-white/10"
            >
              {t.nav.login}
            </a>
          </div>
        </nav>
      </header>

      <main className="relative z-10">
        <section id="inicio" className="mx-auto flex w-full max-w-7xl flex-col items-center px-4 pb-10 pt-14 text-center sm:px-6 lg:px-8">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.07] px-4 py-2 text-sm font-semibold text-cyan-100">
            <BellRing size={15} />
            {t.hero.eyebrow}
          </span>

          <h1 className="mt-7 font-display text-6xl font-semibold leading-none text-white sm:text-7xl lg:text-8xl">
            {t.hero.title}
          </h1>

          <p className="mt-5 max-w-3xl text-xl font-semibold leading-9 text-slate-200 sm:text-2xl">
            {t.hero.subtitle}
          </p>

          <p className="mt-4 max-w-2xl text-base leading-8 text-slate-400">
            {t.hero.description}
          </p>

          <div className="mt-8 grid w-full max-w-3xl gap-3 sm:grid-cols-3">
            <button type="button" onClick={focusSignup} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 font-semibold text-slate-950 transition-all hover:-translate-y-0.5 hover:bg-cyan-100">
              <span className="whitespace-nowrap">{t.hero.primary}</span>
              <ArrowRight size={18} />
            </button>
            <a href="#central" className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-white/12 bg-white/[0.035] px-5 py-3 font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-white/10">
              {t.hero.secondary}
            </a>
            <a
              href={downloadCta.href}
              download
              data-testid="hero-download-link"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-cyan-300/30 bg-cyan-300/[0.12] px-5 py-3 font-semibold text-cyan-50 transition-all hover:-translate-y-0.5 hover:bg-cyan-300/[0.18]"
            >
              <Download size={18} />
              <span className="whitespace-nowrap">{downloadCta.label}</span>
            </a>
          </div>

          <p className="mt-3 text-sm font-medium text-slate-500">
            {downloadCta.helper}
          </p>

          <div className="mt-9 grid w-full max-w-xl grid-cols-3 gap-3 text-left">
            {t.hero.stats.map(([value, label]) => (
              <div key={value} className="border-l border-white/15 pl-4">
                <p className="font-display text-2xl font-semibold text-white">{value}</p>
                <p className="mt-1 text-xs font-semibold uppercase text-slate-500">{label}</p>
              </div>
            ))}
          </div>

          <section className="mt-12 grid w-full max-w-7xl items-center gap-8 rounded-[32px] border border-white/10 bg-white/[0.04] p-4 text-left shadow-[0_34px_120px_-58px_rgba(14,165,233,0.75)] backdrop-blur-xl lg:grid-cols-[0.82fr_1.18fr] lg:p-6">
            <div className="px-2 py-5 sm:px-5 lg:py-8">
              <span className="inline-flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/[0.1] px-3 py-1 text-[11px] font-bold uppercase text-cyan-100">
                <PlayCircle size={14} />
                {t.video.eyebrow}
              </span>
              <h2 className="mt-5 font-display text-3xl font-semibold leading-tight text-white sm:text-4xl">
                {t.video.title}
              </h2>
              <p className="mt-4 text-base leading-8 text-slate-400">
                {t.video.description}
              </p>
              <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-white/[0.07] px-3 py-2 text-xs font-bold uppercase text-slate-300">
                <span className="h-2 w-2 rounded-full bg-emerald-300" />
                {t.video.badge}
              </div>
            </div>

            <div className="overflow-hidden rounded-[26px] border border-white/10 bg-black shadow-[0_30px_80px_-44px_rgba(0,0,0,0.95)]">
              <video
                src={demoVideoUrl}
                className="aspect-video w-full bg-black object-cover"
                controls
                muted
                playsInline
                preload="metadata"
              />
            </div>
          </section>

          <div id="central" className="mt-12 w-full scroll-mt-28">
            <LandingProductMock />
          </div>
        </section>

        <section id="ritmo" className="scroll-mt-28 border-y border-white/10 bg-black/24 px-4 py-8 sm:px-6 sm:py-14 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">
            <h2 className="mb-7 max-w-3xl font-display text-3xl font-semibold leading-tight text-white sm:text-4xl">
              {t.rhythm.title}
            </h2>
            <div className="grid gap-5 md:grid-cols-3">
            {t.rhythm.cards.map(([title, itemCopy], index) => (
              <article key={title} className="rounded-[28px] border border-white/10 bg-white/[0.035] p-6 shadow-[0_18px_46px_-34px_rgba(0,0,0,0.9)]">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.08] text-cyan-200">
                  {rhythmCards[index]?.icon}
                </div>
                <h3 className="mt-5 text-xl font-semibold text-white">{title}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-400">{itemCopy}</p>
              </article>
            ))}
            </div>
          </div>
        </section>

        <section id="planos" className="mx-auto w-full max-w-7xl scroll-mt-28 px-4 py-16 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <span className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/[0.08] px-3 py-1 text-[11px] font-bold uppercase text-cyan-100">
                <ShieldCheck size={14} />
                {t.plans.eyebrow}
              </span>
              <h2 className="mt-5 font-display text-4xl font-semibold leading-tight text-white sm:text-5xl">
                {t.plans.title}
              </h2>
              <p className="mt-5 max-w-2xl text-base leading-8 text-slate-400">
                {t.plans.description}
              </p>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-white/[0.035] px-5 py-4 text-sm leading-6 text-slate-300">
              {t.plans.note}
            </div>
          </div>

          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {pricingPlans.map((plan, index) => (
              <article
                key={plan.name}
                className={[
                  'relative flex min-h-[520px] flex-col rounded-[28px] border p-6 shadow-[0_24px_72px_-46px_rgba(0,0,0,0.95)]',
                  plan.featured
                    ? 'border-cyan-300/40 bg-cyan-300/[0.09] ring-1 ring-cyan-300/20'
                    : 'border-white/10 bg-white/[0.035]',
                ].join(' ')}
              >
                <div className="flex items-center justify-between gap-4">
                  <h3 className="font-display text-3xl font-semibold text-white">{plan.name}</h3>
                  <span className={[
                    'rounded-full px-3 py-1 text-[11px] font-bold uppercase',
                    plan.featured ? 'bg-cyan-200 text-slate-950' : 'bg-white/10 text-slate-300',
                  ].join(' ')}
                  >
                    {plan.badge}
                  </span>
                </div>

                <div className="mt-7">
                  <p className="font-display text-5xl font-semibold tracking-tight text-white">{plan.price}</p>
                  <p className="mt-2 text-sm font-semibold text-slate-400">{plan.period}</p>
                </div>

                <p className="mt-6 min-h-[72px] text-sm leading-7 text-slate-300">{plan.description}</p>

                <div className="mt-6 space-y-3">
                  {plan.features.map((feature) => (
                    <div key={feature} className="flex items-start gap-3 text-sm font-semibold text-slate-200">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/10 text-emerald-200">
                        <CheckCircle2 size={14} />
                      </span>
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={focusSignup}
                  className={[
                    'mt-auto inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 py-3 font-semibold transition-all hover:-translate-y-0.5',
                    plan.featured
                      ? 'bg-white text-slate-950 hover:bg-cyan-100'
                      : 'border border-white/12 bg-white/[0.045] text-white hover:bg-white/10',
                  ].join(' ')}
                >
                  {t.plans.ctas[index] ?? plan.cta}
                  <ArrowRight size={17} />
                </button>
              </article>
            ))}
          </div>

          <div className="mt-5 flex flex-col gap-3 rounded-[24px] border border-white/10 bg-black/24 px-5 py-4 text-sm leading-7 text-slate-400 sm:flex-row sm:items-center sm:justify-between">
            <p>
              {t.plans.footer}
            </p>
            <span className="shrink-0 rounded-full bg-white/[0.06] px-3 py-1 text-xs font-bold uppercase text-slate-300">
              BRL / Mercado Pago
            </span>
          </div>
        </section>

        <section className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_380px] lg:px-8">
          <div>
            <h2 className="font-display text-4xl font-semibold text-white sm:text-5xl">
              {t.faq.title}
            </h2>
            <div className="mt-8 divide-y divide-white/10 border-y border-white/10">
              {t.faq.items.map(([question, answer], index) => (
                <details key={question} className="group py-5" open={index === 0}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold text-white">
                    {question}
                    <span className="text-xl text-slate-500 transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-400">{answer}</p>
                </details>
              ))}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.035] p-8">
            <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-cyan-400/20 blur-3xl" />
            <div className="absolute -bottom-16 -left-16 h-44 w-44 rounded-full bg-emerald-400/16 blur-3xl" />
            <div className="relative flex aspect-square items-center justify-center rounded-[24px] border border-white/10 bg-black/30">
              <img src="/logo-mark.svg" alt="Logo do Lembreto" className="h-32 w-32" />
            </div>
            <p className="relative mt-6 text-sm font-semibold uppercase text-cyan-200">Logo nova aplicada</p>
            <p className="relative mt-2 text-sm leading-7 text-slate-400">
              A página não usa mais captura antiga do sistema: o destaque visual agora é reconstruído com a identidade atual.
            </p>
          </div>
        </section>

        <section id="acesso" className="mx-auto grid w-full max-w-7xl scroll-mt-28 gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.85fr_1fr] lg:px-8">
          <div className="self-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-[11px] font-bold uppercase text-slate-300">
              <ShieldCheck size={14} />
              {t.access.eyebrow}
            </span>
            <h2 className="mt-5 max-w-xl font-display text-4xl font-semibold leading-tight text-white sm:text-5xl">
              {t.access.title}
            </h2>
            <p className="mt-5 max-w-lg text-base leading-8 text-slate-400">
              {t.access.description}
            </p>

            <div className="mt-8 grid max-w-lg gap-3">
              {t.access.bullets.map((item) => (
                <div key={item} className="flex items-center gap-3 text-sm font-semibold text-slate-200">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-400/10 text-emerald-200">
                    <CheckCircle2 size={15} />
                  </span>
                  {item}
                </div>
              ))}
            </div>
          </div>

          <section className="min-w-0 rounded-[32px] border border-white/10 bg-white/[0.045] p-4 shadow-[0_30px_90px_-42px_rgba(0,0,0,0.95)] backdrop-blur-2xl sm:p-6 lg:p-8">
            <div className="mx-auto w-full min-w-0 max-w-md">
              <div className="mb-5 text-center sm:mb-8">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 shadow-[0_18px_36px_-22px_rgba(14,165,255,0.7)] ring-1 ring-cyan-300/20 sm:mb-4 sm:h-14 sm:w-14 sm:rounded-3xl">
                  <BrandMark className="h-9 w-9 sm:h-10 sm:w-10" />
                </div>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-[11px] font-bold uppercase text-slate-300">
                  {isRecovering ? t.auth.access : isLogin ? t.auth.login : t.auth.register}
                </span>
                <h3 className="mt-3 text-2xl font-semibold text-white sm:mt-4 sm:text-3xl">
                  {isRecovering
                    ? recoverSuccess
                      ? t.auth.verifyEmail
                      : t.auth.recover
                    : isLogin
                      ? t.auth.welcome
                      : t.auth.create}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  {isRecovering
                    ? recoverSuccess
                      ? t.auth.recoverSuccess
                      : t.auth.recoverCopy
                    : isLogin
                      ? t.auth.loginCopy
                      : t.auth.registerCopy}
                </p>
              </div>

              {isRecovering ? (
                recoverSuccess ? (
                  <div className="space-y-6 rounded-[24px] border border-white/10 bg-black/30 p-4 text-center sm:p-6">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-500/10 text-emerald-300">
                      <Mail size={28} />
                    </div>

                    <p className="text-sm leading-7 text-slate-400">
                      Se <span className="font-semibold text-slate-200">{recoverEmail}</span> estiver cadastrado, você receberá um link em breve.
                    </p>

                    <button
                      type="button"
                      onClick={() => {
                        setIsRecovering(false);
                        setRecoverSuccess(false);
                        setRecoverEmail(LS.loadRememberedEmail() || authEmail);
                        setAuthError('');
                        resetRecaptcha();
                      }}
                      className="action-primary w-full"
                    >
                      {t.auth.login}
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleRecover} className="space-y-4">
                    <div className="space-y-4 rounded-[24px] border border-white/10 bg-black/30 p-4 sm:p-6">
                      <div className="relative">
                        <Mail size={18} className="field-icon" />
                        <input
                          required
                          type="email"
                          autoComplete="email"
                          data-testid="recover-email-input"
                          placeholder="Seu e-mail"
                          value={recoverEmail}
                          onChange={(event) => setRecoverEmail(event.target.value)}
                          className="field-control field-control-with-icon border-white/10 bg-slate-950/70 text-white placeholder:text-slate-500"
                        />
                      </div>

                      {recaptchaMissingRequired ? (
                        <SecurityVerificationUnavailable />
                      ) : (
                        <RecaptchaCheckbox
                          siteKey={recaptchaEnabled ? recaptchaSiteKey : undefined}
                          resetKey={recaptchaResetKey}
                          onChange={setRecaptchaToken}
                          onUnavailable={handleRecaptchaUnavailable}
                        />
                      )}

                      {authError && (
                        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
                          {authError}
                        </p>
                      )}

                      <button
                        type="submit"
                        data-testid="recover-submit-button"
                        disabled={authLoading}
                        className="action-primary w-full disabled:cursor-wait disabled:opacity-60"
                      >
                        {authLoading ? '...' : t.auth.recover}
                      </button>
                    </div>

                    <p className="text-center text-sm">
                      <button
                        type="button"
                        data-testid="recover-back-button"
                        onClick={() => {
                          setIsRecovering(false);
                          setAuthError('');
                          resetRecaptcha();
                        }}
                        className="font-semibold text-blue-600 hover:underline dark:text-blue-300"
                      >
                        {t.auth.login}
                      </button>
                    </p>
                  </form>
                )
              ) : (
                <form onSubmit={handleAuth} className="space-y-4">
                    <div className="space-y-4 rounded-[24px] border border-white/10 bg-black/30 p-4 sm:p-6">
                    <div className="grid grid-cols-2 rounded-2xl bg-white/[0.05] p-1">
                      <button
                        type="button"
                        onClick={() => {
                          setIsLogin(true);
                          setAuthError('');
                          resetRecaptcha();
                        }}
                        className={[
                          'min-w-0 rounded-2xl px-2 py-3 text-sm font-semibold transition-colors sm:px-4',
                          isLogin
                            ? 'bg-white text-slate-950 shadow-sm'
                            : 'text-slate-400',
                        ].join(' ')}
                      >
                        {t.auth.login}
                      </button>
                      <button
                        type="button"
                        data-testid="auth-mode-toggle"
                        onClick={() => {
                          setIsLogin(false);
                          setAuthError('');
                          resetRecaptcha();
                        }}
                        className={[
                          'min-w-0 rounded-2xl px-2 py-3 text-sm font-semibold transition-colors sm:px-4',
                          !isLogin
                            ? 'bg-white text-slate-950 shadow-sm'
                            : 'text-slate-400',
                        ].join(' ')}
                      >
                        {t.auth.register}
                      </button>
                    </div>

                    {!isLogin && (
                      <div className="relative">
                        <UserIcon size={18} className="field-icon" />
                        <input
                          required
                          type="text"
                          autoComplete="name"
                          data-testid="register-name-input"
                          placeholder="Seu nome completo"
                          value={authName}
                          onChange={(event) => setAuthName(event.target.value)}
                          className="field-control field-control-with-icon border-white/10 bg-slate-950/70 text-white placeholder:text-slate-500"
                        />
                      </div>
                    )}

                    <div className="relative">
                      <Mail size={18} className="field-icon" />
                      <input
                        required
                        type="email"
                        autoComplete="email"
                        data-testid="auth-email-input"
                        placeholder="E-mail"
                        value={authEmail}
                        onChange={(event) => {
                          setAuthEmail(event.target.value);
                          if (!recoverEmail) setRecoverEmail(event.target.value);
                        }}
                        className="field-control field-control-with-icon border-white/10 bg-slate-950/70 text-white placeholder:text-slate-500"
                      />
                    </div>

                    <div className="relative">
                      <Lock size={18} className="field-icon" />
                      <input
                        required
                        type={showAuthPassword ? 'text' : 'password'}
                        autoComplete={isLogin ? 'current-password' : 'new-password'}
                        data-testid="auth-password-input"
                        placeholder="Senha"
                        value={authPassword}
                        onChange={(event) => setAuthPassword(event.target.value)}
                        className="field-control field-control-with-icon border-white/10 bg-slate-950/70 pr-12 text-white placeholder:text-slate-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowAuthPassword((current) => !current)}
                        aria-label={showAuthPassword ? 'Ocultar senha' : 'Mostrar senha'}
                        className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:hover:bg-white/[0.08] dark:hover:text-white"
                      >
                        {showAuthPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                      </button>
                    </div>

                    {!isLogin && authPassword.trim().length > 0 && (
                      <div data-testid="password-strength-indicator" className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                          <p className="text-sm font-semibold text-white">
                            {passwordStrength.label}
                          </p>
                          <span className="text-xs font-medium text-slate-500">
                            Segurança da senha
                          </span>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                          <div
                            className={`h-full rounded-full transition-all ${passwordStrength.tone}`}
                            style={{ width: passwordStrength.width }}
                          />
                        </div>
                        <p className="mt-3 text-xs leading-6 text-slate-400">
                          {passwordStrength.helper}
                        </p>
                      </div>
                    )}

                    {isLogin && (
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <label
                          htmlFor="remember-email"
                          className="inline-flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300"
                        >
                          <input
                            id="remember-email"
                            type="checkbox"
                            data-testid="remember-email-checkbox"
                            checked={rememberEmail}
                            onChange={(event) => setRememberEmail(event.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                          Lembrar meu e-mail
                        </label>

                        <button
                          type="button"
                          data-testid="forgot-password-button"
                          onClick={() => {
                            setIsRecovering(true);
                            setRecoverEmail(authEmail || LS.loadRememberedEmail());
                            setAuthError('');
                            resetRecaptcha();
                          }}
                          className="text-sm font-semibold text-blue-600 hover:underline dark:text-blue-300"
                        >
                          Esqueceu a senha?
                        </button>
                      </div>
                    )}

                    {recaptchaMissingRequired ? (
                      <SecurityVerificationUnavailable />
                    ) : (
                      <RecaptchaCheckbox
                        siteKey={recaptchaEnabled ? recaptchaSiteKey : undefined}
                        resetKey={recaptchaResetKey}
                        onChange={setRecaptchaToken}
                        onUnavailable={handleRecaptchaUnavailable}
                      />
                    )}

                    {authError && (
                      <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
                        {authError}
                      </p>
                    )}

                    {isLogin && (
                      <>
                        <div className="flex items-center gap-3">
                          <div className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
                          <span className="text-xs font-semibold uppercase text-slate-400 dark:text-slate-500">
                            ou
                          </span>
                          <div className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
                        </div>

                        <button
                          type="button"
                          data-testid="google-login-button"
                          disabled={authLoading}
                          onClick={() => {
                            setAuthError('');
                            setAuthLoading(true);
                            auth.loginWithGoogle();
                          }}
                          className="inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-slate-100 transition-all hover:-translate-y-0.5 hover:bg-white/[0.08] disabled:cursor-wait disabled:opacity-60"
                        >
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-base font-bold text-blue-600 shadow-sm">
                            G
                          </span>
                          Google
                        </button>
                      </>
                    )}

                    <button
                      type="submit"
                      data-testid="auth-submit-button"
                      disabled={authLoading}
                      className="action-primary w-full disabled:cursor-wait disabled:opacity-60"
                    >
                      {authLoading ? '...' : isLogin ? t.auth.login : t.auth.register}
                    </button>
                  </div>

                <p className="text-center text-sm text-slate-400">
                    {isLogin ? 'Ainda não tem uma conta?' : 'Já possui uma conta?'}{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setIsLogin((value) => !value);
                        setAuthError('');
                        resetRecaptcha();
                      }}
                      className="font-semibold text-blue-600 hover:underline dark:text-blue-300"
                    >
                      {isLogin ? t.auth.register : t.auth.login}
                    </button>
                  </p>
                </form>
              )}
            </div>
          </section>
        </section>
      </main>
    </div>
  );
}
