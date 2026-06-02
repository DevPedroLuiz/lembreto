export type RecurrenceMode =
  | 'daily'
  | 'weekdays'
  | 'weekends'
  | 'weekly'
  | 'custom_weekdays'
  | 'monthly'
  | 'last_business_day';
export type RecurrenceSuggestion = 'weekdays' | 'weekends' | 'month' | 'weekly' | 'next7Days';
export type RecurrenceWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const MAX_RECURRENCE_OCCURRENCES = 120;
export const MAX_RECURRENCE_WINDOW_DAYS = 730;

type RecurrenceValidationInput = {
  isEditing: boolean;
  enabled: boolean;
  mode: RecurrenceMode;
  startDateValue: string;
  endDateValue: string;
  occurrenceCount: number;
  selectedWeekdays?: readonly number[];
};

type RecurrenceBuildOptions = {
  selectedWeekdays?: readonly number[];
};

function parseDateOnly(dateValue: string): Date | null {
  const [year, month, day] = dateValue.split('-').map(Number);
  if (!year || !month || !day) return null;

  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(date: Date): string {
  const day = `${date.getDate()}`.padStart(2, '0');
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()}`;
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1, 12, 0, 0, 0);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 12, 0, 0, 0);
}

function getDaysInMonth(date: Date): number {
  return endOfMonth(date).getDate();
}

function getLastBusinessDayOfMonth(date: Date): Date {
  const lastDay = endOfMonth(date);

  while (lastDay.getDay() === 0 || lastDay.getDay() === 6) {
    lastDay.setDate(lastDay.getDate() - 1);
  }

  return lastDay;
}

function buildMonthlyOccurrence(startDate: Date, monthOffset: number): Date {
  const monthAnchor = addMonths(startDate, monthOffset);
  const day = Math.min(startDate.getDate(), getDaysInMonth(monthAnchor));
  return new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), day, 12, 0, 0, 0);
}

function sanitizeWeekdays(weekdays: readonly number[] = []): RecurrenceWeekday[] {
  const validWeekdays = new Set<RecurrenceWeekday>();

  weekdays.forEach((weekday) => {
    if (Number.isInteger(weekday) && weekday >= 0 && weekday <= 6) {
      validWeekdays.add(weekday as RecurrenceWeekday);
    }
  });

  const weekdayOrder = [1, 2, 3, 4, 5, 6, 0];
  return Array.from(validWeekdays).sort((left, right) => weekdayOrder.indexOf(left) - weekdayOrder.indexOf(right));
}

function pushDateWithinLimit(dates: string[], date: Date, endDate: Date, limit: number): boolean {
  if (date <= endDate) {
    dates.push(formatDateOnly(date));
  }

  return dates.length >= limit;
}

export function getRecurrenceDateLimit(startDateValue: string): string | null {
  const startDate = parseDateOnly(startDateValue);
  return startDate ? formatDateOnly(addDays(startDate, MAX_RECURRENCE_WINDOW_DAYS)) : null;
}

export function buildRecurringDates(
  startDateValue: string,
  endDateValue: string,
  mode: RecurrenceMode,
  limit = MAX_RECURRENCE_OCCURRENCES + 1,
  options: RecurrenceBuildOptions = {},
): string[] {
  const startDate = parseDateOnly(startDateValue);
  const requestedEndDate = parseDateOnly(endDateValue);

  if (!startDate || !requestedEndDate || requestedEndDate < startDate) return [];

  const maxEndDate = addDays(startDate, MAX_RECURRENCE_WINDOW_DAYS);
  const endDate = requestedEndDate > maxEndDate ? maxEndDate : requestedEndDate;
  const dates: string[] = [];

  if (mode === 'weekly') {
    for (let current = new Date(startDate); current <= endDate; current = addDays(current, 7)) {
      if (pushDateWithinLimit(dates, current, endDate, limit)) break;
    }
    return dates;
  }

  if (mode === 'monthly') {
    for (let offset = 0; ; offset += 1) {
      const current = buildMonthlyOccurrence(startDate, offset);
      if (current > endDate) break;
      if (current >= startDate && pushDateWithinLimit(dates, current, endDate, limit)) break;
    }
    return dates;
  }

  if (mode === 'last_business_day') {
    for (let offset = 0; ; offset += 1) {
      const current = getLastBusinessDayOfMonth(addMonths(startDate, offset));
      if (current > endDate) break;
      if (current >= startDate && pushDateWithinLimit(dates, current, endDate, limit)) break;
    }
    return dates;
  }

  const selectedWeekdays = sanitizeWeekdays(options.selectedWeekdays);

  for (let current = new Date(startDate); current <= endDate; current = addDays(current, 1)) {
    const weekday = current.getDay() as RecurrenceWeekday;
    const matches = mode === 'daily'
      || (mode === 'weekdays' && weekday >= 1 && weekday <= 5)
      || (mode === 'weekends' && (weekday === 0 || weekday === 6))
      || (mode === 'custom_weekdays' && selectedWeekdays.includes(weekday));

    if (matches && pushDateWithinLimit(dates, current, endDate, limit)) break;
  }

  return dates;
}

export function getRecurrenceValidationError({
  isEditing,
  enabled,
  mode,
  startDateValue,
  endDateValue,
  occurrenceCount,
  selectedWeekdays = [],
}: RecurrenceValidationInput): string {
  if (isEditing || !enabled) return '';

  const startDate = parseDateOnly(startDateValue);
  const endDate = parseDateOnly(endDateValue);
  if (!startDate) return 'Defina a data inicial antes de ativar a repetição.';
  if (!endDateValue) return 'Defina a data final da repetição.';
  if (!endDate) return 'A data final da repetição é inválida.';
  if (endDate < startDate) return 'A repetição precisa terminar na mesma data ou depois do início.';

  const maxEndDate = addDays(startDate, MAX_RECURRENCE_WINDOW_DAYS);
  if (endDate > maxEndDate) {
    return `A repetição pode cobrir no máximo ${MAX_RECURRENCE_WINDOW_DAYS} dias. Use até ${formatDisplayDate(maxEndDate)}.`;
  }

  if (mode === 'custom_weekdays' && sanitizeWeekdays(selectedWeekdays).length === 0) {
    return 'Escolha pelo menos um dia da semana para essa repetição.';
  }

  if (occurrenceCount === 0) return 'Nenhuma data do intervalo corresponde a esse padrão de repetição.';
  if (occurrenceCount > MAX_RECURRENCE_OCCURRENCES) {
    return `Reduza o intervalo para no máximo ${MAX_RECURRENCE_OCCURRENCES} lembretes por criação.`;
  }
  return '';
}

export function countDateKeyMatches(dateValues: readonly string[], dateKeys: ReadonlySet<string>): number {
  return dateValues.reduce((count, dateValue) => (
    dateKeys.has(dateValue) ? count + 1 : count
  ), 0);
}

export function getRecurrenceSuggestion(
  startDateValue: string,
  suggestion: RecurrenceSuggestion,
): { mode: RecurrenceMode; until: string } | null {
  const startDate = parseDateOnly(startDateValue);
  if (!startDate) return null;

  if (suggestion === 'weekdays') {
    return { mode: 'weekdays', until: formatDateOnly(endOfMonth(startDate)) };
  }

  if (suggestion === 'weekends') {
    return { mode: 'weekends', until: formatDateOnly(endOfMonth(startDate)) };
  }

  if (suggestion === 'month') {
    return { mode: 'daily', until: formatDateOnly(endOfMonth(startDate)) };
  }

  if (suggestion === 'weekly') {
    return { mode: 'weekly', until: formatDateOnly(addDays(startDate, 56)) };
  }

  return { mode: 'daily', until: formatDateOnly(addDays(startDate, 6)) };
}
