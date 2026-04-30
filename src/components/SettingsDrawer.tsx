import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  BellRing,
  CheckCircle2,
  Compass,
  FolderPlus,
  Loader2,
  MapPin,
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
import { BRAZIL_STATES } from '../../lib/brazil-location';
import type { HolidayRegionOption } from '../types';

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
  initialView?: SettingsView;
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
  onDeleteCategory: (name: string) => Promise<void>;
  onDeleteTag: (name: string) => Promise<void>;
  holidayStateCode: string | null;
  holidayCityName: string | null;
  holidayMatchedRegionName: string | null;
  holidayMunicipalSupported: boolean;
  holidaySupportedCities: HolidayRegionOption[];
  isSavingHolidayLocation: boolean;
  isDetectingHolidayLocation: boolean;
  onSaveHolidayLocation: (payload: { stateCode: string | null; cityName: string | null }) => Promise<void>;
  onDetectHolidayLocation: () => Promise<void>;
}

export type SettingsView =
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

function isDefaultCategory(value: string) {
  return ['Geral', 'Trabalho', 'Pessoal', 'Estudos'].some(
    (category) => category.localeCompare(value, 'pt-BR', { sensitivity: 'accent' }) === 0,
  );
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
  initialView = 'appearance',
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
  onDeleteCategory,
  onDeleteTag,
  holidayStateCode,
  holidayCityName,
  holidayMatchedRegionName,
  holidayMunicipalSupported,
  holidaySupportedCities,
  isSavingHolidayLocation,
  isDetectingHolidayLocation,
  onSaveHolidayLocation,
  onDetectHolidayLocation,
}: SettingsDrawerProps) {
  const [activeView, setActiveView] = React.useState<SettingsView>(initialView);
  const [categoryDraft, setCategoryDraft] = React.useState('');
  const [tagDraft, setTagDraft] = React.useState('');
  const [holidayStateDraft, setHolidayStateDraft] = React.useState(holidayStateCode ?? '');
  const [holidayCityDraft, setHolidayCityDraft] = React.useState(holidayCityName ?? '');
  const [isCreatingCategory, setIsCreatingCategory] = React.useState(false);
  const [isCreatingTag, setIsCreatingTag] = React.useState(false);
  const [deletingCategoryName, setDeletingCategoryName] = React.useState<string | null>(null);
  const [deletingTagName, setDeletingTagName] = React.useState<string | null>(null);
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
    setDeletingCategoryName(null);
    setDeletingTagName(null);
    setHolidayStateDraft(holidayStateCode ?? '');
    setHolidayCityDraft(holidayCityName ?? '');
    setActiveView(initialView);
  }, [holidayCityName, holidayStateCode, initialView, open]);

  React.useEffect(() => {
    if (!open) return;
    setActiveView(initialView);
  }, [initialView, open]);

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

  const handleDeleteCategory = React.useCallback(async (name: string) => {
    if (!name || deletingCategoryName === name) return;

    try {
      setDeletingCategoryName(name);
      await onDeleteCategory(name);
      setTaxonomyFeedback(`Categoria "${name}" excluída com sucesso.`);
    } catch (error) {
      setTaxonomyFeedback(
        error instanceof Error
          ? error.message
          : 'Não foi possível excluir a categoria agora. Tente novamente.',
      );
    } finally {
      setDeletingCategoryName(null);
    }
  }, [deletingCategoryName, onDeleteCategory]);

  const handleDeleteTag = React.useCallback(async (name: string) => {
    if (!name || deletingTagName === name) return;

    try {
      setDeletingTagName(name);
      await onDeleteTag(name);
      setTaxonomyFeedback(`Tag "${name}" excluída com sucesso.`);
    } catch (error) {
      setTaxonomyFeedback(
        error instanceof Error
          ? error.message
          : 'Não foi possível excluir a tag agora. Tente novamente.',
      );
    } finally {
      setDeletingTagName(null);
    }
  }, [deletingTagName, onDeleteTag]);

  const handleSaveHolidayLocation = React.useCallback(async () => {
    const nextStateCode = holidayStateDraft.trim() || null;
    const nextCityName = holidayCityDraft.trim() || null;

    try {
      await onSaveHolidayLocation({
        stateCode: nextStateCode,
        cityName: nextCityName,
      });
      setTaxonomyFeedback('Região de feriados atualizada com sucesso.');
    } catch (error) {
      setTaxonomyFeedback(
        error instanceof Error
          ? error.message
          : 'Não foi possível salvar a região agora. Tente novamente.',
      );
    }
  }, [holidayCityDraft, holidayStateDraft, onSaveHolidayLocation]);

  const handleDetectHolidayLocation = React.useCallback(async () => {
    try {
      await onDetectHolidayLocation();
      setTaxonomyFeedback('Localização detectada e aplicada com sucesso.');
    } catch (error) {
      setTaxonomyFeedback(
        error instanceof Error
          ? error.message
          : 'Não foi possível detectar sua localização agora.',
      );
    }
  }, [onDetectHolidayLocation]);

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

  const appearanceCards = React.useMemo(
    () => settingCards.filter((card) => card.section === 'appearance'),
    [],
  );
  const notificationCards = React.useMemo(
    () => settingCards.filter((card) => card.section === 'notifications'),
    [],
  );
  const organizationCards = React.useMemo(
    () => settingCards.filter((card) => card.section === 'organization'),
    [],
  );
  const safetyCards = React.useMemo(
    () => settingCards.filter((card) => card.section === 'safety'),
    [],
  );

  const activeViewMeta = settingsViews.find((view) => view.key === activeView) ?? settingsViews[0];

  const renderToggleCards = (cards: ReadonlyArray<(typeof settingCards)[number]>) => (
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
            {renderToggleCards(appearanceCards)}
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
            {renderToggleCards(notificationCards)}
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
              {renderToggleCards(organizationCards)}
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
                    <MapPin size={16} />
                    Região para feriados
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                    Escolha seu estado e cidade para incluir feriados estaduais e municipais junto aos nacionais.
                  </p>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                        Estado
                      </span>
                      <select
                        value={holidayStateDraft}
                        onChange={(event) => setHolidayStateDraft(event.target.value)}
                        className="field-control"
                      >
                        <option value="">Selecionar estado</option>
                        {BRAZIL_STATES.map((state) => (
                          <option key={state.code} value={state.code}>
                            {state.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                        Cidade
                      </span>
                      <input
                        type="text"
                        value={holidayCityDraft}
                        onChange={(event) => setHolidayCityDraft(event.target.value)}
                        placeholder="Ex.: São Paulo, Recife, Belo Horizonte"
                        className="field-control"
                      />
                    </label>
                  </div>

                  <div className="mt-4 rounded-2xl border border-slate-200/80 bg-slate-50/90 px-4 py-3 text-sm text-slate-600 dark:border-white/10 dark:bg-slate-950/40 dark:text-slate-300">
                    {holidayStateCode ? (
                      holidayMunicipalSupported ? (
                        <span>
                          Feriados municipais ativos para <strong>{holidayMatchedRegionName ?? holidayCityName ?? 'sua cidade'}</strong>.
                        </span>
                      ) : (
                        <span>
                          Os feriados nacionais e estaduais já estão ativos. Para municípios, a cobertura depende da cidade informada.
                        </span>
                      )
                    ) : (
                      <span>Sem região definida. Hoje o sistema mostra apenas os feriados nacionais.</span>
                    )}
                  </div>

                  {holidaySupportedCities.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                        Cidades reconhecidas neste estado
                      </p>
                      <div className="mt-2 flex max-h-24 flex-wrap gap-2 overflow-y-auto">
                        {holidaySupportedCities.map((city) => (
                          <span
                            key={city.code}
                            className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300"
                          >
                            {city.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={() => {
                        void handleDetectHolidayLocation();
                      }}
                      disabled={isDetectingHolidayLocation}
                      className="action-secondary min-h-[46px] flex-1 justify-center disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isDetectingHolidayLocation ? <Loader2 size={16} className="animate-spin" /> : <Compass size={16} />}
                      Usar minha localização
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleSaveHolidayLocation();
                      }}
                      disabled={isSavingHolidayLocation || !holidayStateDraft.trim()}
                      className="action-primary min-h-[46px] flex-1 justify-center disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSavingHolidayLocation ? <Loader2 size={16} className="animate-spin" /> : <MapPin size={16} />}
                      Salvar região
                    </button>
                  </div>
                </div>

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
                    {categories.map((item) => {
                      const isDeleting = deletingCategoryName === item;
                      const canDelete = !isDefaultCategory(item);

                      return (
                        <span
                          key={item}
                          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300"
                        >
                          <span>{item}</span>
                          {canDelete ? (
                            <button
                              type="button"
                              aria-label={`Excluir categoria ${item}`}
                              data-testid={`settings-category-delete-${item}`}
                              onClick={() => {
                                void handleDeleteCategory(item);
                              }}
                              disabled={isDeleting}
                              className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-red-300 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-slate-900 dark:text-slate-300"
                            >
                              {isDeleting ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
                            </button>
                          ) : null}
                        </span>
                      );
                    })}
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
                      tags.map((item) => {
                        const isDeleting = deletingTagName === item;

                        return (
                          <span
                            key={item}
                            className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300"
                          >
                            <Tag size={12} />
                            <span>{item}</span>
                            <button
                              type="button"
                              aria-label={`Excluir tag ${item}`}
                              data-testid={`settings-tag-delete-${item}`}
                              onClick={() => {
                                void handleDeleteTag(item);
                              }}
                              disabled={isDeleting}
                              className="flex h-5 w-5 items-center justify-center rounded-full border border-blue-200/90 bg-white/80 text-blue-600 transition hover:border-red-300 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-400/20 dark:bg-slate-900/80 dark:text-blue-200"
                            >
                              {isDeleting ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
                            </button>
                          </span>
                        );
                      })
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
            {renderToggleCards(safetyCards)}
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
            className="fixed inset-x-3 bottom-3 top-auto z-[101] mx-auto flex max-h-[86dvh] w-auto flex-col overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/96 shadow-[0_36px_120px_-42px_rgba(15,23,42,0.55)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/94 sm:inset-x-4 sm:top-1/2 sm:bottom-auto sm:max-h-[88vh] sm:w-full sm:max-w-6xl sm:-translate-y-1/2 sm:rounded-[32px]"
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
              <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)]">
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

                  <nav className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-2 lg:overflow-visible lg:pb-0" aria-label="Secoes de configuracoes">
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
                            'flex min-w-[200px] items-start gap-3 rounded-[22px] border px-4 py-3 text-left transition-all lg:w-full lg:min-w-0',
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
                    <div className="mt-6">
                      {renderActiveView()}
                    </div>
                  </div>
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
