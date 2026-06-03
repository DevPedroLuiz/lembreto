import React from 'react';
import {
  AlarmClock,
  BriefcaseBusiness,
  Calculator,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Coffee,
  FastForward,
  Focus,
  Hourglass,
  Link2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Timer,
  Trash2,
  Wrench,
} from 'lucide-react';
import { addDays, format, isWeekend, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { motion } from 'motion/react';
import { buildDueDateFromForm, formatDateInputValue, getTaskTimeLabel } from '../lib/taskDueDate';
import { getDerivedTaskStatus } from '../lib/taskStatus';
import type { TaskCreatePayload } from '../lib/offlineTasks';
import type { HolidayEntry, Note, Task } from '../types';

type PomodoroMode = 'focus' | 'shortBreak' | 'longBreak';
type ToolTab = 'pomodoro' | 'stopwatch' | 'timer' | 'focus' | 'checklist' | 'deadline' | 'routine';

type SessionLog = {
  id: string;
  taskId: string | null;
  tool: 'Pomodoro' | 'Cronometro' | 'Foco';
  minutes: number;
  createdAt: string;
  description: string;
};

type ChecklistItem = {
  id: string;
  text: string;
  done: boolean;
};

type RoutineItem = {
  id: string;
  title: string;
  time: string;
  category: string;
  priority: 'low' | 'medium' | 'high';
};

interface ToolsPageProps {
  tasks: Task[];
  notes: Note[];
  categories: string[];
  holidayEntries: HolidayEntry[];
  onCreateTask: (payload: TaskCreatePayload) => Promise<Task>;
  onCreateNote: (payload: {
    title: string;
    content: string;
    priority: 'low' | 'medium' | 'high';
    category: string;
    tags: string[];
    mode: 'fixed' | 'temporary';
    expiresAt: string | null;
    taskId: string | null;
  }) => Promise<Note>;
  onOpenTask: (task: Task) => void;
}

const POMODORO_SECONDS: Record<PomodoroMode, number> = {
  focus: 25 * 60,
  shortBreak: 5 * 60,
  longBreak: 15 * 60,
};

const POMODORO_LABELS: Record<PomodoroMode, string> = {
  focus: 'Foco',
  shortBreak: 'Pausa curta',
  longBreak: 'Pausa longa',
};

const STORAGE_SESSIONS_KEY = 'lembreto.tools.sessions.v1';
const STORAGE_CHECKLISTS_KEY = 'lembreto.tools.checklists.v1';
const STORAGE_ROUTINE_KEY = 'lembreto.tools.routine.v1';
const UNLINKED_CHECKLIST_KEY = '__unlinked__';

function createLocalId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Local tool state is a convenience layer; the main reminder data stays authoritative.
  }
}

function formatSeconds(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes <= 0) return `${remainder}s`;
  if (remainder === 0) return `${minutes}min`;
  return `${minutes}min ${remainder}s`;
}

function formatTaskLabel(task: Task) {
  const timeLabel = getTaskTimeLabel(task.dueDate);
  return timeLabel ? `${task.title} - ${timeLabel}` : task.title;
}

function normalizeDateInput(date: Date) {
  return formatDateInputValue(date);
}

function buildTaskPayload(input: {
  title: string;
  description: string;
  date: string;
  time?: string;
  category: string;
  priority: 'low' | 'medium' | 'high';
}): TaskCreatePayload {
  return {
    title: input.title,
    description: input.description,
    dueDate: input.time ? buildDueDateFromForm(input.date, input.time) : new Date(`${input.date}T09:00:00`).toISOString(),
    endDate: null,
    priority: input.priority,
    category: input.category,
    tags: ['Ferramentas'],
    suppressHolidayNotifications: false,
    overdueReminderIntensity: 'normal',
    alarmEnabled: false,
    status: 'pending',
  };
}

function getNextBusinessDate(startDate: string, businessDays: number, holidays: Set<string>) {
  const parsed = startDate ? new Date(`${startDate}T12:00:00`) : new Date();
  let cursor = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  let remaining = Math.max(0, businessDays);

  while (remaining > 0) {
    cursor = addDays(cursor, 1);
    const key = normalizeDateInput(cursor);
    if (!isWeekend(cursor) && !holidays.has(key)) {
      remaining -= 1;
    }
  }

  return cursor;
}

