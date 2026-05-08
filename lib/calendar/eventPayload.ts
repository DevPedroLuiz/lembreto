import type { CalendarEventInput, CalendarTaskForSync } from './types.js';

export const LEMBRETO_TIME_ZONE = 'America/Sao_Paulo';
export const DATE_ONLY_SENTINEL_TIME = { hour: 23, minute: 59 };

export function isDateOnlyDueDate(value: string): boolean {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.getHours() === DATE_ONLY_SENTINEL_TIME.hour && date.getMinutes() === DATE_ONLY_SENTINEL_TIME.minute;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildCalendarEventInput(task: CalendarTaskForSync): CalendarEventInput | null {
  if (!task.dueDate) return null;
  const dueDate = new Date(task.dueDate);
  if (Number.isNaN(dueDate.getTime())) return null;

  return {
    title: task.title,
    description: [
      task.description?.trim() || null,
      `Prioridade: ${task.priority}`,
      `Categoria: ${task.category || 'Geral'}`,
      task.tags.length > 0 ? `Tags: ${task.tags.join(', ')}` : null,
      `Status: ${task.status === 'completed' ? 'concluído' : 'pendente'}`,
      `Lembreto ID: ${task.id}`,
    ].filter(Boolean).join('\n'),
    dueDate: task.dueDate,
    endDate: task.endDate,
    category: task.category || 'Geral',
    tags: task.tags,
    reminders: {
      useDefault: false,
      overrides: [],
    },
  };
}
