import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  BellRing,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Compass,
  Download,
  FolderPlus,
  Link,
  Loader2,
  MapPin,
  MonitorSmartphone,
  Moon,
  Plug,
  Plus,
  RefreshCw,
  Settings,
  ShieldAlert,
  Tag,
  Unplug,
  UserCircle2,
  Volume2,
  X,
} from 'lucide-react';
import { useSwipeToClose } from '../hooks/useSwipeToClose';
import { usePwaInstall } from '../hooks/usePwaInstall';
import { BRAZIL_STATES } from '../../lib/brazil-location';
import { isDefaultCategory, normalizeTaxonomyValue } from '../lib/taxonomy';
import { buildNoTimeReminderMinutes, splitMinutesIntoTimeParts } from '../lib/taskDueDate';
import type {
  CalendarIntegrationProvider,
  CalendarIntegrationStatus,
  CalendarSyncAllResult,
  HolidayRegionOption,
} from '../types';

function Toggle({
  active,
  onClick,
  ariaLabel,
  autoFocus = false,
  disabled = false,
}: {
  active: boolean;
  onClick: () => void;
  ariaLabel: string;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      autoFocus={autoFocus}
      disabled={disabled}
      aria-label={ariaLabel}
      role="switch"
      aria-checked={active}
      className={[
        'relative h-8 w-14 rounded-full border transition-colors',
        disabled ? 'cursor-not-allowed opacity-60' : '',
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
  desktopNotificationsSupported: boolean;
  desktopNotificationsEnabled: boolean;
  desktopNotificationsReady: boolean;
  desktopNotificationsPermission: NotificationPermission;
  desktopNotificationsConfigured: boolean;
  desktopNotificationsError: string | null;
  isSyncingDesktopNotifications: boolean;
  onToggleDesktopNotifications: () => void;
  onOpenNotificationsCenter: () => void;
  onOpenProfile: () => void;
  sound: boolean;
  onToggleSound: () => void;
  confirmDelete: boolean;
  onToggleConfirmDelete: () => void;
  showCompleted: boolean;
  onToggleShowCompleted: () => void;
  noTimeReminderMinutes: number;
  onChangeNoTimeReminderMinutes: (minutes: number) => void;
  categories: string[];
  tags: string[];
  onCreateCategory: (name: string) => Promise<string>;
  onCreateTag: (name: string) => Promise<string>;
  onDeleteCategory: (name: string) => Promise<void>;
  onDeleteTag: (name: string) => Promise<void>;
  onDownloadCalendar: () => Promise<void>;
  onCopyCalendarFeed: () => Promise<void>;
  onRotateCalendarFeed: () => Promise<void>;
  calendarIntegrations: CalendarIntegrationStatus[];
  isLoadingCalendarIntegrations: boolean;
  onConnectCalendar: (provider: CalendarIntegrationProvider) => void;
  onDisconnectCalendar: (provider: CalendarIntegrationProvider) => Promise<void>;
  onToggleCalendarSync: (provider: CalendarIntegrationProvider, syncEnabled: boolean) => Promise<void>;
  onSyncAllCalendar: (provider: CalendarIntegrationProvider) => Promise<CalendarSyncAllResult>;
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
  | 'integrations'
  | 'safety'
  | 'account';

type SettingToggleKey =
  | 'darkMode'
  | 'notifications'
  | 'desktopNotifications'
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
    key: 'integrations',
    title: 'Integrações',
    description: 'Calendários externos.',
    icon: Plug,
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
    title: 'Central de notificações',
    description: 'Registra novos avisos no histórico interno e nos alertas dentro do app.',
    helper: 'Acompanhamento',
    icon: BellRing,
  },
  {
    key: 'desktopNotifications',
    section: 'notifications',
    title: 'Notificações do Windows',
    description: 'Envia push para este navegador quando você quiser receber avisos fora da aba.',
    helper: 'Windows',
    icon: MonitorSmartphone,
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
    title: 'Confirmar exclusão',
    description: 'Pede confirmação antes de excluir um lembrete.',
    helper: 'Segurança',
    icon: ShieldAlert,
  },
];

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
    <section className="rounded-[26px] border border-slate-200/80 bg-white/86 p-5 shadow-[0_18px_50px_-40px_rgba(15,23,42,0.55)] dark:border-white/10 dark:bg-white/[0.04]">
      <h3 className="text-lg font-semibold text-slate-950 dark:text-white">{title}</h3>
      <p className="mt-2 text-sm leading-7 text-slate-500 dark:text-slate-400">
        {description}
      </p>

      <button
        type="button"
        onClick={onAction}
        data-testid={testId}
        className="action-secondary mt-5 min-h-[48px] w-full justify-between rounded-2xl"
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
  desktopNotificationsEnabled,
  desktopNotificationsReady,
  isSyncingDesktopNotifications,
  onToggleDesktopNotifications,
  onOpenNotificationsCenter,
  onOpenProfile,
  sound,
  onToggleSound,
  confirmDelete,
  onToggleConfirmDelete,
  showCompleted,
  onToggleShowCompleted,
  noTimeReminderMinutes,
  onChangeNoTimeReminderMinutes,
  categories,
  tags,
  onCreateCategory,
  onCreateTag,
  onDeleteCategory,
  onDeleteTag,
  onDownloadCalendar,
  onCopyCalendarFeed,
  onRotateCalendarFeed,
  calendarIntegrations,
  isLoadingCalendarIntegrations,
  onConnectCalendar,
  onDisconnectCalendar,
  onToggleCalendarSync,
  onSyncAllCalendar,
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
  const [isDownloadingCalendar, setIsDownloadingCalendar] = React.useState(false);
  const [isCopyingCalendarFeed, setIsCopyingCalendarFeed] = React.useState(false);
  const [isRotatingCalendarFeed, setIsRotatingCalendarFeed] = React.useState(false);
  const [busyCalendarProvider, setBusyCalendarProvider] = React.useState<CalendarIntegrationProvider | null>(null);
  const [taxonomyFeedback, setTaxonomyFeedback] = React.useState('');
  const [calendarFeedback, setCalendarFeedback] = React.useState('');
  const [holidayFeedback, setHolidayFeedback] = React.useState('');
  const {
    canInstall,
    isInstalled,
    installHelpText,
    promptInstall,
  } = usePwaInstall();

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
    setHolidayFeedback('');
    setCalendarFeedback('');
    setDeletingCategoryName(null);
    setDeletingTagName(null);
    setBusyCalendarProvider(null);
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
      setHolidayFeedback('Região de feriados atualizada com sucesso.');
    } catch (error) {
      setHolidayFeedback(
        error instanceof Error
          ? error.message
          : 'Não foi possível salvar a região agora. Tente novamente.',
      );
    }
  }, [holidayCityDraft, holidayStateDraft, onSaveHolidayLocation]);

  const handleDetectHolidayLocation = React.useCallback(async () => {
    try {
      await onDetectHolidayLocation();
      setHolidayFeedback('Localização detectada e aplicada com sucesso.');
    } catch (error) {
      setHolidayFeedback(
        error instanceof Error
          ? error.message
          : 'Não foi possível detectar sua localização agora.',
      );
    }
  }, [onDetectHolidayLocation]);

  const handleDownloadCalendar = React.useCallback(async () => {
    if (isDownloadingCalendar) return;

    try {
      setIsDownloadingCalendar(true);
      await onDownloadCalendar();
      setCalendarFeedback('Arquivo .ics gerado com seus lembretes pendentes.');
    } catch {
      setCalendarFeedback('Não foi possível exportar a agenda agora.');
    } finally {
      setIsDownloadingCalendar(false);
    }
  }, [isDownloadingCalendar, onDownloadCalendar]);

  const handleCopyCalendarFeed = React.useCallback(async () => {
    if (isCopyingCalendarFeed) return;

    try {
      setIsCopyingCalendarFeed(true);
      await onCopyCalendarFeed();
      setCalendarFeedback('Link do feed copiado para assinatura no Google ou Outlook.');
    } catch {
      setCalendarFeedback('Não foi possível copiar o feed agora.');
    } finally {
      setIsCopyingCalendarFeed(false);
    }
  }, [isCopyingCalendarFeed, onCopyCalendarFeed]);

  const handleRotateCalendarFeed = React.useCallback(async () => {
    if (isRotatingCalendarFeed) return;

    try {
      setIsRotatingCalendarFeed(true);
      await onRotateCalendarFeed();
      setCalendarFeedback('Feed rotacionado. Links anteriores foram revogados e o novo link foi copiado.');
    } catch {
      setCalendarFeedback('Não foi possível rotacionar o feed agora.');
    } finally {
      setIsRotatingCalendarFeed(false);
    }
  }, [isRotatingCalendarFeed, onRotateCalendarFeed]);

  const handleDisconnectCalendar = React.useCallback(async (provider: CalendarIntegrationProvider) => {
    if (busyCalendarProvider) return;

    try {
      setBusyCalendarProvider(provider);
      await onDisconnectCalendar(provider);
      setCalendarFeedback(`${provider === 'google' ? 'Google Calendar' : 'Outlook Calendar'} desconectado.`);
    } catch {
      setCalendarFeedback('Não foi possível desconectar o calendário agora.');
    } finally {
      setBusyCalendarProvider(null);
    }
  }, [busyCalendarProvider, onDisconnectCalendar]);

  const handleToggleCalendarSync = React.useCallback(async (
    provider: CalendarIntegrationProvider,
    syncEnabled: boolean,
  ) => {
    if (busyCalendarProvider) return;

    try {
      setBusyCalendarProvider(provider);
      await onToggleCalendarSync(provider, syncEnabled);
      setCalendarFeedback(syncEnabled
        ? 'Novos lembretes serão enviados ao calendário conectado.'
        : 'Novos lembretes deixarão de ser enviados automaticamente.');
    } catch {
      setCalendarFeedback('Não foi possível salvar a preferência do calendário.');
    } finally {
      setBusyCalendarProvider(null);
    }
  }, [busyCalendarProvider, onToggleCalendarSync]);

  const handleSyncAllCalendar = React.useCallback(async (provider: CalendarIntegrationProvider) => {
    if (busyCalendarProvider) return;

    try {
      setBusyCalendarProvider(provider);
      const result = await onSyncAllCalendar(provider);
      const providerName = provider === 'google' ? 'Google Calendar' : 'Outlook Calendar';
      setCalendarFeedback(
        result.failed > 0
          ? `${providerName}: sincronização não concluída para todos os itens. ${result.failed} falha${result.failed === 1 ? '' : 's'} encontrada${result.failed === 1 ? '' : 's'}.`
          : `${providerName}: sincronização concluída. ${result.pushed} lembrete${result.pushed === 1 ? '' : 's'} enviado${result.pushed === 1 ? '' : 's'}, ${result.imported} evento${result.imported === 1 ? '' : 's'} importado${result.imported === 1 ? '' : 's'} e ${result.deduplicated} duplicata${result.deduplicated === 1 ? '' : 's'} resolvida${result.deduplicated === 1 ? '' : 's'}.`,
      );
    } catch {
      setCalendarFeedback('Não foi possível sincronizar todos os lembretes agora.');
    } finally {
      setBusyCalendarProvider(null);
    }
  }, [busyCalendarProvider, onSyncAllCalendar]);

  const toggleMap = {
    darkMode: {
      active: darkMode,
      onClick: onToggleDarkMode,
      ariaLabel: 'Alternar modo escuro',
    },
    notifications: {
      active: notificationsEnabled,
      onClick: onToggleNotifications,
      ariaLabel: 'Alternar notificações da central',
    },
    desktopNotifications: {
      active: desktopNotificationsEnabled,
      onClick: onToggleDesktopNotifications,
      ariaLabel: 'Alternar push do Windows',
      disabled: isSyncingDesktopNotifications,
      statusLabel: isSyncingDesktopNotifications
        ? 'Sincronizando'
        : desktopNotificationsEnabled && desktopNotificationsReady
          ? 'Ativado'
          : desktopNotificationsEnabled
            ? 'Pendente'
          : 'Desativado',
      statusHint: desktopNotificationsReady
        ? 'Toque para desconectar este navegador.'
        : desktopNotificationsEnabled
          ? 'A conexão ainda não está pronta neste navegador.'
        : 'Toque para conectar este navegador.',
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
  const noTimeReminderParts = splitMinutesIntoTimeParts(noTimeReminderMinutes);

  const updateNoTimeReminderPart = (part: 'hours' | 'minutes', value: string) => {
    const parsedValue = Number.parseInt(value, 10);
    const nextValue = Number.isNaN(parsedValue) ? 0 : parsedValue;

    onChangeNoTimeReminderMinutes(
      buildNoTimeReminderMinutes(
        part === 'hours' ? nextValue : noTimeReminderParts.hours,
        part === 'minutes' ? nextValue : noTimeReminderParts.minutes,
      ),
    );
  };

  const renderToggleCards = (cards: ReadonlyArray<(typeof settingCards)[number]>) => (
    <div className="grid gap-4 md:grid-cols-2">
      {cards.map((card, index) => {
        const config = toggleMap[card.key];
        const Icon = card.icon;
        const statusLabel = 'statusLabel' in config
          ? config.statusLabel
          : config.active ? 'Ativado' : 'Desativado';
        const statusHint = 'statusHint' in config
          ? config.statusHint
          : 'Toque para alternar esta preferência.';
        const disabled = 'disabled' in config ? config.disabled : false;

        return (
          <section
            key={card.key}
            className="flex h-full flex-col justify-between gap-5 rounded-[26px] border border-slate-200/80 bg-white/90 p-5 shadow-[0_18px_48px_-42px_rgba(15,23,42,0.55)] transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_22px_58px_-42px_rgba(37,99,235,0.55)] dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-blue-400/25"
          >
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-blue-100 bg-blue-50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
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
                  {statusLabel}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {statusHint}
                </p>
              </div>

              <Toggle
                active={config.active}
                onClick={config.onClick}
                ariaLabel={config.ariaLabel}
                autoFocus={index === 0}
                disabled={disabled}
              />
            </div>
          </section>
        );
      })}
    </div>
  );

  const renderHolidayRegionPanel = () => (
    <section className="rounded-[28px] border border-slate-200/80 bg-slate-50/80 p-5 dark:border-white/10 dark:bg-white/[0.03]">
      <SectionHeader
        eyebrow="Feriados"
        title="Região para feriados"
        description="Escolha seu estado e cidade para incluir feriados estaduais e municipais junto aos nacionais."
      />

      <div className="rounded-3xl border border-slate-200/80 bg-white/80 p-4 dark:border-white/10 dark:bg-white/[0.04]">
        <div className="mt-1 grid gap-3 sm:grid-cols-2">
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

      {holidayFeedback && (
        <p className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
          {holidayFeedback}
        </p>
      )}
    </section>
  );

  const renderCalendarSyncPanel = () => (
    <section className="rounded-[28px] border border-blue-100 bg-blue-50/50 p-5 dark:border-blue-500/20 dark:bg-blue-500/10">
      <SectionHeader
        eyebrow="Exportação"
        title="Feed e arquivo de calendário"
        description="Exporte um arquivo .ics ou copie um feed assinável com os lembretes pendentes."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => {
            void handleDownloadCalendar();
          }}
          disabled={isDownloadingCalendar}
          className="action-secondary min-h-[52px] justify-center disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isDownloadingCalendar ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          Baixar .ics
        </button>
        <button
          type="button"
          onClick={() => {
            void handleCopyCalendarFeed();
          }}
          disabled={isCopyingCalendarFeed}
          className="action-primary min-h-[52px] justify-center disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isCopyingCalendarFeed ? <Loader2 size={16} className="animate-spin" /> : <Link size={16} />}
          Copiar feed
        </button>
        <button
          type="button"
          onClick={() => {
            void handleRotateCalendarFeed();
          }}
          disabled={isRotatingCalendarFeed}
          className="action-secondary min-h-[52px] justify-center disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isRotatingCalendarFeed ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          Rotacionar
        </button>
      </div>

      <div className="mt-4 flex items-start gap-3 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 text-sm text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300">
        <CalendarDays size={16} className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-300" />
        <p>
          O feed inclui lembretes pendentes com prazo definido, expira automaticamente e pode ser rotacionado se o link for compartilhado por engano.
        </p>
      </div>

      {calendarFeedback && (
        <p className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
          {calendarFeedback}
        </p>
      )}
    </section>
  );

  const renderConnectedCalendarsPanel = () => {
    const providers: Array<{
      provider: CalendarIntegrationProvider;
      title: string;
      description: string;
    }> = [
      {
        provider: 'google',
        title: 'Google Calendar',
        description: 'Cria e atualiza eventos no calendário principal com permissão de eventos.',
      },
      {
        provider: 'outlook',
        title: 'Outlook Calendar',
        description: 'Cria e atualiza eventos pelo Microsoft Graph com acesso de calendário.',
      },
    ];

    return (
      <section className="rounded-[28px] border border-blue-100 bg-blue-50/50 p-5 dark:border-blue-500/20 dark:bg-blue-500/10">
        <SectionHeader
          eyebrow="Calendários conectados"
          title="Sincronização real"
          description="Conecte o Google Calendar ou o Outlook Calendar. Apenas lembretes autorizados e com prazo definido são enviados."
        />

        <div className="space-y-3">
          {providers.map(({ provider, title, description }) => {
            const integration = calendarIntegrations.find((item) => item.provider === provider);
            const connected = integration?.connected ?? false;
            const busy = busyCalendarProvider === provider;

            return (
              <div
                key={provider}
                className="rounded-[26px] border border-slate-200/80 bg-white/92 p-4 shadow-[0_18px_48px_-42px_rgba(15,23,42,0.5)] dark:border-white/10 dark:bg-slate-950/42"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className={[
                      'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border',
                      connected
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
                        : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300',
                    ].join(' ')}>
                      {busy || isLoadingCalendarIntegrations ? <Loader2 size={17} className="animate-spin" /> : <Plug size={17} />}
                    </span>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                          {title}
                        </h4>
                        <span className={[
                          'rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em]',
                          connected
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
                            : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300',
                        ].join(' ')}>
                          {connected ? 'Conectado' : 'Desconectado'}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                        {description}
                      </p>
                      {integration?.lastError ? (
                        <p className="mt-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-100">
                          Último erro: {integration.lastError}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row lg:shrink-0">
                    {connected ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            void handleToggleCalendarSync(provider, !(integration?.syncEnabled ?? false));
                          }}
                          disabled={busy}
                          className="action-secondary min-h-[44px] justify-center disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {busy ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                          {integration?.syncEnabled ? 'Pausar envio' : 'Enviar novos'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void handleSyncAllCalendar(provider);
                          }}
                          disabled={busy}
                          className="action-primary min-h-[44px] justify-center disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {busy ? <Loader2 size={16} className="animate-spin" /> : <CalendarDays size={16} />}
                          Sincronizar tudo
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void handleDisconnectCalendar(provider);
                          }}
                          disabled={busy}
                          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/15"
                        >
                          {busy ? <Loader2 size={16} className="animate-spin" /> : <Unplug size={16} />}
                          Desconectar
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onConnectCalendar(provider)}
                        disabled={busy}
                        className="action-primary min-h-[44px] justify-center disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {busy ? <Loader2 size={16} className="animate-spin" /> : <Plug size={16} />}
                        Conectar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 rounded-2xl border border-blue-200/80 bg-white/86 px-4 py-3 text-sm text-slate-600 dark:border-blue-400/20 dark:bg-slate-950/40 dark:text-slate-300">
          A permissão solicitada é a mínima necessária para criar, atualizar e remover os eventos gerados pelo Lembreto.
        </div>
      </section>
    );
  };

  const renderInstallPanel = () => (
    <section className="rounded-[28px] border border-slate-200/80 bg-slate-50/80 p-5 dark:border-white/10 dark:bg-white/[0.03]">
      <SectionHeader
        eyebrow="PWA"
        title="Instalar app"
        description="Abra o Lembreto pela tela inicial do celular ou pelo menu de aplicativos do desktop."
      />

      <div className="rounded-[26px] border border-slate-200/80 bg-white/80 p-5 dark:border-white/10 dark:bg-white/[0.04]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <span className="inline-flex rounded-full border border-slate-200/80 bg-slate-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-400">
              {isInstalled ? 'Instalado' : canInstall ? 'Disponível' : 'Manual'}
            </span>
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                {isInstalled ? 'Lembreto instalado' : 'Adicionar o Lembreto ao dispositivo'}
              </h3>
              <p className="mt-2 max-w-xl text-sm leading-7 text-slate-500 dark:text-slate-400">
                {installHelpText}
              </p>
            </div>
          </div>

          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-200">
            <MonitorSmartphone size={18} />
          </div>
        </div>

        {!isInstalled && canInstall ? (
          <button
            type="button"
            data-testid="settings-install-pwa"
            onClick={() => {
              void promptInstall();
            }}
            className="action-primary mt-5 w-full justify-between"
          >
            Instalar Lembreto
            <Download size={16} />
          </button>
        ) : null}
      </div>
    </section>
  );

  const renderActiveView = () => {
    switch (activeView) {
      case 'appearance':
        return (
          <section className="space-y-4">
            <section className="rounded-[28px] border border-slate-200/80 bg-slate-50/80 p-5 dark:border-white/10 dark:bg-white/[0.03]">
              <SectionHeader
                eyebrow="Aparência"
                title="Visual do sistema"
                description="Ajuste o visual para deixar o uso mais confortável."
              />
              {renderToggleCards(appearanceCards)}
            </section>

            {renderInstallPanel()}
          </section>
        );

      case 'notifications': {
        return (
          <section className="space-y-4">
            <section className="rounded-[28px] border border-slate-200/80 bg-slate-50/80 p-5 dark:border-white/10 dark:bg-white/[0.03]">
              <SectionHeader
                eyebrow="Notificações"
                title="Alertas e sinais"
                description="Defina como o Lembreto chama sua atenção."
              />
              {renderToggleCards(notificationCards)}
            </section>

            <ActionPanel
              title="Central de notificações"
              description="Abra o histórico completo dos avisos do sistema."
              buttonLabel="Abrir central de notificações"
              onAction={onOpenNotificationsCenter}
              testId="settings-open-notifications-center"
            />
          </section>
        );
      }

      case 'organization':
        return (
          <section className="space-y-4">
            <section className="rounded-[28px] border border-slate-200/80 bg-slate-50/80 p-5 dark:border-white/10 dark:bg-white/[0.03]">
              <SectionHeader
                eyebrow="Organização"
                title="Visibilidade dos lembretes"
                description="Defina como seus lembretes aparecem na agenda."
              />
              {renderToggleCards(organizationCards)}
            </section>

            <section className="rounded-[28px] border border-slate-200/80 bg-slate-50/80 p-5 dark:border-white/10 dark:bg-white/[0.03]">
              <SectionHeader
                eyebrow="Prazos"
                title="Horário padrão sem registro"
                description="Defina hora e minutos para lembretes salvos sem horário."
              />

              <div className="rounded-[26px] border border-slate-200/80 bg-white/90 p-5 dark:border-white/10 dark:bg-white/[0.04]">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                      <Clock3 size={16} />
                      Padrão atual
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                      {`${`${noTimeReminderParts.hours}`.padStart(2, '0')}:${`${noTimeReminderParts.minutes}`.padStart(2, '0')}`}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                      Horas
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={23}
                      step={1}
                      value={noTimeReminderParts.hours}
                      onChange={(event) => updateNoTimeReminderPart('hours', event.target.value)}
                      data-testid="settings-no-time-hours-input"
                      className="field-control"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                      Minutos
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      step={1}
                      value={noTimeReminderParts.minutes}
                      onChange={(event) => updateNoTimeReminderPart('minutes', event.target.value)}
                      data-testid="settings-no-time-minutes-input"
                      className="field-control"
                    />
                  </label>
                </div>
              </div>
            </section>

            <section className="rounded-[28px] border border-slate-200/80 bg-slate-50/80 p-5 dark:border-white/10 dark:bg-white/[0.03]">
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
                      placeholder="Ex.: Saúde, Financeiro..."
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
                      placeholder="Ex.: Reunião, Estudo, Urgente..."
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
          <section className="rounded-[28px] border border-slate-200/80 bg-slate-50/80 p-5 dark:border-white/10 dark:bg-white/[0.03]">
            <SectionHeader
              eyebrow="Segurança"
              title="Proteção de ações"
              description="Reduza o risco de mudanças acidentais e mantenha os lembretes mais protegidos no uso diário."
            />
            {renderToggleCards(safetyCards)}
          </section>
        );

      case 'integrations':
        return (
          <section className="space-y-4">
            <section className="rounded-[28px] border border-blue-100 bg-blue-50/60 p-5 dark:border-blue-500/20 dark:bg-blue-500/10">
              <SectionHeader
                eyebrow="Integrações"
                title="Calendários externos"
                description="Conecte serviços externos, exporte sua agenda e sincronize lembretes com mais controle."
              />
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-blue-100 bg-white/86 px-4 py-3 dark:border-blue-400/20 dark:bg-slate-950/40">
                  <p className="text-xs font-semibold uppercase text-blue-600 dark:text-blue-300">Conexões</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">
                    {calendarIntegrations.filter((item) => item.connected).length}
                  </p>
                </div>
                <div className="rounded-2xl border border-blue-100 bg-white/86 px-4 py-3 dark:border-blue-400/20 dark:bg-slate-950/40">
                  <p className="text-xs font-semibold uppercase text-blue-600 dark:text-blue-300">Envio automático</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">
                    {calendarIntegrations.filter((item) => item.connected && item.syncEnabled).length}
                  </p>
                </div>
                <div className="rounded-2xl border border-blue-100 bg-white/86 px-4 py-3 dark:border-blue-400/20 dark:bg-slate-950/40">
                  <p className="text-xs font-semibold uppercase text-blue-600 dark:text-blue-300">Formatos</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">.ics</p>
                </div>
              </div>
            </section>

            {renderConnectedCalendarsPanel()}

            {renderCalendarSyncPanel()}
          </section>
        );

      case 'account':
        return (
          <section className="space-y-4">
            <ActionPanel
              title="Conta e identidade"
              description="Atualize nome, e-mail, senha e avatar sem sair daqui."
              buttonLabel="Abrir perfil"
              onAction={onOpenProfile}
            />
            {renderHolidayRegionPanel()}
          </section>
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
            className="fixed inset-0 z-[101] mx-auto flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden rounded-none border-0 border-slate-200/80 bg-white/96 shadow-[0_36px_120px_-42px_rgba(15,23,42,0.55)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/94 sm:inset-x-4 sm:bottom-auto sm:top-1/2 sm:h-auto sm:max-h-[88vh] sm:max-w-6xl sm:-translate-y-1/2 sm:rounded-[32px] sm:border"
          >
            {swipe.mobileEnabled && (
              <div
                className="flex justify-center border-b border-slate-200/70 px-4 py-2.5 dark:border-white/10"
                aria-hidden="true"
                {...swipe.bind}
              >
                <span className="h-1.5 w-14 rounded-full bg-slate-300/90 dark:bg-slate-700" />
              </div>
            )}

            <div className="border-b border-slate-200/80 bg-slate-50/80 px-4 py-3.5 dark:border-white/10 dark:bg-white/[0.03] sm:px-6 sm:py-5 md:px-7">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <span className="section-eyebrow">
                    <Settings size={14} />
                    Preferências
                  </span>
                  <h2 id="settings-drawer-title" className="mt-2.5 text-xl font-semibold tracking-tight text-slate-950 dark:text-white sm:mt-4 sm:text-2xl md:text-3xl">
                    Configurações
                  </h2>
                  <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400 sm:mt-2 sm:leading-7">
                    Ajuste notificações, organização, integrações e comportamento do aplicativo.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Fechar configurações"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-500 transition-colors hover:bg-slate-100 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.08] sm:h-11 sm:w-11"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3.5 sm:px-6 sm:py-6 md:px-7">
              <div className="flex min-w-0 flex-col gap-4 sm:gap-6 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)]">
                <aside className="sticky top-0 z-10 h-fit rounded-[22px] border border-slate-200/80 bg-slate-50/95 p-2 backdrop-blur dark:border-white/10 dark:bg-slate-950/95 sm:rounded-[28px] sm:p-3 lg:static lg:bg-slate-50/80 lg:backdrop-blur-none lg:dark:bg-white/[0.03]">
                  <nav className="grid grid-cols-2 gap-2 lg:block lg:space-y-2" aria-label="Seções de configurações">
                    {settingsViews.map((view) => {
                      const Icon = view.icon;
                      const isActive = activeView === view.key;

                      return (
                        <button
                          key={view.key}
                          type="button"
                          onClick={() => setActiveView(view.key)}
                          data-testid={view.key === 'notifications' ? 'settings-nav-center' : `settings-nav-${view.key}`}
                          className={[
                            'flex min-w-0 items-center gap-2 rounded-[18px] border px-2.5 py-2.5 text-left transition-all hover:-translate-y-0.5 sm:gap-3 sm:items-start sm:rounded-[22px] sm:px-4 sm:py-3 lg:w-full',
                            isActive
                              ? 'border-blue-500/30 bg-blue-50 text-blue-700 shadow-[0_20px_40px_-28px_rgba(37,99,235,0.8)] dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300'
                              : 'border-slate-200/80 bg-white/80 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300 dark:hover:border-white/15 dark:hover:bg-white/[0.06]',
                          ].join(' ')}
                          aria-pressed={isActive}
                        >
                          {view.key === 'notifications' && (
                            <span data-testid="settings-nav-notifications" className="sr-only">
                              Notificações
                            </span>
                          )}
                          <span className={[
                            'flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl border sm:mt-0.5 sm:h-10 sm:w-10',
                            isActive
                              ? 'border-blue-500/20 bg-white text-blue-600 dark:border-blue-500/20 dark:bg-slate-950/60 dark:text-blue-300'
                              : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300',
                          ].join(' ')}>
                            <Icon size={17} />
                          </span>

                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-semibold sm:text-sm">{view.title}</span>
                            <span className="mt-1 hidden text-xs leading-5 text-current/75 sm:block">
                              {view.description}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </nav>
                </aside>

                <section className="min-w-0 space-y-4 sm:space-y-5">
                  <div className="hidden rounded-[28px] border border-slate-200/80 bg-white/88 p-5 shadow-[0_18px_60px_-48px_rgba(15,23,42,0.55)] dark:border-white/10 dark:bg-white/[0.04] sm:block">
                    <div className="flex items-start gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-100 bg-blue-50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
                        <activeViewMeta.icon size={20} />
                      </div>
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                          Área ativa
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

            <div className="hidden border-t border-slate-200/80 px-6 py-5 dark:border-white/10 sm:block md:px-7">
              <p className="text-center text-xs text-slate-400 dark:text-slate-500">
                As configurações são salvas neste navegador e aplicadas imediatamente.
              </p>
            </div>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  );
}
