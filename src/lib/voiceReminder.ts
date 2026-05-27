import { formatDateInputValue } from './taskDueDate';

export interface VoiceReminderParseResult {
  title: string;
  date: string;
  time: string;
}

const WEEKDAY_ALIASES: Array<{ names: string[]; weekday: number }> = [
  { names: ['domingo'], weekday: 0 },
  { names: ['segunda', 'segunda feira'], weekday: 1 },
  { names: ['terca', 'terca feira', 'terça', 'terça feira'], weekday: 2 },
  { names: ['quarta', 'quarta feira'], weekday: 3 },
  { names: ['quinta', 'quinta feira'], weekday: 4 },
  { names: ['sexta', 'sexta feira'], weekday: 5 },
  { names: ['sabado', 'sábado'], weekday: 6 },
];

const HOUR_WORDS = new Map<string, number>([
  ['zero', 0],
  ['uma', 1],
  ['um', 1],
  ['duas', 2],
  ['dois', 2],
  ['tres', 3],
  ['três', 3],
  ['quatro', 4],
  ['cinco', 5],
  ['seis', 6],
  ['sete', 7],
  ['oito', 8],
  ['nove', 9],
  ['dez', 10],
  ['onze', 11],
  ['doze', 12],
]);

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeForMatching(value: string): string {
  return stripAccents(value)
    .toLocaleLowerCase('pt-BR')
    .replace(/[.,!?;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function addCalendarDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setHours(12, 0, 0, 0);
  next.setDate(next.getDate() + amount);
  return next;
}

function getNextWeekday(referenceDate: Date, weekday: number): Date {
  const currentWeekday = referenceDate.getDay();
  const diff = (weekday - currentWeekday + 7) % 7 || 7;
  return addCalendarDays(referenceDate, diff);
}

function formatTime(hour: number, minute = 0): string {
  const safeHour = Math.min(23, Math.max(0, hour));
  const safeMinute = Math.min(59, Math.max(0, minute));
  return `${`${safeHour}`.padStart(2, '0')}:${`${safeMinute}`.padStart(2, '0')}`;
}

function applyPeriod(hour: number, period: string | undefined): number {
  if (!period) return hour;

  if (period.includes('tarde') && hour >= 1 && hour <= 11) return hour + 12;
  if (period.includes('noite') && hour >= 1 && hour <= 11) return hour + 12;
  if (period.includes('manha') && hour === 12) return 0;
  if (period.includes('madrugada') && hour === 12) return 0;

  return hour;
}

function parseDate(transcript: string, referenceDate: Date): string {
  const normalized = normalizeForMatching(transcript);

  if (/\bdepois de amanha\b/.test(normalized)) {
    return formatDateInputValue(addCalendarDays(referenceDate, 2));
  }

  if (/\bamanha\b/.test(normalized)) {
    return formatDateInputValue(addCalendarDays(referenceDate, 1));
  }

  if (/\bhoje\b/.test(normalized)) {
    return formatDateInputValue(referenceDate);
  }

  for (const option of WEEKDAY_ALIASES) {
    if (option.names.some((name) => normalized.includes(name))) {
      return formatDateInputValue(getNextWeekday(referenceDate, option.weekday));
    }
  }

  const dayMonthMatch = normalized.match(/\bdia\s+(\d{1,2})(?:\s+de\s+(\d{1,2}))?\b/);
  if (dayMonthMatch) {
    const day = Number(dayMonthMatch[1]);
    const explicitMonth = dayMonthMatch[2] ? Number(dayMonthMatch[2]) : null;
    const month = explicitMonth ? explicitMonth - 1 : referenceDate.getMonth();
    const candidate = new Date(referenceDate.getFullYear(), month, day, 12, 0, 0, 0);

    if (!explicitMonth && candidate < addCalendarDays(referenceDate, 0)) {
      candidate.setMonth(candidate.getMonth() + 1);
    }

    if (!Number.isNaN(candidate.getTime()) && candidate.getDate() === day) {
      return formatDateInputValue(candidate);
    }
  }

  return '';
}

function parseTime(transcript: string): string {
  const normalized = normalizeForMatching(transcript);

  if (/\bmeia noite\b/.test(normalized)) return '00:00';
  if (/\bmeio dia\b/.test(normalized)) return '12:00';

  const numericMatch = normalized.match(
    /\b(?:as|a|para|pelas|por volta de)\s+(\d{1,2})(?:\s*(?:h|:)\s*(\d{1,2}))?(?:\s+da\s+(manha|tarde|noite|madrugada))?\b/,
  ) ?? normalized.match(
    /\b(\d{1,2})(?:\s*(?:h|:)\s*(\d{1,2})|\s+horas?)(?:\s+da\s+(manha|tarde|noite|madrugada))?\b/,
  ) ?? normalized.match(
    /\b(\d{1,2})\s+da\s+(manha|tarde|noite|madrugada)\b/,
  );

  if (numericMatch) {
    const period = numericMatch[3] ?? numericMatch[2];
    const hour = applyPeriod(Number(numericMatch[1]), period);
    const minute = numericMatch[2] && /^\d+$/.test(numericMatch[2]) ? Number(numericMatch[2].padEnd(2, '0')) : 0;
    if (hour <= 23 && minute <= 59) return formatTime(hour, minute);
  }

  const hourWordsPattern = Array.from(HOUR_WORDS.keys())
    .map((word) => stripAccents(word))
    .join('|');
  const wordMatch = normalized.match(
    new RegExp(`\\b(?:as|a|para|pelas|por volta de)\\s+(${hourWordsPattern})(?:\\s+e\\s+meia)?(?:\\s+horas?)?(?:\\s+da\\s+(manha|tarde|noite|madrugada))?\\b`),
  ) ?? normalized.match(
    new RegExp(`\\b(${hourWordsPattern})(?:\\s+e\\s+meia)?\\s+horas?(?:\\s+da\\s+(manha|tarde|noite|madrugada))?\\b`),
  ) ?? normalized.match(
    new RegExp(`\\b(${hourWordsPattern})\\s+da\\s+(manha|tarde|noite|madrugada)\\b`),
  );

  if (wordMatch) {
    const baseHour = HOUR_WORDS.get(wordMatch[1]) ?? HOUR_WORDS.get(wordMatch[1].replace('tres', 'três'));
    if (typeof baseHour === 'number') {
      const hour = applyPeriod(baseHour, wordMatch[2]);
      const minute = wordMatch[0].includes(' e meia') ? 30 : 0;
      return formatTime(hour, minute);
    }
  }

  return '';
}

function removeVoiceCommandPrefix(value: string): string {
  return value.replace(
    /^\s*(?:lembre[-\s]?me|me\s+lembre|lembrar|lembrete|crie\s+(?:um\s+)?lembrete|criar\s+(?:um\s+)?lembrete)\s*/i,
    '',
  );
}

function removeDateExpressions(value: string): string {
  return value
    .replace(/\bdepois de amanh[ãa]\b/gi, ' ')
    .replace(/\bamanh[ãa]\b/gi, ' ')
    .replace(/\bhoje\b/gi, ' ')
    .replace(/\b(?:domingo|segunda(?:[-\s]?feira)?|terça(?:[-\s]?feira)?|terca(?:[-\s]?feira)?|quarta(?:[-\s]?feira)?|quinta(?:[-\s]?feira)?|sexta(?:[-\s]?feira)?|s[áa]bado)\b/gi, ' ')
    .replace(/\bdia\s+\d{1,2}(?:\s+de\s+\d{1,2})?\b/gi, ' ');
}

function removeTimeExpressions(value: string): string {
  return value
    .replace(/\b(?:[àa]s|a|para|pelas|por volta de)\s+(?:meia[-\s]?noite|meio[-\s]?dia)\b/gi, ' ')
    .replace(/\b(?:meia[-\s]?noite|meio[-\s]?dia)\b/gi, ' ')
    .replace(
      /\b(?:[àa]s|a|para|pelas|por volta de)\s+\d{1,2}(?:\s*(?:h|:)\s*\d{1,2})?(?:\s+da\s+(?:manh[ãa]|tarde|noite|madrugada))?\b/gi,
      ' ',
    )
    .replace(
      /\b\d{1,2}(?:\s*(?:h|:)\s*\d{1,2}|\s+horas?)(?:\s+da\s+(?:manh[ãa]|tarde|noite|madrugada))?\b/gi,
      ' ',
    )
    .replace(
      /\b\d{1,2}\s+da\s+(?:manh[ãa]|tarde|noite|madrugada)\b/gi,
      ' ',
    )
    .replace(
      /\b(?:[àa]s|a|para|pelas|por volta de)\s+(?:zero|uma|um|duas|dois|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)(?:\s+e\s+meia)?(?:\s+da\s+(?:manh[ãa]|tarde|noite|madrugada))?\b/gi,
      ' ',
    )
    .replace(
      /\b(?:zero|uma|um|duas|dois|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)(?:\s+e\s+meia)?\s+horas?(?:\s+da\s+(?:manh[ãa]|tarde|noite|madrugada))?\b/gi,
      ' ',
    )
    .replace(
      /\b(?:zero|uma|um|duas|dois|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)\s+da\s+(?:manh[ãa]|tarde|noite|madrugada)\b/gi,
      ' ',
    );
}

function cleanupTitle(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/^\s*(?:de|do|da|para|pra|que eu)\s+/i, '')
    .replace(/\s+$/g, '')
    .trim();
}

export function parsePortugueseVoiceReminder(
  transcript: string,
  referenceDate = new Date(),
): VoiceReminderParseResult {
  const title = cleanupTitle(removeTimeExpressions(removeDateExpressions(removeVoiceCommandPrefix(transcript))));

  return {
    title,
    date: parseDate(transcript, referenceDate),
    time: parseTime(transcript),
  };
}
