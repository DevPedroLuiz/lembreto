const CALENDAR_TIME_ZONE = 'America/Sao_Paulo';
const DATE_ONLY_SENTINEL = { hour: '23', minute: '59' };

export interface CalendarTask {
  id: string;
  title: string;
  description?: string | null;
  dueDate: string | Date;
  priority: string;
  category?: string | null;
  tags?: string[] | null;
  status?: string | null;
  createdAt?: string | Date | null;
}

interface DateParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

const zonedDateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: CALENDAR_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function getZonedDateParts(date: Date): DateParts {
  const parts = Object.fromEntries(
    zonedDateFormatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  ) as Partial<DateParts>;

  return {
    year: parts.year ?? '1970',
    month: parts.month ?? '01',
    day: parts.day ?? '01',
    hour: parts.hour === '24' ? '00' : parts.hour ?? '00',
    minute: parts.minute ?? '00',
    second: parts.second ?? '00',
  };
}

function formatUtcTimestamp(date: Date): string {
  const year = `${date.getUTCFullYear()}`.padStart(4, '0');
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  const hour = `${date.getUTCHours()}`.padStart(2, '0');
  const minute = `${date.getUTCMinutes()}`.padStart(2, '0');
  const second = `${date.getUTCSeconds()}`.padStart(2, '0');
  return `${year}${month}${day}T${hour}${minute}${second}Z`;
}

function formatZonedDateTime(date: Date): string {
  const parts = getZonedDateParts(date);
  return `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}${parts.second}`;
}

function formatZonedDate(date: Date): string {
  const parts = getZonedDateParts(date);
  return `${parts.year}${parts.month}${parts.day}`;
}

function addOneCalendarDay(dateValue: string): string {
  const year = Number.parseInt(dateValue.slice(0, 4), 10);
  const month = Number.parseInt(dateValue.slice(4, 6), 10);
  const day = Number.parseInt(dateValue.slice(6, 8), 10);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}${`${next.getUTCMonth() + 1}`.padStart(2, '0')}${`${next.getUTCDate()}`.padStart(2, '0')}`;
}

function isDateOnlyReminder(date: Date): boolean {
  const parts = getZonedDateParts(date);
  return parts.hour === DATE_ONLY_SENTINEL.hour && parts.minute === DATE_ONLY_SENTINEL.minute;
}

function escapeIcsText(value: unknown): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function foldLine(line: string): string {
  const maxLength = 74;
  if (line.length <= maxLength) return line;

  const chunks: string[] = [];
  let remaining = line;
  while (remaining.length > maxLength) {
    chunks.push(remaining.slice(0, maxLength));
    remaining = ` ${remaining.slice(maxLength)}`;
  }
  chunks.push(remaining);
  return chunks.join('\r\n');
}

function buildDescription(task: CalendarTask): string {
  const lines = [
    task.description?.trim() || null,
    `Prioridade: ${task.priority}`,
    `Categoria: ${task.category || 'Geral'}`,
    task.tags?.length ? `Tags: ${task.tags.join(', ')}` : null,
    task.status ? `Status: ${task.status}` : null,
    'Origem: Lembreto',
  ];

  return lines.filter(Boolean).join('\n');
}

function buildTaskEvent(task: CalendarTask, dtstamp: string): string[] | null {
  const dueDate = new Date(task.dueDate);
  if (Number.isNaN(dueDate.getTime())) return null;

  const createdAt = task.createdAt ? new Date(task.createdAt) : null;
  const created = createdAt && !Number.isNaN(createdAt.getTime())
    ? formatUtcTimestamp(createdAt)
    : dtstamp;
  const categories = [task.category, ...(task.tags ?? [])]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
  const allDay = isDateOnlyReminder(dueDate);
  const lines = [
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(task.id)}@lembreto`,
    `DTSTAMP:${dtstamp}`,
    `CREATED:${created}`,
    `LAST-MODIFIED:${dtstamp}`,
    `SUMMARY:${escapeIcsText(task.title || 'Lembrete')}`,
    `DESCRIPTION:${escapeIcsText(buildDescription(task))}`,
    categories.length > 0 ? `CATEGORIES:${categories.map(escapeIcsText).join(',')}` : null,
    'STATUS:CONFIRMED',
  ].filter(Boolean) as string[];

  if (allDay) {
    const start = formatZonedDate(dueDate);
    lines.push(`DTSTART;VALUE=DATE:${start}`);
    lines.push(`DTEND;VALUE=DATE:${addOneCalendarDay(start)}`);
  } else {
    const endDate = new Date(dueDate.getTime() + 30 * 60 * 1000);
    lines.push(`DTSTART;TZID=${CALENDAR_TIME_ZONE}:${formatZonedDateTime(dueDate)}`);
    lines.push(`DTEND;TZID=${CALENDAR_TIME_ZONE}:${formatZonedDateTime(endDate)}`);
    lines.push('BEGIN:VALARM');
    lines.push('ACTION:DISPLAY');
    lines.push('DESCRIPTION:Lembrete');
    lines.push('TRIGGER:-PT15M');
    lines.push('END:VALARM');
  }

  lines.push('END:VEVENT');
  return lines;
}

export function buildTasksIcs(tasks: CalendarTask[], generatedAt = new Date()): string {
  const dtstamp = formatUtcTimestamp(generatedAt);
  const sortedTasks = [...tasks].sort((left, right) =>
    new Date(left.dueDate).getTime() - new Date(right.dueDate).getTime(),
  );
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lembreto//Calendar Export//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Lembreto',
    'X-WR-CALDESC:Lembretes pendentes do Lembreto',
    `X-WR-TIMEZONE:${CALENDAR_TIME_ZONE}`,
    'X-PUBLISHED-TTL:PT15M',
    ...sortedTasks.flatMap((task) => buildTaskEvent(task, dtstamp) ?? []),
    'END:VCALENDAR',
  ];

  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
