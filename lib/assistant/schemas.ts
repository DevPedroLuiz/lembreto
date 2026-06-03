import { z } from 'zod';

const prioritySchema = z.enum(['low', 'medium', 'high']);
const taskStatusSchema = z.enum(['pending', 'completed', 'inactive', 'cancelled']);
const listTaskStatusSchema = z.enum(['pending', 'overdue', 'completed']);
const notificationReadFilterSchema = z.enum(['unread', 'read', 'all']);
const notificationKindSchema = z.enum(['pre_notice', 'notification', 'alarm', 'floating_reminder', 'overdue_reminder']);
const assistantBriefModeSchema = z.enum(['overdue', 'today', 'week']);
const manageNotificationsActionSchema = z.enum([
  'process_due',
  'mark_all_read',
  'clear_all',
  'clear_read',
  'enable',
  'disable',
]);
const contextRefSchema = z.enum([
  'last_created_task',
  'last_updated_task',
  'last_relevant_task',
  'last_listed_task_first',
  'last_listed_task_last',
]);
const recurrenceTypeSchema = z.enum(['none', 'daily', 'weekly', 'monthly', 'yearly']);
const weekdaySchema = z.enum([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);

const isoDateLikeSchema = z.string().trim().refine(
  (value) => !Number.isNaN(Date.parse(value)),
  'Data invalida',
);

const optionalNullableDateSchema = z.union([isoDateLikeSchema, z.null()]).optional();

export const assistantMessageSchema = z.object({
  message: z.string().trim().min(1, 'Digite uma mensagem para o assistente.').max(
    1200,
    'Sua mensagem ficou muito longa. Tente resumir em ate 1200 caracteres.',
  ),
  conversationId: z.string().uuid('Conversa invalida').nullable().optional(),
}).strict();

export const assistantScreenshotSchema = z.object({
  imageDataUrl: z.string().trim().regex(
    /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/,
    'Imagem invalida. Envie uma captura PNG, JPEG ou WebP em base64.',
  ).max(7_500_000, 'Imagem muito grande. Tente capturar uma area menor.'),
  pageTitle: z.string().trim().max(200).optional(),
  pageUrl: z.string().trim().max(2048).optional(),
  instruction: z.string().trim().max(500).optional(),
  conversationId: z.string().uuid('Conversa invalida').nullable().optional(),
}).strict();

const recurrenceSchema = z.object({
  type: recurrenceTypeSchema,
  interval: z.number().int().min(1).max(365).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  weekdays: z.array(weekdaySchema).max(7).optional(),
  time: z.string().trim().regex(/^\d{2}:\d{2}$/, 'Horario invalido').optional(),
}).strict();

const createTaskActionSchema = z.object({
  type: z.literal('create_task'),
  payload: z.object({
    title: z.string().trim().min(1).max(140),
    description: z.string().max(4000).optional(),
    dueDate: optionalNullableDateSchema,
    endDate: optionalNullableDateSchema,
    priority: prioritySchema.optional(),
    category: z.string().trim().min(1).max(40).optional(),
    tags: z.array(z.string().trim().min(1).max(24)).max(12).optional(),
    alarmEnabled: z.boolean().optional(),
    noTimeReminderMinutes: z.number().int().min(1).max(24 * 60).optional(),
    recurrence: recurrenceSchema.optional(),
  }).strict(),
  confirmationMessage: z.string().trim().min(1).max(500),
}).strict();

const listTasksActionSchema = z.object({
  type: z.literal('list_tasks'),
  payload: z.object({
    status: listTaskStatusSchema.optional(),
    from: optionalNullableDateSchema,
    to: optionalNullableDateSchema,
    search: z.string().trim().max(80).nullable().optional(),
  }).strict(),
  confirmationMessage: z.string().trim().min(1).max(500),
}).strict();

const updateTaskActionSchema = z.object({
  type: z.literal('update_task'),
  payload: z.object({
    taskId: z.string().uuid().optional(),
    search: z.string().trim().min(1).max(120).optional(),
    contextRef: contextRefSchema.optional(),
    updates: z.object({
      title: z.string().trim().min(1).max(140).optional(),
      description: z.string().max(4000).optional(),
      dueDate: optionalNullableDateSchema,
      priority: prioritySchema.optional(),
      category: z.string().trim().min(1).max(40).optional(),
      tags: z.array(z.string().trim().min(1).max(24)).max(12).optional(),
      status: taskStatusSchema.optional(),
    }).strict(),
  }).strict().refine((value) => value.taskId || value.contextRef || value.search, {
    message: 'Informe taskId, contextRef ou search para atualizar o lembrete.',
    path: ['search'],
  }),
  confirmationMessage: z.string().trim().min(1).max(500),
}).strict();

const createNoteActionSchema = z.object({
  type: z.literal('create_note'),
  payload: z.object({
    title: z.string().trim().min(1).max(140),
    content: z.string().max(6000),
    category: z.string().trim().min(1).max(40).optional(),
    tags: z.array(z.string().trim().min(1).max(24)).max(12).optional(),
  }).strict(),
  confirmationMessage: z.string().trim().min(1).max(500),
}).strict();

const listNotificationsActionSchema = z.object({
  type: z.literal('list_notifications'),
  payload: z.object({
    read: notificationReadFilterSchema.optional(),
    kind: notificationKindSchema.optional(),
    limit: z.number().int().min(1).max(10).optional(),
  }).strict(),
  confirmationMessage: z.string().trim().min(1).max(500),
}).strict();

const manageNotificationsActionObjectSchema = z.object({
  type: z.literal('manage_notifications'),
  payload: z.object({
    action: manageNotificationsActionSchema,
  }).strict(),
  confirmationMessage: z.string().trim().min(1).max(500),
}).strict();

const assistantBriefActionSchema = z.object({
  type: z.literal('assistant_brief'),
  payload: z.object({
    mode: assistantBriefModeSchema,
  }).strict(),
  confirmationMessage: z.string().trim().min(1).max(500),
}).strict();

const answerOnlyActionSchema = z.object({
  type: z.literal('answer_only'),
  payload: z.object({
    answer: z.string().trim().min(1).max(1200),
  }).strict(),
  confirmationMessage: z.string().trim().min(1).max(500),
}).strict();

const needsConfirmationActionSchema = z.object({
  type: z.literal('needs_confirmation'),
  payload: z.object({
    question: z.string().trim().min(1).max(500),
    draftAction: z.unknown().optional(),
  }).strict(),
  confirmationMessage: z.string().trim().min(1).max(500),
}).strict();

export const assistantActionSchema = z.discriminatedUnion('type', [
  createTaskActionSchema,
  listTasksActionSchema,
  updateTaskActionSchema,
  listNotificationsActionSchema,
  manageNotificationsActionObjectSchema,
  assistantBriefActionSchema,
  createNoteActionSchema,
  answerOnlyActionSchema,
  needsConfirmationActionSchema,
]);

export const assistantResponseSchema = z.object({
  conversationId: z.string().uuid(),
  message: z.string().trim().min(1).max(1200),
  action: z.object({
    type: z.string().trim().min(1).max(80),
    status: z.enum(['success', 'failed', 'needs_confirmation', 'skipped']),
    entityType: z.string().trim().min(1).max(40).optional(),
    entityId: z.string().uuid().optional(),
    entityTitle: z.string().trim().min(1).max(180).optional(),
  }).strict(),
  references: z.object({
    lastCreatedTaskId: z.string().uuid().optional(),
    lastUpdatedTaskId: z.string().uuid().optional(),
    listedTaskIds: z.array(z.string().uuid()).optional(),
    pendingConfirmationId: z.string().uuid().optional(),
  }).strict().optional(),
}).strict();

export type AssistantMessage = z.infer<typeof assistantMessageSchema>;
export type AssistantScreenshot = z.infer<typeof assistantScreenshotSchema>;
export type AssistantAction = z.infer<typeof assistantActionSchema>;
export type AssistantResponse = z.infer<typeof assistantResponseSchema>;
