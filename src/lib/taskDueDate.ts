export const DATE_ONLY_SENTINEL_TIME = '23:59';

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

export function buildDueDateFromForm(date: string, time: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = (time || DATE_ONLY_SENTINEL_TIME).split(':').map(Number);

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
  return timeLabel ? `Horario: ${timeLabel}` : 'Dia todo';
}
