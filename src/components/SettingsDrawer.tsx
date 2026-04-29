import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  BellRing,
  CheckCircle2,
  FolderPlus,
  Loader2,
  Moon,
  Plus,
  Settings,
  ShieldAlert,
  Sparkles,
  Tag,
  UserCircle2,
  Volume2,
  X,
} from 'lucide-react';
import { useSwipeToClose } from '../hooks/useSwipeToClose';

function Toggle({
  active,
  onClick,
  ariaLabel,
  autoFocus = false,
}: {
  active: boolean;
  onClick: () => void;
  ariaLabel: string;
  autoFocus?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      role="switch"
      aria-checked={active}
      className={[
        'relative h-8 w-14 rounded-full border transition-colors',
        active
          ? 'border-blue-600 bg-blue-600 dark:border-blue-500 dark:bg-blue-500'
          : 'border-slate-300 bg-slate-200 dark:border-white/10 dark:bg-slate-800',
      ].join(' ')}
    >
      <motion.span
        animate={{ x: active ? 28 : 4 }}
        transition={{ type: 'spring', stiffness: 360, damping: 28 }}
        className={[
          'absolute top-1 flex h-6 w-6 items-center justify-center rounded-full shadow-sm',
          active ? 'bg-white' : 'bg-white dark:bg-slate-200',
        ].join(' ')}
      />
    </button>
  );
}

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  notificationsEnabled: boolean;
  onToggleNotifications: () => void;
  onOpenNotificationsCenter: () => void;
  onOpenProfile: () => void;
  sound: boolean;
  onToggleSound: () => void;
  confirmDelete: boolean;
  onToggleConfirmDelete: () => void;
  showCompleted: boolean;
  onToggleShowCompleted: () => void;
  categories: string[];
  tags: string[];
  onCreateCategory: (name: string) => Promise<string>;
  onCreateTag: (name: string) => Promise<string>;
}

type SettingsView =
  | 'appearance'
  | 'notifications'
  | 'organization'
  | 'safety'
  | 'account'
  | 'center';

type SettingToggleKey =
  | 'darkMode'
  | 'notifications'
  | 'sound'
  | 'showCompleted'
  | 'confirmDelete';

const settingsViews: Array<{
  key: SettingsView;
  title: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
  {
    key: 'appearance',
    title: 'Aparência',
    description: 'Tema e leitura.',
    icon: Moon,
  },
  {
    key: 'notifications',
    title: 'Notificações',
    description: 'Alertas e sons.',
    icon: BellRing,
  },
  {
    key: 'organization',
    title: 'Organização',
    description: 'Agenda, tags e categorias.',
    icon: FolderPlus,
  },
  {
    key: 'safety',
    title: 'Segurança',
    description: 'Proteção contra ações acidentais.',
    icon: ShieldAlert,
  },
  {
    key: 'account',
    title: 'Conta',
    description: 'Perfil e acesso.',
    icon: UserCircle2,
  },
  {
    key: 'center',
    title: 'Central',
    description: 'Histórico de notificações.',
    icon: Settings,
  },
];

const settingCards: Array<{
  key: SettingToggleKey;
  section: SettingsView;
  title: string;
  description: string;
  helper: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
  {
    key: 'darkMode',
    section: 'appearance',
    title: 'Modo escuro',
    description: 'Ajusta a leitura para ambientes com pouca luz.',
    helper: 'Visual',
    icon: Moon,
  },
  {
    key: 'notifications',
    section: 'notifications',
    title: 'Notificações do sistema',
    description: 'Controla a central e os alertas do aplicativo.',
    helper: 'Acompanhamento',
    icon: BellRing,
  },
  {
    key: 'sound',
    section: 'notifications',
    title: 'Efeitos sonoros',
    description: 'Reproduz um som discreto em ações importantes.',
    helper: 'Feedback',
    icon: Volume2,
  },
  {
    key: 'showCompleted',
    section: 'organization',
    title: 'Mostrar concluídos',
    description: 'Mantém os lembretes finalizados visíveis para consulta rápida.',
    helper: 'Organização',
    icon: CheckCircle2,
  },
  {
    key: 'confirmDelete',
    section: 'safety',
    title: 'Confirmar exclusao',
    description: 'Pede confirmação antes de excluir um lembrete.',
    helper: 'Segurança',
    icon: ShieldAlert,
  },
];

function normalizeTaxonomyValue(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function SectionHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-5">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
        {eyebrow}
      </p>
      <h3 className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
        {title}
      </h3>
      <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-500 dark:text-slate-400">
        {description}
      </p>
    </div>
  );
}

