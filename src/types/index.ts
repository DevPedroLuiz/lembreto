// src/types/index.ts
// Shared TypeScript types used across the app

export type Priority = 'low' | 'medium' | 'high';
export type Status = 'pending' | 'completed';

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string | null;
}

export interface Task {
  id: string;
  userId: string;
  title: string;
  description: string;
  dueDate: string;
  priority: Priority;
  category: string;
  status: Status;
  createdAt: string;
}

export const CATEGORIES = ['Geral', 'Trabalho', 'Pessoal', 'Estudos'] as const;
export type Category = (typeof CATEGORIES)[number];
