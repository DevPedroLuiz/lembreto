import { z } from 'zod';
import { validateAvatarDataUrl } from './avatar.js';
import {
  NOTE_MODES,
  NOTIFICATION_TONES,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from './contracts.js';

const nameSchema = z.string().trim().min(1, 'Nome obrigatório').max(80, 'Nome muito longo');
const emailSchema = z.string().trim().email('E-mail inválido').max(254, 'E-mail muito longo');
const passwordSchema = z.string().min(6, 'A senha deve ter no mínimo 6 caracteres').max(72, 'Senha muito longa');
const recaptchaTokenSchema = z.string().trim().min(1, 'Confirme que você não é um robô').max(4096, 'Verificação inválida').optional();
const titleSchema = z.string().trim().min(1, 'Título obrigatório').max(140, 'Título muito longo');
const descriptionSchema = z.string().max(4000, 'Descrição muito longa');
const categorySchema = z.string().trim().min(1, 'Categoria obrigatória').max(40, 'Categoria muito longa');
const tagNameSchema = z.string().trim().min(1, 'Tag obrigatória').max(24, 'Tag muito longa');
const noteContentSchema = z.string().max(6000, 'Conteúdo muito longo');
const stateCodeSchema = z.string().trim().length(2, 'Estado inválido');
const cityNameSchema = z.string().trim().min(1, 'Cidade obrigatória').max(120, 'Cidade muito longa');
const dueDateSchema = z.string().refine(
  (value) => !Number.isNaN(Date.parse(value)),
  'Data inválida',
);
const avatarSchema = z.string().superRefine((value, ctx) => {
  const result = validateAvatarDataUrl(value);
  if (!result.valid) {
    ctx.addIssue({
      code: 'custom',
      message: result.error ?? 'Avatar inválido',
    });
  }
});
const notificationTargetSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('task'),
    taskId: z.string().uuid('Identificador do lembrete inválido'),
  }).strict(),
  z.object({
    type: z.literal('notifications'),
  }).strict(),
  z.object({
    type: z.literal('profile'),
  }).strict(),
  z.object({
    type: z.literal('settings'),
  }).strict(),
]);

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  recaptchaToken: recaptchaTokenSchema,
}).strict();

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Senha obrigatória'),
  recaptchaToken: recaptchaTokenSchema,
}).strict();

export const recoverPasswordSchema = z.object({
  email: emailSchema,
  recaptchaToken: recaptchaTokenSchema,
}).strict();

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(1, 'Token obrigatório'),
  password: passwordSchema,
}).strict();

export const profileUpdateSchema = z.object({
  name: nameSchema.optional(),
  email: emailSchema.optional(),
  password: passwordSchema.optional(),
  avatar: z.union([avatarSchema, z.null()]).optional(),
  stateCode: z.union([stateCodeSchema, z.null()]).optional(),
  cityName: z.union([cityNameSchema, z.null()]).optional(),
  holidayRegionCode: z.union([z.string().trim().max(24, 'Código regional muito longo'), z.null()]).optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  'Envie ao menos um campo para atualizar',
);

export const createTaskSchema = z.object({
  title: titleSchema,
  description: descriptionSchema.default(''),
  dueDate: dueDateSchema.nullable().optional(),
  priority: z.enum(TASK_PRIORITIES).default('medium'),
  category: categorySchema.default('Geral'),
  tags: z.array(tagNameSchema).max(12, 'Muitas tags').default([]),
  suppressHolidayNotifications: z.boolean().default(false),
}).strict();

export const updateTaskSchema = z.object({
  title: titleSchema.optional(),
  description: descriptionSchema.optional(),
  dueDate: dueDateSchema.nullable().optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  category: categorySchema.optional(),
  tags: z.array(tagNameSchema).max(12, 'Muitas tags').optional(),
  suppressHolidayNotifications: z.boolean().optional(),
  status: z.enum(TASK_STATUSES).optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  'Envie ao menos um campo para atualizar',
);

export const createTaskCategorySchema = z.object({
  name: categorySchema,
}).strict();

export const createTaskTagSchema = z.object({
  name: tagNameSchema,
}).strict();

export const detectHolidayLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
}).strict();

export const createNoteSchema = z.object({
  title: titleSchema,
  content: noteContentSchema.default(''),
  priority: z.enum(TASK_PRIORITIES).default('medium'),
  category: categorySchema.default('Geral'),
  tags: z.array(tagNameSchema).max(12, 'Muitas tags').default([]),
  mode: z.enum(NOTE_MODES).default('temporary'),
  taskId: z.string().uuid('Identificador do lembrete inválido').nullable().optional(),
}).strict();

export const updateNoteSchema = z.object({
  title: titleSchema.optional(),
  content: noteContentSchema.optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  category: categorySchema.optional(),
  tags: z.array(tagNameSchema).max(12, 'Muitas tags').optional(),
  mode: z.enum(NOTE_MODES).optional(),
  taskId: z.string().uuid('Identificador do lembrete inválido').nullable().optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  'Envie ao menos um campo para atualizar',
);

export const createNotificationSchema = z.object({
  title: z.string().trim().min(1, 'Título obrigatório').max(120, 'Título muito longo'),
  message: z.string().trim().min(1, 'Mensagem obrigatória').max(500, 'Mensagem muito longa'),
  tone: z.enum(NOTIFICATION_TONES).default('info'),
  target: notificationTargetSchema.optional(),
  dedupeKey: z.string().trim().max(255, 'Chave de deduplicação muito longa').optional(),
}).strict();

export const updateNotificationSchema = z.object({
  read: z.boolean(),
}).strict();

export const updateNotificationSettingsSchema = z.object({
  enabled: z.boolean(),
}).strict();

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().trim().url('Endpoint de push inválido').max(4096, 'Endpoint de push muito longo'),
  expirationTime: z.number().int().nullable().optional(),
  keys: z.object({
    p256dh: z.string().trim().min(1, 'Chave p256dh obrigatória').max(1024, 'Chave p256dh muito longa'),
    auth: z.string().trim().min(1, 'Chave auth obrigatória').max(1024, 'Chave auth muito longa'),
  }).strict(),
  userAgent: z.string().trim().max(512, 'User agent muito longo').optional(),
}).strict();

export const deletePushSubscriptionSchema = z.object({
  endpoint: z.string().trim().url('Endpoint de push inválido').max(4096, 'Endpoint de push muito longo'),
}).strict();

export function formatZodError(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue?.message ?? 'Dados inválidos';
}
