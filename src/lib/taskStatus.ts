import type { Task } from '../types';

export type DerivedTaskStatus = 'completed' | 'cancelled' | 'overdue' | 'pending';

type DerivableTaskStatus = Pick<Task, 'status' | 'dueDate' | 'deletedAt'>;

function parseTaskTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function getDerivedTaskStatus(task: DerivableTaskStatus, now: Date = new Date()): DerivedTaskStatus {
  if (task.status === 'cancelled' || task.status === 'inactive' || task.deletedAt) return 'cancelled';
  if (task.status === 'completed') return 'completed';

  const dueTimestamp = parseTaskTimestamp(task.dueDate);
  if ((task.status === 'pending' || task.status === 'overdue') && dueTimestamp !== null && dueTimestamp < now.getTime()) {
    return 'overdue';
  }

  return 'pending';
}

export function getDerivedTaskStatusLabel(status: DerivedTaskStatus): string {
  switch (status) {
    case 'completed':
      return 'Concluído';
    case 'cancelled':
      return 'Cancelado';
    case 'overdue':
      return 'Atrasado';
    case 'pending':
    default:
      return 'Pendente';
  }
}
