import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BellRing,
  BellOff,
  CalendarDays,
  Clock3,
  Flag,
  Layers3,
  Loader2,
  Repeat,
  Search,
  Sparkles,
  Tag,
  X,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { useSwipeToClose } from '../hooks/useSwipeToClose';
import { getRecurrenceSuggestion, type RecurrenceMode, type RecurrenceSuggestion } from '../lib/taskRecurrence';
import type { Priority, Task, TaskOverdueReminderIntensity } from '../types';

const RECURRENCE_MODE_OPTIONS: Array<{ value: RecurrenceMode; label: string }> = [
  { value: 'daily', label: 'Todos os dias' },
  { value: 'weekdays', label: 'De segunda a sexta' },
  { value: 'weekends', label: 'Apenas fins de semana' },
  { value: 'weekly', label: 'Uma vez por semana' },
];

const RECURRENCE_SUGGESTIONS: Array<{
  key: RecurrenceSuggestion;
  label: string;
  description: string;
}> = [
  {
    key: 'weekdays',
    label: 'De segunda a sexta',
    description: 'Ideal para rotinas de trabalho e estudos.',
  },
  {
    key: 'weekends',
    label: 'Nos fins de semana',
    description: 'Bom para compromissos pessoais e lazer.',
  },
  {
    key: 'month',
    label: 'Todo o mês atual',
    description: 'Preenche os próximos dias até o fim do mês.',
  },
  {
    key: 'weekly',
    label: 'Toda semana',
    description: 'Repete sempre no mesmo dia da semana.',
  },
  {
    key: 'next7Days',
    label: 'Próximos 7 dias',
    description: 'Ideal para um acompanhamento curto.',
  },
];

const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
};

const OVERDUE_INTENSITY_OPTIONS: Array<{
  value: TaskOverdueReminderIntensity;
  label: string;
  description: string;
  policy: string;
}> = [
  {
    value: 'gentle',
    label: 'Suave',
    description: 'Menos interrupções para lembretes de baixa urgência.',
    policy: 'Após atrasar: 30 min, 2h, depois no máximo a cada 6h.',
  },
  {
    value: 'normal',
    label: 'Normal',
    description: 'Equilíbrio entre lembrar e não incomodar.',
    policy: 'Após atrasar: 15 min, 30 min, 45 min, depois espaça gradualmente.',
  },
  {
    value: 'insistent',
    label: 'Insistente',
    description: 'Mais atenção para itens que não podem escapar.',
    policy: 'Após atrasar: 5 min, 15 min, 30 min, 1h, depois espaça gradualmente.',
  },
  {
    value: 'silent',
    label: 'Silencioso',
    description: 'Sem alertas de atraso; aparece apenas no app.',
    policy: 'Após atrasar: não envia novas notificações, apenas marca como atrasado no app.',
  },
];

type TaskDrawerTab = 'details' | 'recurrence' | 'alarm';

interface TaskDrawerProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onSaveDraft: () => void;
  editingTask: Task | null;
  darkMode: boolean;
  isSubmitting?: boolean;
  title: string;
  setTitle: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  date: string;
  setDate: (value: string) => void;
  time: string;
  setTime: (value: string) => void;
  endTime: string;
  setEndTime: (value: string) => void;
  noTimeReminderFallbackTime: string;
  dueDateError?: string;
  endTimeError?: string;
  minimumDate?: string;
  priority: Priority;
  setPriority: (value: Priority) => void;
  category: string;
  setCategory: (value: string) => void;
  categoryOptions: string[];
  tags: string[];
  setTags: (value: string[]) => void;
  tagOptions: string[];
  recurrenceEnabled: boolean;
  setRecurrenceEnabled: (value: boolean) => void;
  recurrenceMode: RecurrenceMode;
  setRecurrenceMode: (value: RecurrenceMode) => void;
  recurrenceUntil: string;
  setRecurrenceUntil: (value: string) => void;
  suppressHolidayNotifications: boolean;
  setSuppressHolidayNotifications: (value: boolean) => void;
  overdueReminderIntensity: TaskOverdueReminderIntensity;
  setOverdueReminderIntensity: (value: TaskOverdueReminderIntensity) => void;
  alarmEnabled: boolean;
  setAlarmEnabled: (value: boolean) => void;
  recurrenceError?: string;
  recurrencePreviewCount?: number;
  holidaySuppressedCount?: number;
  onApplyRecurrenceSuggestion: (suggestion: RecurrenceSuggestion) => void;
}

