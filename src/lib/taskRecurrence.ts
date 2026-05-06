export type RecurrenceMode = 'daily' | 'weekdays' | 'weekends' | 'weekly';
export type RecurrenceSuggestion = 'weekdays' | 'weekends' | 'month' | 'weekly' | 'next7Days';

export const MAX_RECURRENCE_OCCURRENCES = 120;

type RecurrenceValidationInput = {
  isEditing: boolean;
  enabled: boolean;
  startDateValue: string;
  endDateValue: string;
  occurrenceCount: number;
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

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 12, 0, 0, 0);
}

function getUtcDateOnlyTime(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function getDaysSince(startDate: Date, date: Date): number {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.round((getUtcDateOnlyTime(date) - getUtcDateOnlyTime(startDate)) / millisecondsPerDay);
}

function matchesRecurrence(date: Date, mode: RecurrenceMode, startDate: Date): boolean {
  const day = date.getDay();

  switch (mode) {
    case 'daily':
      return true;
    case 'weekdays':
      return day >= 1 && day <= 5;
    case 'weekends':
      return day === 0 || day === 6;
    case 'weekly':
      return getDaysSince(startDate, date) % 7 === 0;
  }
}

export function buildRecurringDates(
  startDateValue: string,
  endDateValue: string,
  mode: RecurrenceMode,
  limit = MAX_RECURRENCE_OCCURRENCES + 1,
): string[] {
  const startDate = parseDateOnly(startDateValue);
  const endDate = parseDateOnly(endDateValue);

  if (!startDate || !endDate || endDate < startDate) return [];

  const dates: string[] = [];

  for (let current = new Date(startDate); current <= endDate; current = addDays(current, 1)) {
    if (matchesRecurrence(current, mode, startDate)) {
      dates.push(formatDateOnly(current));
      if (dates.length >= limit) break;
    }
  }

  return dates;
}

export function getRecurrenceValidationError({
  isEditing,
  enabled,
  startDateValue,
  endDateValue,
  occurrenceCount,
}: RecurrenceValidationInput): string {
  if (isEditing || !enabled) return '';
  if (!startDateValue) return '';
  if (!endDateValue) return 'Defina a data final da repetição.';
  if (endDateValue < startDateValue) return 'A repetição precisa terminar na mesma data ou depois do início.';
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