function sortActionableTasks(tasks: Task[]) {
  return [...tasks]
    .filter((task) => {
      const status = getDerivedTaskStatus(task);
      return status === 'pending' || status === 'overdue';
    })
    .sort((left, right) => {
      const leftTime = left.dueDate ? Date.parse(left.dueDate) : Number.MAX_SAFE_INTEGER;
      const rightTime = right.dueDate ? Date.parse(right.dueDate) : Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime || left.title.localeCompare(right.title, 'pt-BR');
    });
}

function ToolButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border px-3 py-2 text-sm font-semibold transition-all',
        active
          ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-blue-200'
          : 'border-slate-200 bg-white/80 text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.07]',
      ].join(' ')}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function ToolsPage({
  tasks,
  notes,
  categories,
  holidayEntries,
  onCreateTask,
  onCreateNote,
  onOpenTask,
}: ToolsPageProps) {
  const actionableTasks = React.useMemo(() => sortActionableTasks(tasks), [tasks]);
  const categoryOptions = categories.length > 0 ? categories : ['Geral', 'Trabalho', 'Pessoal', 'Estudos'];

  const [activeTool, setActiveTool] = React.useState<ToolTab>('pomodoro');
  const [selectedTaskId, setSelectedTaskId] = React.useState('');
  const [toolMessage, setToolMessage] = React.useState('');
  const [isSaving, setIsSaving] = React.useState(false);
  const [sessionLogs, setSessionLogs] = React.useState<SessionLog[]>(() => readJson<SessionLog[]>(STORAGE_SESSIONS_KEY, []));

  const [pomodoroMode, setPomodoroMode] = React.useState<PomodoroMode>('focus');
  const [pomodoroSeconds, setPomodoroSeconds] = React.useState(POMODORO_SECONDS.focus);
  const [pomodoroRunning, setPomodoroRunning] = React.useState(false);
  const [pomodoroCycles, setPomodoroCycles] = React.useState(0);

  const [stopwatchSeconds, setStopwatchSeconds] = React.useState(0);
  const [stopwatchRunning, setStopwatchRunning] = React.useState(false);

  const [timerMinutes, setTimerMinutes] = React.useState(15);
  const [timerSeconds, setTimerSeconds] = React.useState(15 * 60);
  const [timerRunning, setTimerRunning] = React.useState(false);
  const [timerFinished, setTimerFinished] = React.useState(false);

  const [focusMinutes, setFocusMinutes] = React.useState(30);
  const [focusSeconds, setFocusSeconds] = React.useState(30 * 60);
  const [focusRunning, setFocusRunning] = React.useState(false);

  const [checklists, setChecklists] = React.useState<Record<string, ChecklistItem[]>>(() => (
    readJson<Record<string, ChecklistItem[]>>(STORAGE_CHECKLISTS_KEY, {})
  ));
  const [newChecklistText, setNewChecklistText] = React.useState('');

  const [deadlineStart, setDeadlineStart] = React.useState(() => normalizeDateInput(new Date()));
  const [deadlineDays, setDeadlineDays] = React.useState(5);

  const [routineDate, setRoutineDate] = React.useState(() => normalizeDateInput(new Date()));
  const [routineCategory, setRoutineCategory] = React.useState(categoryOptions[0] ?? 'Geral');
  const [routineItems, setRoutineItems] = React.useState<RoutineItem[]>(() => readJson<RoutineItem[]>(STORAGE_ROUTINE_KEY, [
    { id: createLocalId(), title: 'Revisar prioridades do dia', time: '09:00', category: 'Trabalho', priority: 'high' },
    { id: createLocalId(), title: 'Bloco de foco', time: '10:00', category: 'Trabalho', priority: 'medium' },
    { id: createLocalId(), title: 'Fechamento rapido', time: '17:30', category: 'Geral', priority: 'medium' },
  ]));

  const selectedTask = actionableTasks.find((task) => task.id === selectedTaskId) ?? null;
  const selectedTaskNotes = selectedTask ? notes.filter((note) => note.taskId === selectedTask.id) : [];
  const selectedChecklistKey = selectedTask?.id ?? UNLINKED_CHECKLIST_KEY;
  const selectedChecklist = checklists[selectedChecklistKey] ?? [];
  const holidays = React.useMemo(() => new Set(holidayEntries.map((entry) => entry.date.slice(0, 10))), [holidayEntries]);
  const deadlineResult = React.useMemo(() => getNextBusinessDate(deadlineStart, deadlineDays, holidays), [deadlineDays, deadlineStart, holidays]);
  const completedChecklistItems = selectedChecklist.filter((item) => item.done).length;

  React.useEffect(() => {
    if (selectedTaskId && !actionableTasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId('');
    }
  }, [actionableTasks, selectedTaskId]);

  React.useEffect(() => {
    writeJson(STORAGE_SESSIONS_KEY, sessionLogs.slice(0, 20));
  }, [sessionLogs]);

  React.useEffect(() => {
    writeJson(STORAGE_CHECKLISTS_KEY, checklists);
  }, [checklists]);

  React.useEffect(() => {
    writeJson(STORAGE_ROUTINE_KEY, routineItems);
  }, [routineItems]);

  React.useEffect(() => {
    if (!pomodoroRunning) return undefined;
    const interval = window.setInterval(() => {
      setPomodoroSeconds((current) => {
        if (current > 1) return current - 1;
        setPomodoroRunning(false);
        if (pomodoroMode === 'focus') {
          setPomodoroCycles((cycles) => cycles + 1);
          setToolMessage('Ciclo de foco concluido. Hora de registrar ou fazer uma pausa.');
        } else {
          setToolMessage('Pausa concluida. Voce pode voltar para o foco.');
        }
        return 0;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [pomodoroMode, pomodoroRunning]);

  React.useEffect(() => {
    if (!stopwatchRunning) return undefined;
    const interval = window.setInterval(() => {
      setStopwatchSeconds((current) => current + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [stopwatchRunning]);

  React.useEffect(() => {
    if (!timerRunning) return undefined;
    const interval = window.setInterval(() => {
      setTimerSeconds((current) => {
        if (current > 1) return current - 1;
        setTimerRunning(false);
        setTimerFinished(true);
        setToolMessage('Timer finalizado. Voce pode criar um lembrete a partir dele.');
        return 0;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [timerRunning]);

  React.useEffect(() => {
    if (!focusRunning) return undefined;
    const interval = window.setInterval(() => {
      setFocusSeconds((current) => {
        if (current > 1) return current - 1;
        setFocusRunning(false);
        setToolMessage('Bloco de foco concluido.');
        return 0;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [focusRunning]);

  const changePomodoroMode = (mode: PomodoroMode) => {
    setPomodoroMode(mode);
    setPomodoroRunning(false);
    setPomodoroSeconds(POMODORO_SECONDS[mode]);
  };

  const resetTimer = (minutes = timerMinutes) => {
    setTimerRunning(false);
    setTimerFinished(false);
    setTimerMinutes(minutes);
    setTimerSeconds(minutes * 60);
  };

  const resetFocus = (minutes = focusMinutes) => {
    setFocusRunning(false);
    setFocusMinutes(minutes);
    setFocusSeconds(minutes * 60);
  };

  const addSessionLog = async (input: Omit<SessionLog, 'id' | 'createdAt'>) => {
    const log: SessionLog = {
      ...input,
      id: createLocalId(),
      createdAt: new Date().toISOString(),
    };

    setSessionLogs((current) => [log, ...current].slice(0, 20));

    if (!input.taskId) {
      setToolMessage('Sessao salva no painel de ferramentas.');
      return;
    }

    setIsSaving(true);
    try {
      await onCreateNote({
        title: `${input.tool}: ${input.minutes} min`,
        content: input.description,
        priority: 'medium',
        category: selectedTask?.category ?? 'Geral',
        tags: ['Ferramentas', input.tool],
        mode: 'fixed',
        expiresAt: null,
        taskId: input.taskId,
      });
      setToolMessage('Sessao salva como nota vinculada ao lembrete.');
    } catch {
      setToolMessage('Sessao salva localmente, mas nao foi possivel criar a nota vinculada.');
    } finally {
      setIsSaving(false);
    }
  };

  const savePomodoroSession = () => {
    const elapsed = POMODORO_SECONDS[pomodoroMode] - pomodoroSeconds;
    const minutes = Math.max(1, Math.round(elapsed / 60));
    void addSessionLog({
      taskId: selectedTask?.id ?? null,
      tool: 'Pomodoro',
      minutes,
      description: selectedTask
        ? `Sessao de ${POMODORO_LABELS[pomodoroMode].toLocaleLowerCase('pt-BR')} vinculada a "${selectedTask.title}".`
        : `Sessao de ${POMODORO_LABELS[pomodoroMode].toLocaleLowerCase('pt-BR')} sem lembrete vinculado.`,
    });
  };

  const saveStopwatchSession = () => {
    const minutes = Math.max(1, Math.round(stopwatchSeconds / 60));
    void addSessionLog({
      taskId: selectedTask?.id ?? null,
      tool: 'Cronometro',
      minutes,
      description: selectedTask
        ? `Tempo medido no cronometro para "${selectedTask.title}": ${formatDuration(stopwatchSeconds)}.`
        : `Tempo medido no cronometro: ${formatDuration(stopwatchSeconds)}.`,
    });
  };

  const saveFocusSession = () => {
    const elapsed = focusMinutes * 60 - focusSeconds;
    const minutes = Math.max(1, Math.round(elapsed / 60));
    void addSessionLog({
      taskId: selectedTask?.id ?? null,
      tool: 'Foco',
      minutes,
      description: selectedTask
        ? `Bloco de foco em "${selectedTask.title}" por ${minutes} min.`
        : `Bloco de foco sem lembrete vinculado por ${minutes} min.`,
    });
  };

  const createTimerReminder = async () => {
    setIsSaving(true);
    try {
      const today = normalizeDateInput(new Date());
      await onCreateTask(buildTaskPayload({
        title: `Timer finalizado (${timerMinutes} min)`,
        description: 'Lembrete criado a partir do timer rapido.',
        date: today,
        time: format(new Date(), 'HH:mm'),
        category: 'Geral',
        priority: 'medium',
      }));
      setToolMessage('Lembrete criado a partir do timer.');
    } catch {
      setToolMessage('Nao foi possivel criar o lembrete do timer.');
    } finally {
      setIsSaving(false);
    }
  };

  const addChecklistItem = () => {
    const text = newChecklistText.trim();
    if (!text) return;
    setChecklists((current) => ({
      ...current,
      [selectedChecklistKey]: [
        ...(current[selectedChecklistKey] ?? []),
        { id: createLocalId(), text, done: false },
      ],
    }));
    setNewChecklistText('');
  };

  const toggleChecklistItem = (itemId: string) => {
    setChecklists((current) => ({
      ...current,
      [selectedChecklistKey]: (current[selectedChecklistKey] ?? []).map((item) => (
        item.id === itemId ? { ...item, done: !item.done } : item
      )),
    }));
  };

  const removeChecklistItem = (itemId: string) => {
    setChecklists((current) => ({
      ...current,
      [selectedChecklistKey]: (current[selectedChecklistKey] ?? []).filter((item) => item.id !== itemId),
    }));
  };

  const updateRoutineItem = (id: string, patch: Partial<RoutineItem>) => {
    setRoutineItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const addRoutineItem = () => {
    setRoutineItems((current) => [
      ...current,
      {
        id: createLocalId(),
        title: 'Novo bloco da rotina',
        time: '14:00',
        category: routineCategory,
        priority: 'medium',
      },
    ]);
  };

  const removeRoutineItem = (id: string) => {
    setRoutineItems((current) => current.filter((item) => item.id !== id));
  };

  const createRoutine = async () => {
    if (routineItems.length === 0) return;
    setIsSaving(true);
    let created = 0;
    try {
      for (const item of routineItems) {
        await onCreateTask(buildTaskPayload({
          title: item.title,
          description: 'Criado pelo gerador de rotina da aba Ferramentas.',
          date: routineDate,
          time: item.time,
          category: item.category || routineCategory || 'Geral',
          priority: item.priority,
        }));
        created += 1;
      }
      setToolMessage(`${created} lembrete${created === 1 ? '' : 's'} criado${created === 1 ? '' : 's'} para a rotina.`);
    } catch {
      setToolMessage(created > 0
        ? `${created} lembrete${created === 1 ? '' : 's'} criado${created === 1 ? '' : 's'}; os demais falharam.`
        : 'Nao foi possivel criar a rotina.');
    } finally {
      setIsSaving(false);
    }
  };

  const selectedTaskSelector = (
    <div className="space-y-2">
      <label className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
        Lembrete vinculado opcional
      </label>
      <select
        value={selectedTaskId}
        onChange={(event) => setSelectedTaskId(event.target.value)}
        className="field-control"
        data-testid="tools-task-select"
      >
        <option value="">Sem vinculo</option>
        {actionableTasks.map((task) => (
          <option key={task.id} value={task.id}>
            {formatTaskLabel(task)}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <motion.div
      key="tools"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-4 sm:space-y-6"
    >
      <section className="surface-panel p-4 md:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <span className="section-eyebrow">
              <Wrench size={14} />
              Ferramentas
            </span>
            <h3 className="mt-3 text-xl font-semibold tracking-tight text-slate-950 dark:text-white sm:mt-4 sm:text-2xl">
              Timers, foco e atalhos para transformar lembretes em execucao.
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400 sm:leading-7">
              Use Pomodoro, cronometro, timer rapido, bloco de foco, checklist, calculadora de prazo e gerador de rotina no mesmo lugar.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:min-w-[360px]">
            <div className="surface-soft p-3">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Foco hoje</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">{pomodoroCycles}</p>
            </div>
            <div className="surface-soft p-3">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Sessoes</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">{sessionLogs.length}</p>
            </div>
            <div className="surface-soft p-3">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Checklist</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">
                {completedChecklistItems}/{selectedChecklist.length}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="surface-panel p-3 sm:p-4">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
          <ToolButton active={activeTool === 'pomodoro'} onClick={() => setActiveTool('pomodoro')} icon={<Timer size={17} />} label="Pomodoro" />
          <ToolButton active={activeTool === 'stopwatch'} onClick={() => setActiveTool('stopwatch')} icon={<Clock3 size={17} />} label="Cronometro" />
          <ToolButton active={activeTool === 'timer'} onClick={() => setActiveTool('timer')} icon={<Hourglass size={17} />} label="Timer" />
          <ToolButton active={activeTool === 'focus'} onClick={() => setActiveTool('focus')} icon={<Focus size={17} />} label="Foco" />
          <ToolButton active={activeTool === 'checklist'} onClick={() => setActiveTool('checklist')} icon={<ClipboardList size={17} />} label="Checklist" />
          <ToolButton active={activeTool === 'deadline'} onClick={() => setActiveTool('deadline')} icon={<Calculator size={17} />} label="Prazo" />
          <ToolButton active={activeTool === 'routine'} onClick={() => setActiveTool('routine')} icon={<Sparkles size={17} />} label="Rotina" />
        </div>
      </section>

      {toolMessage && (
        <div className="surface-soft flex items-center gap-3 border-emerald-200 bg-emerald-50/80 p-4 text-sm font-semibold text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-200">
          <CheckCircle2 size={18} />
          <span>{toolMessage}</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
        <section className="surface-panel min-h-[420px] p-4 md:p-6">
          {activeTool === 'pomodoro' && (
            <div className="space-y-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <span className="section-eyebrow">
                    <Timer size={14} />
                    Pomodoro
                  </span>
                  <h3 className="mt-4 text-2xl font-semibold text-slate-950 dark:text-white">Ciclos de foco e pausa</h3>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(['focus', 'shortBreak', 'longBreak'] as PomodoroMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => changePomodoroMode(mode)}
                      className={[
                        'rounded-2xl border px-3 py-2 text-xs font-bold transition-colors',
                        pomodoroMode === mode
                          ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-blue-200'
                          : 'border-slate-200 bg-white text-slate-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300',
                      ].join(' ')}
                    >
                      {POMODORO_LABELS[mode]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div className="surface-soft flex min-h-[280px] flex-col items-center justify-center p-6 text-center">
                  <p className="text-sm font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                    {POMODORO_LABELS[pomodoroMode]}
                  </p>
                  <div className="mt-4 font-display text-7xl font-semibold tabular-nums tracking-normal text-slate-950 dark:text-white sm:text-8xl">
                    {formatSeconds(pomodoroSeconds)}
                  </div>
                  <div className="mt-6 flex flex-wrap justify-center gap-2">
                    <button type="button" onClick={() => setPomodoroRunning((value) => !value)} className="action-primary">
                      {pomodoroRunning ? <Pause size={18} /> : <Play size={18} />}
                      {pomodoroRunning ? 'Pausar' : 'Iniciar'}
                    </button>
                    <button type="button" onClick={() => changePomodoroMode(pomodoroMode)} className="action-secondary">
                      <RotateCcw size={18} />
                      Zerar
                    </button>
                    <button type="button" onClick={savePomodoroSession} disabled={isSaving} className="action-secondary disabled:opacity-60">
                      <Link2 size={18} />
                      Salvar sessao
                    </button>
                  </div>
                </div>
                <div className="space-y-4">
                  {selectedTaskSelector}
                  <div className="surface-soft p-4">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">Proximo passo</p>
                    <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                      A cada quatro ciclos de foco, a pausa longa fica como melhor escolha para recuperar energia.
                    </p>
                    <p className="mt-4 text-3xl font-semibold text-slate-950 dark:text-white">{pomodoroCycles}</p>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">ciclos concluidos nesta tela</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTool === 'stopwatch' && (
            <div className="space-y-6">
              <span className="section-eyebrow">
                <Clock3 size={14} />
                Cronometro
              </span>
              <div className="surface-soft flex min-h-[300px] flex-col items-center justify-center p-6 text-center">
                <div className="font-display text-7xl font-semibold tabular-nums tracking-normal text-slate-950 dark:text-white sm:text-8xl">
                  {formatSeconds(stopwatchSeconds)}
                </div>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  <button type="button" onClick={() => setStopwatchRunning((value) => !value)} className="action-primary">
                    {stopwatchRunning ? <Pause size={18} /> : <Play size={18} />}
                    {stopwatchRunning ? 'Pausar' : 'Iniciar'}
                  </button>
                  <button type="button" onClick={() => { setStopwatchRunning(false); setStopwatchSeconds(0); }} className="action-secondary">
                    <RotateCcw size={18} />
                    Zerar
                  </button>
                  <button type="button" onClick={saveStopwatchSession} disabled={stopwatchSeconds === 0 || isSaving} className="action-secondary disabled:opacity-60">
                    <Link2 size={18} />
                    Salvar tempo
                  </button>
                </div>
              </div>
              {selectedTaskSelector}
            </div>
          )}

          {activeTool === 'timer' && (
            <div className="space-y-6">
              <span className="section-eyebrow">
                <Hourglass size={14} />
                Timer rapido
              </span>
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
                <div className="surface-soft flex min-h-[300px] flex-col items-center justify-center p-6 text-center">
                  <div className="font-display text-7xl font-semibold tabular-nums tracking-normal text-slate-950 dark:text-white sm:text-8xl">
                    {formatSeconds(timerSeconds)}
                  </div>
                  <div className="mt-6 flex flex-wrap justify-center gap-2">
                    <button type="button" onClick={() => setTimerRunning((value) => !value)} disabled={timerSeconds === 0} className="action-primary disabled:opacity-60">
                      {timerRunning ? <Pause size={18} /> : <Play size={18} />}
                      {timerRunning ? 'Pausar' : 'Iniciar'}
                    </button>
                    <button type="button" onClick={() => resetTimer()} className="action-secondary">
                      <RotateCcw size={18} />
                      Zerar
                    </button>
                    {timerFinished && (
                      <button type="button" onClick={createTimerReminder} disabled={isSaving} className="action-secondary disabled:opacity-60">
                        <AlarmClock size={18} />
                        Criar lembrete
                      </button>
                    )}
                  </div>
                </div>
                <div className="space-y-3">
                  {[10, 15, 30, 60].map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      onClick={() => resetTimer(minutes)}
                      className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.07]"
                    >
                      <span>{minutes} minutos</span>
                      <FastForward size={16} />
                    </button>
                  ))}
                  <label className="block">
                    <span className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                      Personalizado
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={240}
                      value={timerMinutes}
                      onChange={(event) => resetTimer(Math.max(1, Number(event.target.value) || 1))}
                      className="field-control"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {activeTool === 'focus' && (
            <div className="space-y-6">
              <span className="section-eyebrow">
                <Focus size={14} />
                Bloco de foco
              </span>
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
                <div className="surface-soft p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
                        {selectedTask ? 'Lembrete em foco' : 'Bloco livre'}
                      </p>
                      <h3 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">
                        {selectedTask?.title ?? 'Foco sem lembrete vinculado'}
                      </h3>
                      {selectedTask?.description ? (
                        <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">{selectedTask.description}</p>
                      ) : (
                        <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
                          Use este bloco para uma sessao avulsa e salve o tempo no painel de ferramentas.
                        </p>
                      )}
                    </div>
                    {selectedTask && (
                      <button type="button" onClick={() => onOpenTask(selectedTask)} className="action-secondary shrink-0 px-4">
                        Abrir
                      </button>
                    )}
                  </div>
                  <div className="mt-6 rounded-3xl border border-slate-200 bg-white/70 p-5 text-center dark:border-white/10 dark:bg-white/[0.04]">
                    <div className="font-display text-6xl font-semibold tabular-nums tracking-normal text-slate-950 dark:text-white sm:text-7xl">
                      {formatSeconds(focusSeconds)}
                    </div>
                    <div className="mt-5 flex flex-wrap justify-center gap-2">
                      <button type="button" onClick={() => setFocusRunning((value) => !value)} className="action-primary">
                        {focusRunning ? <Pause size={18} /> : <Play size={18} />}
                        {focusRunning ? 'Pausar' : 'Iniciar'}
                      </button>
                      <button type="button" onClick={() => resetFocus()} className="action-secondary">
                        <RotateCcw size={18} />
                        Zerar
                      </button>
                      <button type="button" onClick={saveFocusSession} disabled={isSaving} className="action-secondary disabled:opacity-60">
                        <Link2 size={18} />
                        Salvar
                      </button>
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  {selectedTaskSelector}
                  <label className="block">
                    <span className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Duracao</span>
                    <input
                      type="number"
                      min={5}
                      max={180}
                      value={focusMinutes}
                      onChange={(event) => resetFocus(Math.max(5, Number(event.target.value) || 5))}
                      className="field-control"
                    />
                  </label>
                  <div className="surface-soft p-4">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">Notas vinculadas</p>
                    <div className="mt-3 space-y-2">
                      {selectedTaskNotes.slice(0, 3).map((note) => (
                        <div key={note.id} className="rounded-2xl bg-white/80 p-3 text-sm dark:bg-white/[0.05]">
                          <p className="font-semibold text-slate-800 dark:text-slate-100">{note.title}</p>
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{note.content}</p>
                        </div>
                      ))}
                      {selectedTaskNotes.length === 0 && (
                        <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">
                          {selectedTask ? 'Nenhuma nota vinculada ainda.' : 'Notas aparecem aqui quando um lembrete for selecionado.'}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTool === 'checklist' && (
            <div className="space-y-6">
              <span className="section-eyebrow">
                <ClipboardList size={14} />
                Checklist rapido
              </span>
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
                <div className="surface-soft p-4">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newChecklistText}
                      onChange={(event) => setNewChecklistText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') addChecklistItem();
                      }}
                      placeholder="Adicionar subtarefa"
                      className="field-control"
                    />
                    <button type="button" onClick={addChecklistItem} disabled={!newChecklistText.trim()} className="action-primary px-4 disabled:opacity-60" aria-label="Adicionar item">
                      <Plus size={18} />
                    </button>
                  </div>
                  <div className="mt-4 space-y-2">
                    {selectedChecklist.map((item) => (
                      <div key={item.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/80 p-3 dark:border-white/10 dark:bg-white/[0.04]">
                        <button
                          type="button"
                          onClick={() => toggleChecklistItem(item.id)}
                          aria-label={item.done ? 'Desmarcar item' : 'Marcar item'}
                          className={[
                            'flex h-9 w-9 items-center justify-center rounded-xl border transition-colors',
                            item.done
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-200'
                              : 'border-slate-200 bg-white text-slate-400 dark:border-white/10 dark:bg-white/[0.04]',
                          ].join(' ')}
                        >
                          {item.done && <Check size={16} />}
                        </button>
                        <span className={['min-w-0 flex-1 text-sm font-medium', item.done ? 'text-slate-400 line-through' : 'text-slate-800 dark:text-slate-100'].join(' ')}>
                          {item.text}
                        </span>
                        <button type="button" onClick={() => removeChecklistItem(item.id)} className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10" aria-label="Remover item">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                    {selectedChecklist.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
                        {selectedTask ? 'Adicione pequenas etapas para destravar o lembrete selecionado.' : 'Adicione pequenas etapas para uma lista sem lembrete vinculado.'}
                      </div>
                    )}
                  </div>
                </div>
                {selectedTaskSelector}
              </div>
            </div>
          )}

          {activeTool === 'deadline' && (
            <div className="space-y-6">
              <span className="section-eyebrow">
                <Calculator size={14} />
                Calculadora de prazo
              </span>
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
                <div className="surface-soft p-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Data inicial</span>
                      <input type="date" value={deadlineStart} onChange={(event) => setDeadlineStart(event.target.value)} className="field-control" />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Dias uteis</span>
                      <input type="number" min={0} max={365} value={deadlineDays} onChange={(event) => setDeadlineDays(Math.max(0, Number(event.target.value) || 0))} className="field-control" />
                    </label>
                  </div>
                  <div className="mt-6 rounded-3xl border border-blue-200 bg-blue-50 p-5 dark:border-blue-400/20 dark:bg-blue-500/10">
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-500 dark:text-blue-300">Resultado</p>
                    <p className="mt-2 text-3xl font-semibold text-blue-950 dark:text-white">
                      {format(deadlineResult, "dd 'de' MMMM", { locale: ptBR })}
                    </p>
                    <p className="mt-2 text-sm text-blue-700 dark:text-blue-200">
                      Finais de semana e feriados carregados no sistema foram ignorados.
                    </p>
                  </div>
                </div>
                <div className="surface-soft p-4">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">Feriados considerados</p>
                  <div className="mt-3 space-y-2">
                    {holidayEntries.slice(0, 6).map((holiday) => (
                      <div key={holiday.id} className="rounded-2xl bg-white/80 p-3 text-sm dark:bg-white/[0.05]">
                        <p className="font-semibold text-slate-800 dark:text-slate-100">{holiday.name}</p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{holiday.date.slice(0, 10)}</p>
                      </div>
                    ))}
                    {holidayEntries.length === 0 && (
                      <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">Sem feriados carregados para esta conta.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTool === 'routine' && (
            <div className="space-y-6">
              <span className="section-eyebrow">
                <Sparkles size={14} />
                Gerador de rotina
              </span>
              <div className="surface-soft p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Data</span>
                    <input type="date" value={routineDate} onChange={(event) => setRoutineDate(event.target.value)} className="field-control" />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Categoria padrao</span>
                    <select value={routineCategory} onChange={(event) => setRoutineCategory(event.target.value)} className="field-control">
                      {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
                    </select>
                  </label>
                </div>

                <div className="mt-5 space-y-3">
                  {routineItems.map((item) => (
                    <div key={item.id} className="grid gap-2 rounded-2xl border border-slate-200 bg-white/80 p-3 dark:border-white/10 dark:bg-white/[0.04] sm:grid-cols-[minmax(0,1fr)_110px_140px_110px_44px]">
                      <input value={item.title} onChange={(event) => updateRoutineItem(item.id, { title: event.target.value })} className="field-control" aria-label="Titulo da rotina" />
                      <input type="time" value={item.time} onChange={(event) => updateRoutineItem(item.id, { time: event.target.value })} className="field-control" aria-label="Horario" />
                      <select value={item.category} onChange={(event) => updateRoutineItem(item.id, { category: event.target.value })} className="field-control" aria-label="Categoria">
                        {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
                      </select>
                      <select value={item.priority} onChange={(event) => updateRoutineItem(item.id, { priority: event.target.value as RoutineItem['priority'] })} className="field-control" aria-label="Prioridade">
                        <option value="high">Alta</option>
                        <option value="medium">Media</option>
                        <option value="low">Baixa</option>
                      </select>
                      <button type="button" onClick={() => removeRoutineItem(item.id)} className="flex h-12 w-12 items-center justify-center rounded-2xl text-slate-400 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10" aria-label="Remover bloco">
                        <Trash2 size={17} />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <button type="button" onClick={addRoutineItem} className="action-secondary">
                    <Plus size={18} />
                    Adicionar bloco
                  </button>
                  <button type="button" onClick={createRoutine} disabled={isSaving || routineItems.length === 0} className="action-primary disabled:opacity-60">
                    <BriefcaseBusiness size={18} />
                    Criar rotina
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <section className="surface-panel p-4">
            <span className="section-eyebrow">
              <Coffee size={14} />
              Contexto
            </span>
            {selectedTask ? (
              <div className="mt-4 space-y-3">
                <button type="button" onClick={() => onOpenTask(selectedTask)} className="block w-full rounded-3xl border border-slate-200 bg-white/80 p-4 text-left transition-colors hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:hover:bg-white/[0.07]">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Selecionado</p>
                  <h4 className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">{selectedTask.title}</h4>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    {selectedTask.dueDate ? format(parseISO(selectedTask.dueDate), "dd/MM 'as' HH:mm") : 'Sem horario definido'}
                  </p>
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <div className="surface-soft p-3">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Notas</p>
                    <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">{selectedTaskNotes.length}</p>
                  </div>
                  <div className="surface-soft p-3">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Itens</p>
                    <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">{selectedChecklist.length}</p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm leading-6 text-slate-500 dark:text-slate-400">Ferramentas em modo avulso, sem lembrete vinculado.</p>
            )}
          </section>

          <section className="surface-panel p-4">
            <span className="section-eyebrow">
              <CheckCircle2 size={14} />
              Sessoes recentes
            </span>
            <div className="mt-4 space-y-2">
              {sessionLogs.slice(0, 5).map((log) => {
                const task = log.taskId ? tasks.find((item) => item.id === log.taskId) : null;
                return (
                  <div key={log.id} className="rounded-2xl border border-slate-200 bg-white/80 p-3 dark:border-white/10 dark:bg-white/[0.04]">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">{log.tool}</p>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600 dark:bg-white/[0.08] dark:text-slate-200">{log.minutes} min</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{task?.title ?? 'Sem vinculo'}</p>
                  </div>
                );
              })}
              {sessionLogs.length === 0 && (
                <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">As sessoes salvas aparecem aqui.</p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </motion.div>
  );
}