function normalizeTaxonomyValue(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeSearchValue(value: string) {
  return normalizeTaxonomyValue(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
      {children}
    </label>
  );
}

function SectionHeader({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span className="icon-slot h-10 w-10 rounded-2xl bg-blue-600/10 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
        {icon}
      </span>
      <div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
      </div>
    </div>
  );
}

function SummaryPill({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/15 bg-white/10 px-2.5 py-2 text-white/90 backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.04] sm:px-4 sm:py-3">
      <div className="flex min-w-0 items-center gap-1 text-[9px] font-bold uppercase tracking-[0.08em] text-white/60 sm:gap-2 sm:text-[11px] sm:tracking-[0.16em]">
        <span className="icon-slot h-3.5 w-3.5 sm:h-4 sm:w-4">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <p className="mt-1 truncate text-[12px] font-semibold text-white dark:text-slate-100 sm:mt-2 sm:text-sm">{value}</p>
    </div>
  );
}

function DrawerTabButton({
  active,
  icon,
  label,
  testId,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  testId: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-2xl px-2 text-xs font-semibold transition-all sm:gap-2 sm:px-4 sm:text-sm',
        active
          ? 'bg-gradient-to-r from-blue-600 to-sky-500 text-white shadow-[0_12px_24px_-18px_rgba(37,99,235,0.7)]'
          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.08]',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function SuggestionCard({
  active,
  label,
  description,
  testId,
  onClick,
}: {
  key?: React.Key;
  active: boolean;
  label: string;
  description: string;
  testId: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'group flex min-h-[108px] flex-col items-start justify-between rounded-[24px] border px-4 py-4 text-left transition-all',
        active
          ? 'border-blue-400/70 bg-gradient-to-br from-blue-600 to-sky-500 text-white shadow-[0_18px_34px_-22px_rgba(37,99,235,0.8)]'
          : 'border-slate-200 bg-slate-50/90 text-slate-700 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:border-white/20 dark:hover:bg-white/[0.07]',
      )}
    >
      <span
        className={cn(
          'icon-slot h-9 w-9 rounded-2xl border',
          active
            ? 'border-white/20 bg-white/12 text-white'
            : 'border-slate-200 bg-white text-blue-600 dark:border-white/10 dark:bg-slate-950/60 dark:text-blue-300',
        )}
      >
        <Sparkles size={16} />
      </span>

      <div className="mt-4">
        <p className={cn('text-sm font-semibold', active ? 'text-white' : 'text-slate-900 dark:text-white')}>
          {label}
        </p>
        <p className={cn('mt-1 text-sm leading-6', active ? 'text-blue-50/90' : 'text-slate-500 dark:text-slate-400')}>
          {description}
        </p>
      </div>
    </button>
  );
}