function ActionPanel({
  title,
  description,
  buttonLabel,
  onAction,
  testId,
}: {
  title: string;
  description: string;
  buttonLabel: string;
  onAction: () => void;
  testId?: string;
}) {
  return (
    <section className="surface-soft p-5">
      <h3 className="text-lg font-semibold text-slate-950 dark:text-white">{title}</h3>
      <p className="mt-2 text-sm leading-7 text-slate-500 dark:text-slate-400">
        {description}
      </p>

      <button
        type="button"
        onClick={onAction}
        data-testid={testId}
        className="action-secondary mt-5 w-full justify-between"
      >
        {buttonLabel}
        <ArrowRight size={16} />
      </button>
    </section>
  );
}

export function SettingsDrawer({
  open,
  onClose,
  darkMode,
  onToggleDarkMode,
  notificationsEnabled,
  onToggleNotifications,
  onOpenNotificationsCenter,
  onOpenProfile,
  sound,
  onToggleSound,
  confirmDelete,
  onToggleConfirmDelete,
  showCompleted,
  onToggleShowCompleted,
  categories,
  tags,
  onCreateCategory,
  onCreateTag,
}: SettingsDrawerProps) {
  const [activeView, setActiveView] = React.useState<SettingsView>('appearance');
  const [categoryDraft, setCategoryDraft] = React.useState('');
  const [tagDraft, setTagDraft] = React.useState('');
  const [isCreatingCategory, setIsCreatingCategory] = React.useState(false);
  const [isCreatingTag, setIsCreatingTag] = React.useState(false);
  const [taxonomyFeedback, setTaxonomyFeedback] = React.useState('');

  const swipe = useSwipeToClose({
    enabled: open,
    direction: 'down',
    onClose,
  });

  React.useEffect(() => {
    if (!open) return;
    setCategoryDraft('');
    setTagDraft('');
    setTaxonomyFeedback('');
    setActiveView('appearance');
  }, [open]);

  const handleCreateCategory = React.useCallback(async () => {
    const normalized = normalizeTaxonomyValue(categoryDraft);
    if (!normalized || isCreatingCategory) return;

    try {
      setIsCreatingCategory(true);
      const created = await onCreateCategory(normalized);
      setCategoryDraft('');
      setTaxonomyFeedback(`Categoria "${created}" criada com sucesso.`);
    } catch {
      setTaxonomyFeedback('Não foi possível criar a categoria agora. Tente novamente.');
    } finally {
      setIsCreatingCategory(false);
    }
  }, [categoryDraft, isCreatingCategory, onCreateCategory]);

  const handleCreateTag = React.useCallback(async () => {
    const normalized = normalizeTaxonomyValue(tagDraft);
    if (!normalized || isCreatingTag) return;

    try {
      setIsCreatingTag(true);
      const created = await onCreateTag(normalized);
      setTagDraft('');
      setTaxonomyFeedback(`Tag "${created}" criada com sucesso.`);
    } catch {
      setTaxonomyFeedback('Não foi possível criar a tag agora. Tente novamente.');
    } finally {
      setIsCreatingTag(false);
    }
  }, [isCreatingTag, onCreateTag, tagDraft]);

  const toggleMap = {
    darkMode: {
      active: darkMode,
      onClick: onToggleDarkMode,
      ariaLabel: 'Alternar modo escuro',
    },
    notifications: {
      active: notificationsEnabled,
      onClick: onToggleNotifications,
      ariaLabel: 'Alternar notificacoes do sistema',
    },
    sound: {
      active: sound,
      onClick: onToggleSound,
      ariaLabel: 'Alternar efeitos sonoros',
    },
    confirmDelete: {
      active: confirmDelete,
      onClick: onToggleConfirmDelete,
      ariaLabel: 'Alternar confirmação de exclusão',
    },
    showCompleted: {
      active: showCompleted,
      onClick: onToggleShowCompleted,
      ariaLabel: 'Alternar exibição de lembretes concluídos',
    },
  } as const;

  const cardsForActiveView = React.useMemo(
    () => settingCards.filter((card) => card.section === activeView),
    [activeView],
  );

  const activeViewMeta = settingsViews.find((view) => view.key === activeView) ?? settingsViews[0];

  const renderToggleCards = (cards: typeof settingCards) => (
    <div className="grid gap-4 md:grid-cols-2">
      {cards.map((card, index) => {
        const config = toggleMap[card.key];
        const Icon = card.icon;

        return (
          <section
            key={card.key}
            className="flex h-full flex-col justify-between gap-5 rounded-[26px] border border-slate-200/80 bg-white/80 p-5 dark:border-white/10 dark:bg-white/[0.04]"
          >
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300">
                <Icon size={18} />
              </div>

              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                  {card.helper}
                </p>
                <h3 className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                  {card.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                  {card.description}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-slate-50/90 px-4 py-3 dark:border-white/10 dark:bg-slate-950/40">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  {config.active ? 'Ativado' : 'Desativado'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Toque para alternar esta preferência.
                </p>
              </div>

              <Toggle
                active={config.active}
                onClick={config.onClick}
                ariaLabel={config.ariaLabel}
                autoFocus={index === 0}
              />
            </div>
          </section>
        );
      })}
    </div>
  );

  const renderActiveView = () => {
    switch (activeView) {
      case 'appearance':
        return (
          <section className="surface-soft p-5">
            <SectionHeader
              eyebrow="Aparência"
              title="Visual do sistema"
              description="Ajuste o visual para deixar o uso mais confortável."
            />
            {renderToggleCards(cardsForActiveView)}
          </section>
        );

      case 'notifications':
        return (
          <section className="surface-soft p-5">
            <SectionHeader
              eyebrow="Notificações"
              title="Alertas e sinais"
              description="Defina como o Lembreto chama sua atenção."
            />
            {renderToggleCards(cardsForActiveView)}
          </section>
        );

      case 'organization':
        return (
          <section className="space-y-4">
            <section className="surface-soft p-5">
              <SectionHeader
                eyebrow="Organização"
                title="Visibilidade dos lembretes"
                description="Defina como seus lembretes aparecem na agenda."
              />
              {renderToggleCards(cardsForActiveView)}
            </section>

            <section className="surface-soft p-5">
              <SectionHeader
                eyebrow="Taxonomia"
                title="Categorias e tags"
                description="Cadastre aqui as categorias e tags usadas no dia a dia."
              />

              <div className="space-y-5">
                <div className="rounded-3xl border border-slate-200/80 bg-white/80 p-4 dark:border-white/10 dark:bg-white/[0.04]">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                    <FolderPlus size={16} />
                    Categorias personalizadas
                  </div>
                  <div className="mt-3 flex gap-2">
                    <input
                      type="text"
                      value={categoryDraft}
                      data-testid="settings-category-create-input"
                      onChange={(event) => setCategoryDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void handleCreateCategory();
                        }
                      }}
                      placeholder="Ex.: Saude, Financeiro..."
                      className="field-control"
                    />
                    <button
                      type="button"
                      data-testid="settings-category-create-button"
                      onClick={() => {
                        void handleCreateCategory();
                      }}
                      disabled={isCreatingCategory || !normalizeTaxonomyValue(categoryDraft)}
                      className="action-secondary min-w-[120px] justify-center rounded-xl px-4 py-0 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isCreatingCategory ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                      Criar
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {categories.map((item) => (
                      <span
                        key={item}
                        className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-200/80 bg-white/80 p-4 dark:border-white/10 dark:bg-white/[0.04]">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                    <Tag size={16} />
                    Tags personalizadas
                  </div>
                  <div className="mt-3 flex gap-2">
                    <input
                      type="text"
                      value={tagDraft}
                      data-testid="settings-tag-create-input"
                      onChange={(event) => setTagDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void handleCreateTag();
                        }
                      }}
                      placeholder="Ex.: Reuniao, Estudo, Urgente..."
                      className="field-control"
                    />
                    <button
                      type="button"
                      data-testid="settings-tag-create-button"
                      onClick={() => {
                        void handleCreateTag();
                      }}
                      disabled={isCreatingTag || !normalizeTaxonomyValue(tagDraft)}
                      className="action-secondary min-w-[120px] justify-center rounded-xl px-4 py-0 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isCreatingTag ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                      Criar
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {tags.length > 0 ? (
                      tags.map((item) => (
                        <span
                          key={item}
                          className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300"
                        >
                          <Tag size={12} />
                          {item}
                        </span>
                      ))
                    ) : (
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Você ainda não cadastrou tags personalizadas.
                      </p>
                    )}
                  </div>
                </div>

                {taxonomyFeedback && (
                  <p className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
                    {taxonomyFeedback}
                  </p>
                )}
              </div>
            </section>
          </section>
        );

      case 'safety':
        return (
          <section className="surface-soft p-5">
            <SectionHeader
              eyebrow="Segurança"
              title="Protecao de acoes"
              description="Reduza o risco de mudancas acidentais e mantenha os lembretes mais protegidos no uso diario."
            />
            {renderToggleCards(cardsForActiveView)}
          </section>
        );

      case 'account':
        return (
          <ActionPanel
            title="Conta e identidade"
            description="Atualize nome, e-mail, senha e avatar sem sair daqui."
            buttonLabel="Abrir perfil"
            onAction={onOpenProfile}
          />
        );

      case 'center':
        return (
          <ActionPanel
            title="Central de notificacoes"
            description="Abra o histórico completo dos avisos do sistema."
            buttonLabel="Abrir central de notificacoes"
            onAction={onOpenNotificationsCenter}
            testId="settings-open-notifications-center"
          />
        );

      default:
        return null;
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[100] bg-slate-950/60 backdrop-blur-sm"
          />

          <motion.section
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: swipe.offset, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={swipe.isDragging ? { duration: 0 } : { type: 'spring', damping: 26, stiffness: 260 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-drawer-title"
            className="fixed inset-x-4 top-1/2 z-[101] mx-auto flex max-h-[88vh] w-full max-w-6xl -translate-y-1/2 flex-col overflow-hidden rounded-[32px] border border-slate-200/80 bg-white/96 shadow-[0_36px_120px_-42px_rgba(15,23,42,0.55)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/94"
          >
            {swipe.mobileEnabled && (
              <div
                className="flex justify-center border-b border-slate-200/70 px-4 py-3 dark:border-white/10"
                aria-hidden="true"
                {...swipe.bind}
              >
                <span className="h-1.5 w-14 rounded-full bg-slate-300/90 dark:bg-slate-700" />
              </div>
            )}

            <div className="border-b border-slate-200/80 px-6 py-5 dark:border-white/10 md:px-7">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <span className="section-eyebrow">
                    <Settings size={14} />
                    Preferencias
                  </span>
                  <h2 id="settings-drawer-title" className="mt-4 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white md:text-3xl">
                    Configurações
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-500 dark:text-slate-400">
                    Ajuste notificações, organização e comportamento do aplicativo.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Fechar configuracoes"
                  className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-500 transition-colors hover:bg-slate-100 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.08]"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6 md:px-7">
              <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
                <aside className="surface-soft h-fit p-4">
                  <div className="rounded-[24px] border border-blue-200/70 bg-gradient-to-br from-blue-50 to-sky-50 p-4 dark:border-blue-500/20 dark:bg-blue-500/10">
                    <div className="flex items-start gap-3">
                      <span className="icon-slot h-11 w-11 rounded-2xl bg-gradient-to-br from-blue-600 to-sky-500 text-white shadow-[0_16px_32px_-20px_rgba(37,99,235,0.7)]">
                        <Sparkles size={18} />
                      </span>
                      <div>
                        <h3 className="text-sm font-semibold text-slate-950 dark:text-white">
                          Painel de preferências
                        </h3>
                        <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-300">
                          Escolha uma area ao lado para ver apenas o que importa agora.
                        </p>
                      </div>
                    </div>
                  </div>

                  <nav className="mt-4 space-y-2" aria-label="Secoes de configuracoes">
                    {settingsViews.map((view) => {
                      const Icon = view.icon;
                      const isActive = activeView === view.key;

                      return (
                        <button
                          key={view.key}
                          type="button"
                          onClick={() => setActiveView(view.key)}
                          data-testid={`settings-nav-${view.key}`}
                          className={[
                            'flex w-full items-start gap-3 rounded-[22px] border px-4 py-3 text-left transition-all',
                            isActive
                              ? 'border-blue-500/30 bg-blue-50 text-blue-700 shadow-[0_20px_40px_-28px_rgba(37,99,235,0.8)] dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300'
                              : 'border-slate-200/80 bg-white/80 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300 dark:hover:border-white/15 dark:hover:bg-white/[0.06]',
                          ].join(' ')}
                          aria-pressed={isActive}
                        >
                          <span className={[
                            'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border',
                            isActive
                              ? 'border-blue-500/20 bg-white text-blue-600 dark:border-blue-500/20 dark:bg-slate-950/60 dark:text-blue-300'
                              : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300',
                          ].join(' ')}>
                            <Icon size={18} />
                          </span>

                          <span className="min-w-0">
                            <span className="block text-sm font-semibold">{view.title}</span>
                            <span className="mt-1 block text-xs leading-5 text-current/75">
                              {view.description}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </nav>
                </aside>

                <section className="space-y-4">
                  <div className="surface-soft p-5">
                    <div className="flex items-start gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white text-blue-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-blue-300">
                        <activeViewMeta.icon size={20} />
                      </div>
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                          Area ativa
                        </p>
                        <h3 className="mt-1 text-lg font-semibold text-slate-950 dark:text-white">
                          {activeViewMeta.title}
                        </h3>
                        <p className="mt-2 text-sm leading-7 text-slate-500 dark:text-slate-400">
                          {activeViewMeta.description}
                        </p>
                      </div>
                    </div>
                  </div>

                  {renderActiveView()}
                </section>
              </div>
            </div>

            <div className="border-t border-slate-200/80 px-6 py-5 dark:border-white/10 md:px-7">
              <p className="text-center text-xs text-slate-400 dark:text-slate-500">
                As configuracoes sao salvas neste navegador e aplicadas imediatamente.
              </p>
            </div>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  );
}
