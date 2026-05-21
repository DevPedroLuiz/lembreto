import type { OverdueReminderIntensity } from './contracts.js';

export const OVERDUE_LIFETIME_HOURS = 72;

const MAX_OVERDUE_INTERVAL_MINUTES = 360;
const MAX_OVERDUE_SEQUENCE_COUNT = 100;
const INSISTENT_INTERVALS = [5, 15, 30, 60, 120, 240] as const;
const GENTLE_INTERVALS = [30, 120] as const;

export interface OverdueReminderSequence {
  sequenceIndex: number;
  thresholdMinutes: number;
  intervalMinutes: number;
}

function normalizeIntensity(intensity?: string | null): OverdueReminderIntensity {
  if (
    intensity === 'gentle' ||
    intensity === 'normal' ||
    intensity === 'insistent' ||
    intensity === 'silent'
  ) {
    return intensity;
  }

  return 'normal';
}

export function getOverdueIntervalMinutes(sequenceIndex: number, intensity: OverdueReminderIntensity = 'normal'): number {
  if (intensity === 'silent') return Number.POSITIVE_INFINITY;

  if (intensity === 'gentle') {
    return GENTLE_INTERVALS[sequenceIndex] ?? MAX_OVERDUE_INTERVAL_MINUTES;
  }

  if (intensity === 'insistent') {
    return INSISTENT_INTERVALS[sequenceIndex] ?? MAX_OVERDUE_INTERVAL_MINUTES;
  }

  if (sequenceIndex <= 0) return 15;
  if (sequenceIndex === 1) return 30;

  let previousPrevious = 15;
  let previous = 30;
  for (let index = 2; index <= sequenceIndex; index += 1) {
    const next = Math.min(previousPrevious + previous, MAX_OVERDUE_INTERVAL_MINUTES);
    previousPrevious = previous;
    previous = next;
  }

  return previous;
}

export function buildOverdueScheduleOffsets(
  maxMinutes = OVERDUE_LIFETIME_HOURS * 60,
  intensity?: string | null,
) {
  const normalizedIntensity = normalizeIntensity(intensity);
  if (normalizedIntensity === 'silent') return [];

  const offsets: OverdueReminderSequence[] = [];
  let thresholdMinutes = 0;

  for (let sequenceIndex = 0; sequenceIndex < MAX_OVERDUE_SEQUENCE_COUNT; sequenceIndex += 1) {
    const intervalMinutes = getOverdueIntervalMinutes(sequenceIndex, normalizedIntensity);
    thresholdMinutes += intervalMinutes;
    if (thresholdMinutes > maxMinutes) break;
    offsets.push({ sequenceIndex, thresholdMinutes, intervalMinutes });
  }

  return offsets;
}

export function getOverdueReminderSequence(
  minutesOverdue: number,
  intensity?: string | null,
): OverdueReminderSequence | null {
  if (!Number.isFinite(minutesOverdue) || minutesOverdue < 0) return null;

  let activeSequence: OverdueReminderSequence | null = null;
  for (const sequence of buildOverdueScheduleOffsets(undefined, intensity)) {
    if (sequence.thresholdMinutes > minutesOverdue) break;
    activeSequence = sequence;
  }

  return activeSequence;
}

export function buildOverdueScheduleTimes(
  dueDate: Date,
  overdueExpiresAt: Date,
  intensity?: string | null,
) {
  const lifetimeMinutes = Math.max(0, Math.floor((overdueExpiresAt.getTime() - dueDate.getTime()) / 60000));

  return buildOverdueScheduleOffsets(lifetimeMinutes, intensity).map((sequence) => ({
    notifyAt: new Date(dueDate.getTime() + sequence.thresholdMinutes * 60 * 1000),
    sequenceIndex: sequence.sequenceIndex,
    intervalMinutes: sequence.intervalMinutes,
  }));
}

export function formatOverdueDuration(minutes: number): string {
  const safeMinutes = Math.max(0, Math.floor(minutes));
  const days = Math.floor(safeMinutes / (24 * 60));
  const hours = Math.floor((safeMinutes % (24 * 60)) / 60);
  const remainingMinutes = safeMinutes % 60;

  if (days > 0) return `${days} dia${days === 1 ? '' : 's'}${hours > 0 ? ` e ${hours}h` : ''}`;
  if (hours > 0 && remainingMinutes > 0) return `${hours}h${remainingMinutes}min`;
  if (hours > 0) return `${hours}h`;
  return `${remainingMinutes} minuto${remainingMinutes === 1 ? '' : 's'}`;
}
