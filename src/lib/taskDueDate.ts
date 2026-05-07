export const DATE_ONLY_SENTINEL_TIME = '23:59';
export const DEFAULT_NO_TIME_REMINDER_MINUTES = 60;
export const MAX_NO_TIME_REMINDER_MINUTES = 23 * 60 + 59;

export function formatDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatTimeInputValue(date: Date): string {
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function parseDueDateToForm(isoDate: string): { date: string; time: string } {
  const parsedDate = new Date(isoDate);

  if (Number.isNaN(parsedDate.getTime())) {
    return { date: '', time: '' };
  }

  const date = formatDateInputValue(parsedDate);
  const time = formatTimeInputValue(parsedDate);

  return {
    date,
    time: time === DATE_ONLY_SENTINEL_TIME ? '' : time,
  };
}

export function normalizeNoTimeReminderMinutes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_NO_TIME_REMINDER_MINUTES;
  }

  return Math.min(
    MAX_NO_TIME_REMINDER_MINUTES,
    Math.max(0, Math.round(value)),
  );
}

export function formatMinutesAsTimeInput(minutes: number): string {
  const normalizedMinutes = normalizeNoTimeReminderMinutes(minutes);
  const hours = Math.floor(normalizedMinutes / 60);
  const remainingMinutes = normalizedMinutes % 60;

  return `${`${hours}`.padStart(2, '0')}:${`${remainingMinutes}`.padStart(2, '0')}`;
}

export function splitMinutesIntoTimeParts(minutes: number): { hours: number; minutes: number } {
  const normalizedMinutes = normalizeNoTimeReminderMinutes(minutes);

  return {
    hours: Math.floor(normalizedMinutes / 60),
    minutes: normalizedMinutes % 60,
  };
}

export function buildNoTimeReminderMinutes(hours: number, minutes: number): number {
  const safeHours = Number.isFinite(hours) ? Math.trunc(hours) : 0;
  const safeMinutes = Number.isFinite(minutes) ? Math.trunc(minutes) : 0;

  return normalizeNoTimeReminderMinutes((safeHours * 60) + safeMinutes);
}

export function buildDueDateFromForm(
  date: string,
  time: string,
  fallbackTime = DATE_ONLY_SENTINEL_TIME,
): string {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = (time || fallbackTime).split(':').map(Number);

  return new Date(year, month - 1, day, hours, minutes, 0, 0).toISOString();
}

export function getTaskTimeLabel(isoDate: string): string | null {
  const parsedDate = new Date(isoDate);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  const time = formatTimeInputValue(parsedDate);
  return time === DATE_ONLY_SENTINEL_TIME ? null : time;
}

export function getTaskTimeDescription(isoDate: string): string {
  const timeLabel = getTaskTimeLabel(isoDate);
  return timeLabel ? `Horário: ${timeLabel}` : 'Dia todo';
}