export function TaskDrawer({
  open,
  onClose,
  onSubmit,
  onSaveDraft,
  editingTask,
  darkMode,
  isSubmitting = false,
  title,
  setTitle,
  description,
  setDescription,
  date,
  setDate,
  time,
  setTime,
  endTime,
  setEndTime,
  noTimeReminderFallbackTime,
  dueDateError = '',
  endTimeError = '',
  minimumDate,
  priority,
  setPriority,
  category,
  setCategory,
  categoryOptions,
  tags,
  setTags,
  tagOptions,
  recurrenceEnabled,
  setRecurrenceEnabled,
  recurrenceMode,
  setRecurrenceMode,
  recurrenceUntil,
  setRecurrenceUntil,
  suppressHolidayNotifications,
  setSuppressHolidayNotifications,
  overdueReminderIntensity,
  setOverdueReminderIntensity,
  alarmEnabled,
  setAlarmEnabled,
  recurrenceError = '',
  recurrencePreviewCount = 0,
  holidaySuppressedCount = 0,
  onApplyRecurrenceSuggestion,
}: TaskDrawerProps) {
  const isEditing = Boolean(editingTask);
  const isEditingDraft = editingTask?.status === 'draft';
  const [activeTab, setActiveTab] = React.useState<TaskDrawerTab>('details');
  const [categorySearch, setCategorySearch] = React.useState('');
  const [tagDraft, setTagDraft] = React.useState('');
  const [tagFeedback, setTagFeedback] = React.useState('');
  const swipe = useSwipeToClose({
    enabled: open,
    direction: 'down',
    onClose,
    locked: isSubmitting,
  });

  React.useEffect(() => {
    if (open) {
      setActiveTab('details');
      setCategorySearch('');
      setTagDraft('');
      setTagFeedback('');
    }
  }, [editingTask, open]);

  React.useEffect(() => {
    if (alarmEnabled && (!date || !time)) {
      setAlarmEnabled(false);
    }
  }, [alarmEnabled, date, setAlarmEnabled, time]);

  const titleCount = title.trim().length;
  const hasStart = Boolean(date && time);
  const summaryDue = hasStart ? date : 'Sem início';
  const summaryTime = endTime
    ? `${time} - ${endTime}`
    : hasStart ? time : 'Sem início';
  const summaryPriority = PRIORITY_LABELS[priority];
  const availableTagSuggestions = React.useMemo(
    () => tagOptions.filter((item) => (
      !tags.some((tag) => normalizeSearchValue(tag) === normalizeSearchValue(item))
    )),
    [tagOptions, tags],
  );
  const filteredCategoryOptions = React.useMemo(() => {
    const normalizedSearch = normalizeSearchValue(categorySearch);
    if (!normalizedSearch) return categoryOptions;

    const filteredOptions = categoryOptions.filter((item) =>
      normalizeSearchValue(item).includes(normalizedSearch),
    );

    return filteredOptions.includes(category)
      ? filteredOptions
      : [category, ...filteredOptions].filter(Boolean);
  }, [category, categoryOptions, categorySearch]);

  const handleCategorySearchChange = React.useCallback((value: string) => {
    setCategorySearch(value);

    const normalizedValue = normalizeSearchValue(value);
    const exactMatch = categoryOptions.find((item) =>
      normalizeSearchValue(item) === normalizedValue,
    );

    if (exactMatch) {
      setCategory(exactMatch);
    }
  }, [categoryOptions, setCategory]);

  const isSuggestionActive = React.useCallback(
    (suggestionKey: RecurrenceSuggestion) => {
      if (!date || !recurrenceEnabled) return false;
      const suggestion = getRecurrenceSuggestion(date, suggestionKey);
      if (!suggestion) return false;
      return suggestion.mode === recurrenceMode && suggestion.until === recurrenceUntil;
    },
    [date, recurrenceEnabled, recurrenceMode, recurrenceUntil],
  );

  const addTag = React.useCallback(
    (value: string) => {
      const normalized = normalizeTaxonomyValue(value);
      if (!normalized) return;

      const tagKey = normalizeSearchValue(normalized);
      if (tags.some((item) => normalizeSearchValue(item) === tagKey)) return;

      const registeredTag = tagOptions.find((item) => normalizeSearchValue(item) === tagKey);
      setTags([...tags, registeredTag ?? normalized]);
      setTagDraft('');
      setTagFeedback('');
    },
    [setTags, tagOptions, tags],
  );

  const handleAddExistingTag = React.useCallback(() => {
    const normalized = normalizeTaxonomyValue(tagDraft);
    if (!normalized) return;

    addTag(normalized);
  }, [addTag, tagDraft]);

  const removeTag = React.useCallback(
    (value: string) => {
      setTags(tags.filter((item) => item !== value));
      setTagFeedback('');
    },
    [setTags, tags],
  );

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              if (!isSubmitting) onClose();
            }}
            className="fixed inset-0 z-[100] bg-slate-900/55 backdrop-blur-sm dark:bg-black/72"
          />

          <div className="fixed inset-0 z-[101] flex items-end justify-center p-0 sm:items-center sm:p-5">
            <motion.div
              data-testid="task-drawer"
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: swipe.offset, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.98 }}
              transition={swipe.isDragging ? { duration: 0 } : { type: 'spring', damping: 28, stiffness: 260 }}
              className="flex h-[100dvh] max-h-[100dvh] w-full max-w-4xl flex-col overflow-hidden rounded-none border-0 border-slate-200/80 bg-white/96 shadow-[0_30px_120px_-34px_rgba(15,23,42,0.55)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/94 sm:h-auto sm:max-h-[calc(100vh-2.5rem)] sm:rounded-[34px] sm:border"
              role="dialog"
              aria-modal="true"
              aria-labelledby="task-drawer-title"
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

              <div className="border-b border-slate-200/80 bg-gradient-to-br from-blue-700 via-blue-600 to-sky-500 px-3.5 py-2.5 text-white dark:border-white/10 sm:px-5 sm:py-5 md:px-7">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 max-w-3xl">
                    <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white/80 backdrop-blur-sm sm:text-[11px] sm:tracking-[0.18em]">
                      {isEditing ? 'Atualização' : 'Planejamento'}
                    </span>
                    <h2 id="task-drawer-title" className="mt-2 text-xl font-semibold leading-tight text-white sm:mt-4 sm:text-2xl md:text-[2rem]">
                      {isEditing ? 'Editar lembrete' : 'Novo lembrete'}
                    </h2>
                    <p className="mt-1 hidden max-w-2xl text-[12px] leading-5 text-blue-50/88 sm:mt-2 sm:block sm:text-sm sm:leading-6">
                      Organize o essencial do lembrete em um só lugar.
                    </p>
                  </div>

                  <button
                    onClick={onClose}
                    disabled={isSubmitting}
                    aria-label="Fechar formulário de lembrete"
                    className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-white/90 transition-colors hover:bg-white/16 disabled:cursor-not-allowed disabled:opacity-50 sm:h-11 sm:w-11"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="mt-3 grid min-w-0 grid-cols-3 gap-1.5 sm:mt-5 sm:gap-3">
                  <SummaryPill label="Prazo" value={summaryDue} icon={<CalendarDays size={14} />} />
                  <SummaryPill label="Horário" value={summaryTime} icon={<Clock3 size={14} />} />
                  <SummaryPill label="Prioridade" value={summaryPriority} icon={<Flag size={14} />} />
                </div>
              </div>

              <div className="border-b border-slate-200/80 bg-white/80 px-3.5 py-2.5 dark:border-white/10 dark:bg-slate-950/86 sm:px-5 sm:py-4 md:px-7">
                <div className="grid grid-cols-3 gap-1.5 sm:flex sm:flex-wrap sm:gap-2">
                  <DrawerTabButton
                    active={activeTab === 'details'}
                    icon={<Layers3 size={16} />}
                    label="Detalhes"
                    testId="task-tab-details"
                    onClick={() => setActiveTab('details')}
                  />
                  {!isEditing && (
                    <DrawerTabButton
                      active={activeTab === 'recurrence'}
                      icon={<Repeat size={16} />}
                      label="Repetição"
                      testId="task-tab-recurrence"
                      onClick={() => setActiveTab('recurrence')}
                    />
                  )}
                  <DrawerTabButton
                    active={activeTab === 'alarm'}
                    icon={<BellRing size={16} />}
                    label="Alarme"
                    testId="task-tab-alarm"
                    onClick={() => setActiveTab('alarm')}
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto overscroll-contain px-3.5 py-3 sm:px-5 sm:py-5 md:px-7 md:py-6">
                <form id="task-form" onSubmit={onSubmit} className="space-y-4 sm:space-y-6" aria-busy={isSubmitting}>
                  {activeTab === 'details' && (
                    <>
                      <section className="surface-soft p-3.5 sm:p-5">
                        <SectionHeader
                          title="Informações principais"
                          description="Defina o que precisa ser lembrado."
                          icon={<Sparkles size={18} />}
                        />

                        <div className="space-y-4">
                          <div>
                            <div className="mb-2 flex items-center justify-between gap-3">
                              <FieldLabel>Título</FieldLabel>
                              <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
                                {titleCount}/80
                              </span>
                            </div>
                            <input
                              autoFocus
                              required
                              maxLength={80}
                              type="text"
                              data-testid="task-title-input"
                              placeholder="Ex.: Preparar relatório mensal"
                              value={title}
                              disabled={isSubmitting}
                              onChange={(event) => setTitle(event.target.value)}
                              className="field-control"
                            />
                          </div>

                          <div>
                            <FieldLabel>Detalhes</FieldLabel>
                            <textarea
                              placeholder="Inclua contexto, próximos passos ou links úteis."
                              data-testid="task-description-input"
                              value={description}
                              disabled={isSubmitting}
                              onChange={(event) => setDescription(event.target.value)}
                              className="field-control min-h-[88px] resize-none sm:min-h-[150px]"
                            />
                          </div>
                        </div>
                      </section>

                      <section className="surface-soft p-3.5 sm:p-5">
                        <SectionHeader
                          title="Prazo"
                          description="Defina quando o lembrete começa, termina ou fica sem horário fixo."
                          icon={<CalendarDays size={18} />}
                        />

                        <div className="space-y-4">
                          <div>
                            <FieldLabel>Prazo</FieldLabel>
                            <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_220px]">
                              <div className="relative self-start">
                                <CalendarDays className="field-icon" size={18} />
                                <input
                                  type="date"
                                  data-testid="task-date-input"
                                  required
                                  min={minimumDate}
                                  value={date}
                                  disabled={isSubmitting}
                                  onChange={(event) => setDate(event.target.value)}
                                  aria-invalid={dueDateError ? 'true' : 'false'}
                                  style={{ colorScheme: darkMode ? 'dark' : 'light' }}
                                  className={cn(
                                    'field-control field-control-with-icon',
                                    dueDateError &&
                                      'border-rose-300 bg-rose-50/70 text-rose-700 focus:border-rose-400 focus:ring-rose-500/10 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200 dark:focus:border-rose-400',
                                  )}
                                />
                              </div>

                              <div className="space-y-3">
                                <label className="space-y-2">
                                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                                    Horário inicial
                                  </span>
                                  <div className="relative">
                                    <Clock3 className="field-icon" size={18} />
                                    <input
                                      type="time"
                                      step={60}
                                      inputMode="numeric"
                                      data-testid="task-time-input"
                                      value={time}
                                      disabled={isSubmitting}
                                      onChange={(event) => setTime(event.target.value)}
                                      className="field-control field-control-with-icon"
                                    />
                                  </div>
                                </label>

                                <label className="space-y-2">
                                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                                    Horário final
                                  </span>
                                  <div className="relative">
                                    <Clock3 className="field-icon" size={18} />
                                    <input
                                      type="time"
                                      step={60}
                                      inputMode="numeric"
                                      data-testid="task-end-time-input"
                                      value={endTime}
                                      disabled={isSubmitting}
                                      onChange={(event) => setEndTime(event.target.value)}
                                      aria-invalid={endTimeError ? 'true' : 'false'}
                                      className={cn(
                                        'field-control field-control-with-icon',
                                        endTimeError &&
                                          'border-rose-300 bg-rose-50/70 text-rose-700 focus:border-rose-400 focus:ring-rose-500/10 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200 dark:focus:border-rose-400',
                                      )}
                                    />
                                  </div>
                                </label>

                                <div className="grid gap-2 sm:grid-cols-2">
                                  <button
                                    type="button"
                                    data-testid="task-time-clear"
                                    disabled={isSubmitting || (!date && !time)}
                                    onClick={() => {
                                      setDate('');
                                      setTime('');
                                      setEndTime('');
                                    }}
                                    className="action-ghost h-10 w-full justify-center rounded-xl border border-slate-200/70 px-3 py-0 text-sm disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10"
                                  >
                                    Sem início
                                  </button>
                                  <button
                                    type="button"
                                    data-testid="task-end-time-clear"
                                    disabled={isSubmitting || !endTime}
                                    onClick={() => setEndTime('')}
                                    className="action-ghost h-10 w-full justify-center rounded-xl border border-slate-200/70 px-3 py-0 text-sm disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10"
                                  >
                                    Sem final
                                  </button>
                                </div>
                              </div>
                            </div>

                            <p
                              className={cn(
                                'mt-2 text-sm',
                                dueDateError || endTimeError ? 'text-rose-600 dark:text-rose-300' : 'text-slate-500 dark:text-slate-400',
                              )}
                              data-testid="task-date-help"
                            >
                              {dueDateError || endTimeError || `Sem horário inicial, o lembrete fica sem início e usa o intervalo das configurações: ${noTimeReminderFallbackTime}.`}
                            </p>
                          </div>
                        </div>
                      </section>

                      <section className="surface-soft p-3.5 sm:p-5">
                        <SectionHeader
                          title="Organização"
                          description="Classifique o lembrete para encontrar e priorizar mais rápido."
                          icon={<Flag size={18} />}
                        />

                        <div className="space-y-5">
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                              <FieldLabel>Prioridade</FieldLabel>
                              <select
                                value={priority}
                                disabled={isSubmitting}
                                data-testid="task-priority-select"
                                onChange={(event) => setPriority(event.target.value as Priority)}
                                className="field-control cursor-pointer"
                              >
                                <option value="low">Baixa</option>
                                <option value="medium">Média</option>
                                <option value="high">Alta</option>
                              </select>
                            </div>

                            <div>
                              <FieldLabel>Categoria</FieldLabel>
                              <div className="space-y-2">
                                <div className="relative">
                                  <Search className="field-icon" size={18} />
                                  <input
                                    type="text"
                                    value={categorySearch}
                                    list="task-category-options"
                                    disabled={isSubmitting}
                                    onChange={(event) => handleCategorySearchChange(event.target.value)}
                                    placeholder="Buscar categoria"
                                    data-testid="task-category-search-input"
                                    className="field-control field-control-with-icon"
                                  />
                                  <datalist id="task-category-options">
                                    {categoryOptions.map((item) => (
                                      <option key={item} value={item} />
                                    ))}
                                  </datalist>
                                </div>

                                <select
                                  value={category}
                                  disabled={isSubmitting}
                                  data-testid="task-category-select"
                                  onChange={(event) => {
                                    setCategory(event.target.value);
                                    setCategorySearch('');
                                  }}
                                  className="field-control cursor-pointer"
                                >
                                  {filteredCategoryOptions.map((item) => (
                                    <option key={item} value={item}>
                                      {item}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          </div>

                          <div>
                            <FieldLabel>Tags</FieldLabel>
                            <div className="flex flex-col gap-2 sm:flex-row">
                              <input
                                type="text"
                                value={tagDraft}
                                list="task-tag-options"
                                disabled={isSubmitting}
                                onChange={(event) => setTagDraft(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault();
                                    handleAddExistingTag();
                                  }
                                }}
                                placeholder={tagOptions.length > 0 ? 'Buscar ou criar tag' : 'Criar primeira tag'}
                                data-testid="task-tag-input"
                                className="field-control"
                              />
                              <datalist id="task-tag-options">
                                {tagOptions.map((item) => (
                                  <option key={item} value={item} />
                                ))}
                              </datalist>
                              <button
                                type="button"
                                data-testid="task-tag-add-button"
                                onClick={handleAddExistingTag}
                                disabled={isSubmitting || !normalizeTaxonomyValue(tagDraft)}
                                className="action-secondary justify-center rounded-xl px-4 py-3 disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-[120px] sm:py-0"
                              >
                                Adicionar
                              </button>
                            </div>

                            {availableTagSuggestions.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {availableTagSuggestions.slice(0, 8).map((item) => (
                                  <button
                                    key={item}
                                    type="button"
                                    data-testid={`task-tag-suggestion-${item.toLowerCase().replace(/\s+/g, '-')}`}
                                    disabled={isSubmitting}
                                    onClick={() => addTag(item)}
                                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08]"
                                  >
                                    <Tag size={12} />
                                    {item}
                                  </button>
                                ))}
                              </div>
                            )}

                            <div className="mt-3 flex min-h-[44px] flex-wrap gap-2">
                              {tags.length > 0 ? (
                                tags.map((item) => (
                                  <span
                                    key={item}
                                    data-testid="task-tag-chip"
                                    className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300"
                                  >
                                    <Tag size={12} />
                                    {item}
                                    <button
                                      type="button"
                                      onClick={() => removeTag(item)}
                                      disabled={isSubmitting}
                                      aria-label={`Remover tag ${item}`}
                                      className="text-blue-500 transition-colors hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-blue-300 dark:hover:text-blue-100"
                                    >
                                      <X size={12} />
                                    </button>
                                  </span>
                                ))
                              ) : (
                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                  Use tags já cadastradas para marcar o tipo do lembrete e encontrar itens com mais rapidez.
                                </p>
                              )}
                            </div>

                            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                              Tags novas adicionadas aqui ficam disponíveis para os próximos lembretes.
                            </p>

                            {tagFeedback && (
                              <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                                {tagFeedback}
                              </p>
                            )}
                          </div>
                        </div>
                      </section>
                    </>
                  )}

                  {!isEditing && activeTab === 'recurrence' && (
                    <section className="space-y-4">
                      <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_18px_50px_-34px_rgba(15,23,42,0.38)] dark:border-white/10 dark:bg-white/[0.04]">
                        <div className="border-b border-slate-200/80 bg-slate-50/80 p-5 text-slate-950 dark:border-white/10 dark:bg-white/[0.03] dark:text-white sm:p-6">
                          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                            <div className="max-w-xl">
                              <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300">
                                <Repeat size={13} />
                                Repetição
                              </span>
                              <h3 className="mt-4 text-2xl font-semibold tracking-tight">Crie uma sequência sem repetir trabalho.</h3>
                              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                                Ative, escolha um modelo e ajuste a data final. O Lembreto mostra quantos itens serão criados antes do envio.
                              </p>
                            </div>

                            <label className="inline-flex min-h-[46px] w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-100 sm:w-[170px]">
                              <span>{recurrenceEnabled ? 'Ativada' : 'Desativada'}</span>
                              <input
                                type="checkbox"
                                data-testid="task-recurrence-toggle"
                                checked={recurrenceEnabled}
                                disabled={isSubmitting}
                                onChange={(event) => setRecurrenceEnabled(event.target.checked)}
                                className="h-5 w-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500/30 dark:border-white/30 dark:bg-white/10"
                              />
                            </label>
                          </div>
                        </div>

                        {!recurrenceEnabled ? (
                          <div className="p-5 sm:p-6">
                            <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/80 p-5 text-sm leading-6 text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
                              A repetição está desligada. Ative para transformar este lembrete em uma rotina diária, semanal ou por período.
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-5 p-5 sm:p-6">
                            <div>
                              <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                                Modelos inteligentes
                              </p>
                              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                {RECURRENCE_SUGGESTIONS.map((suggestion) => (
                                  <SuggestionCard
                                    key={suggestion.key}
                                    testId={`task-recurrence-suggestion-${suggestion.key}`}
                                    label={suggestion.label}
                                    description={suggestion.description}
                                    active={isSuggestionActive(suggestion.key)}
                                    onClick={() => onApplyRecurrenceSuggestion(suggestion.key)}
                                  />
                                ))}
                              </div>
                            </div>

                            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(260px,0.9fr)]">
                              <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                                <div className="mb-4 flex items-center gap-3">
                                  <span className="icon-slot h-10 w-10 rounded-2xl bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
                                    <CalendarDays size={18} />
                                  </span>
                                  <div>
                                    <p className="text-sm font-semibold text-slate-900 dark:text-white">Regra da repetição</p>
                                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Ajuste manualmente quando precisar.</p>
                                  </div>
                                </div>

                                <div className="grid gap-4 sm:grid-cols-2">
                                  <div>
                                    <FieldLabel>Como repetir</FieldLabel>
                                    <select
                                      value={recurrenceMode}
                                      disabled={isSubmitting}
                                      data-testid="task-recurrence-mode"
                                      onChange={(event) => setRecurrenceMode(event.target.value as RecurrenceMode)}
                                      className="field-control cursor-pointer"
                                    >
                                      {RECURRENCE_MODE_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </div>

                                  <div>
                                    <FieldLabel>Repetir até</FieldLabel>
                                    <input
                                      type="date"
                                      min={date || minimumDate}
                                      value={recurrenceUntil}
                                      disabled={isSubmitting}
                                      data-testid="task-recurrence-until"
                                      onChange={(event) => setRecurrenceUntil(event.target.value)}
                                      style={{ colorScheme: darkMode ? 'dark' : 'light' }}
                                      className={cn(
                                        'field-control',
                                        recurrenceError &&
                                          'border-rose-300 bg-rose-50/70 text-rose-700 focus:border-rose-400 focus:ring-rose-500/10 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200 dark:focus:border-rose-400',
                                      )}
                                    />
                                  </div>
                                </div>
                              </div>

                              <div className="rounded-[24px] border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.04]">
                                <div className="flex items-start gap-3">
                                  <span className="icon-slot h-10 w-10 rounded-2xl bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                                    <Repeat size={18} />
                                  </span>
                                  <div>
                                    <p
                                      data-testid="task-recurrence-count"
                                      className="text-sm font-semibold text-slate-900 dark:text-white"
                                    >
                                      {recurrencePreviewCount > 0
                                        ? recurrencePreviewCount === 1
                                          ? '1 lembrete será criado'
                                          : `${recurrencePreviewCount} lembretes serão criados`
                                        : 'Defina o intervalo para gerar seus lembretes'}
                                    </p>
                                    <p
                                      data-testid="task-recurrence-help"
                                      className={cn(
                                        'mt-1 text-sm leading-6',
                                        recurrenceError ? 'text-rose-600 dark:text-rose-300' : 'text-slate-500 dark:text-slate-400',
                                      )}
                                    >
                                      {recurrenceError || 'A prévia muda automaticamente conforme a regra escolhida.'}
                                    </p>
                                  </div>
                                </div>

                                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-500/20 dark:bg-amber-500/10">
                                  <label className="flex items-start gap-3">
                                    <input
                                      type="checkbox"
                                      data-testid="task-holiday-notification-toggle"
                                      checked={suppressHolidayNotifications}
                                      disabled={isSubmitting}
                                      onChange={(event) => setSuppressHolidayNotifications(event.target.checked)}
                                      className="mt-0.5 h-5 w-5 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                                    />
                                    <span>
                                      <span className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-100">
                                        <BellOff size={15} />
                                        Silenciar feriados
                                      </span>
                                      <span className="mt-1 block text-xs leading-5 text-amber-800/80 dark:text-amber-100/75">
                                        Mantém o lembrete na agenda, mas evita alertas em feriados da sua região.
                                      </span>
                                    </span>
                                  </label>
                                </div>

                                {suppressHolidayNotifications && recurrencePreviewCount > 0 && (
                                  <p
                                    data-testid="task-holiday-suppression-preview"
                                    className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400"
                                  >
                                    {holidaySuppressedCount > 0
                                      ? `${holidaySuppressedCount} ocorrência${holidaySuppressedCount === 1 ? '' : 's'} cairá${holidaySuppressedCount === 1 ? '' : 'o'} em feriado e não enviará alertas.`
                                      : 'Nenhuma ocorrência desta repetição cai em feriado na sua região atual.'}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </section>
                  )}

                  {activeTab === 'alarm' && (
                    <section className="space-y-4">
                      <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_18px_50px_-34px_rgba(15,23,42,0.38)] dark:border-white/10 dark:bg-white/[0.04]">
                        <div className={cn(
                          'p-5 text-white sm:p-6',
                          alarmEnabled ? 'bg-gradient-to-br from-rose-600 via-orange-500 to-amber-400' : 'bg-gradient-to-br from-slate-800 via-slate-700 to-slate-600',
                        )}>
                          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                            <div className="max-w-xl">
                              <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/12 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-white/80">
                                <BellRing size={13} />
                                Alarme sonoro
                              </span>
                              <h3 className="mt-4 text-2xl font-semibold tracking-tight">
                                {alarmEnabled ? 'Alarme ligado para este lembrete.' : 'Somente notificação, sem toque.'}
                              </h3>
                              <p className="mt-2 text-sm leading-6 text-white/85">
                                O alarme toca por 2 minutos no horário inicial e ajuda a destacar compromissos que não podem passar batido.
                              </p>
                            </div>

                            <label className="inline-flex min-h-[46px] w-full items-center justify-between gap-3 rounded-2xl border border-white/20 bg-white/12 px-3 py-2 text-sm font-semibold text-white backdrop-blur-sm sm:w-[170px]">
                              <span>{alarmEnabled ? 'Ligado' : 'Desligado'}</span>
                              <input
                                type="checkbox"
                                data-testid="task-alarm-toggle"
                                checked={alarmEnabled}
                                disabled={isSubmitting || !date || !time}
                                onChange={(event) => setAlarmEnabled(event.target.checked)}
                                className="h-5 w-5 rounded border-white/40 bg-white/20 text-rose-600 focus:ring-white/40 disabled:cursor-not-allowed disabled:opacity-50"
                              />
                            </label>
                          </div>
                        </div>

                        <div className="grid gap-4 p-5 sm:p-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
                          <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                            <p className="text-sm font-semibold text-slate-900 dark:text-white">Status do alarme</p>
                            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                              {date && time
                                ? alarmEnabled
                                  ? `Pronto para tocar no horário inicial: ${time}.`
                                  : 'Alarme desativado. O lembrete segue com notificação padrão.'
                                : 'Defina prazo e horário inicial na aba Detalhes para liberar o alarme.'}
                            </p>

                            <div className="mt-4 grid gap-2">
                              <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 dark:border-white/10 dark:bg-white/[0.04]">
                                <span className="icon-slot h-9 w-9 rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
                                  <Clock3 size={16} />
                                </span>
                                <div>
                                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Aviso</p>
                                  <p className="text-sm font-semibold text-slate-900 dark:text-white">15 minutos antes</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 dark:border-white/10 dark:bg-white/[0.04]">
                                <span className="icon-slot h-9 w-9 rounded-xl bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
                                  <BellRing size={16} />
                                </span>
                                <div>
                                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">Toque</p>
                                  <p className="text-sm font-semibold text-slate-900 dark:text-white">2 minutos no início</p>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="rounded-[24px] border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.04]">
                            <div className="mb-4 flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-slate-900 dark:text-white">Avisos de atraso</p>
                                <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                                  Escolha o tom dos lembretes quando o prazo passar.
                                </p>
                              </div>
                              <span className="icon-slot h-10 w-10 rounded-2xl bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
                                <BellRing size={18} />
                              </span>
                            </div>

                            <div className="grid gap-2 sm:grid-cols-2">
                              {OVERDUE_INTENSITY_OPTIONS.map((option) => (
                                <button
                                  key={option.value}
                                  type="button"
                                  disabled={isSubmitting}
                                  onClick={() => setOverdueReminderIntensity(option.value)}
                                  aria-pressed={overdueReminderIntensity === option.value}
                                  className={cn(
                                    'rounded-2xl border p-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60',
                                    overdueReminderIntensity === option.value
                                      ? 'border-blue-400 bg-blue-50 dark:border-blue-400/50 dark:bg-blue-500/10'
                                      : 'border-slate-200 bg-slate-50/80 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.06]',
                                  )}
                                >
                                  <span className="text-sm font-semibold text-slate-900 dark:text-white">{option.label}</span>
                                  <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">{option.description}</span>
                                </button>
                              ))}
                            </div>

                            <select
                              value={overdueReminderIntensity}
                              disabled={isSubmitting}
                              data-testid="task-overdue-intensity"
                              onChange={(event) => setOverdueReminderIntensity(event.target.value as TaskOverdueReminderIntensity)}
                              className="sr-only"
                              aria-label="Intensidade dos avisos de atraso"
                            >
                              {OVERDUE_INTENSITY_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    </section>
                  )}
                </form>
              </div>

              <div className="border-t border-slate-200/80 bg-white/88 px-3.5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] dark:border-white/10 dark:bg-slate-950/92 sm:px-5 sm:py-4 md:px-7">
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={isSubmitting}
                    className="action-ghost justify-center rounded-2xl border border-slate-200/80 px-3 py-3 text-sm dark:border-white/10 sm:min-w-[140px] sm:px-4"
                  >
                    Cancelar
                  </button>

                  <div className="contents sm:flex sm:justify-end sm:gap-3">
                    {(!isEditing || isEditingDraft) && (
                      <button
                        type="button"
                        data-testid="task-save-draft-button"
                        onClick={onSaveDraft}
                        disabled={isSubmitting || !title.trim()}
                        className="action-secondary w-full justify-center rounded-2xl px-3 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60 sm:min-w-[180px] sm:w-auto sm:px-5 sm:py-4 sm:text-base"
                      >
                        {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : null}
                        Salvar rascunho
                      </button>
                    )}

                    <button
                      form="task-form"
                      type="submit"
                      data-testid="task-submit-button"
                      disabled={isSubmitting || Boolean(dueDateError) || Boolean(endTimeError) || Boolean(recurrenceError)}
                      className="action-primary col-span-2 w-full justify-center rounded-2xl px-3 py-3.5 text-sm disabled:cursor-wait disabled:opacity-70 sm:min-w-[220px] sm:w-auto sm:px-5 sm:py-4 sm:text-base"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 size={18} className="animate-spin" />
                          {isEditing ? 'Salvando alterações...' : 'Criando lembrete...'}
                        </>
                      ) : isEditingDraft ? (
                        'Adicionar lembrete'
                      ) : isEditing ? (
                        'Salvar alterações'
                      ) : recurrenceEnabled && recurrencePreviewCount > 1 ? (
                        `Criar ${recurrencePreviewCount} lembretes`
                      ) : (
                        'Adicionar lembrete'
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

