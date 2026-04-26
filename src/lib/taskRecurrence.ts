export type RecurrenceMode = 'daily' | 'weekdays' | 'weekends' | 'weekly';
export type RecurrenceSuggestion = 'weekdays' | 'weekends' | 'month' | 'weekly' | 'next7Days';

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

function matchesRecurrence(date: Date, mode: RecurrenceMode): boolean {
  const day = date.getDay();

  if (mode === 'daily') return true;
  if (mode === 'weekdays') return day >= 1 && day <= 5;
  if (mode === 'weekends') return day === 0 || day === 6;
  return day === parseDateOnly(formatDateOnly(date))?.getDay();
}

export function buildRecurringDates(
  startDateValue: string,
  endDateValue: string,
  mode: RecurrenceMode,
): string[] {
  const startDate = parseDateOnly(startDateValue);
  const endDate = parseDateOnly(endDateValue);

  if (!startDate || !endDate || endDate < startDate) return [];

  if (mode === 'weekly') {
    const dates: string[] = [];
    for (let current = new Date(startDate); current <= endDate; current = addDays(current, 7)) {
      dates.push(formatDateOnly(current));
    }
    return dates;
  }

  const dates: string[] = [];
  for (let current = new Date(startDate); current <= endDate; current = addDays(current, 1)) {
    if (matchesRecurrence(current, mode)) {
      dates.push(formatDateOnly(current));
    }
  }

  return dates;
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
