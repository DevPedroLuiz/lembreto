import { z } from 'zod';
import { validateAvatarDataUrl } from './avatar.js';
import { TASK_PRIORITIES, TASK_STATUSES } from './contracts.js';

const nameSchema = z.string().trim().min(1, 'Nome obrigatorio').max(80, 'Nome muito longo');
const emailSchema = z.string().trim().email('Email invalido').max(254, 'Email muito longo');
const passwordSchema = z.string().min(6, 'A senha deve ter no minimo 6 caracteres').max(72, 'Senha muito longa');
const titleSchema = z.string().trim().min(1, 'Titulo obrigatorio').max(140, 'Titulo muito longo');
const descriptionSchema = z.string().max(4000, 'Descricao muito longa');
const categorySchema = z.string().trim().min(1, 'Categoria obrigatoria').max(40, 'Categoria muito longa');
const dueDateSchema = z.string().refine(
  (value) => !Number.isNaN(Date.parse(value)),
  'Data invalida',
);
const avatarSchema = z.string().superRefine((value, ctx) => {
  const result = validateAvatarDataUrl(value);
  if (!result.valid) {
    ctx.addIssue({
      code: 'custom',
      message: result.error ?? 'Avatar invalido',
    });
  }
});

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
}).strict();

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Senha obrigatoria'),
}).strict();

export const recoverPasswordSchema = z.object({
  email: emailSchema,
}).strict();

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(1, 'Token obrigatorio'),
  password: passwordSchema,
}).strict();

export const profileUpdateSchema = z.object({
  name: nameSchema.optional(),
  email: emailSchema.optional(),
  password: passwordSchema.optional(),
  avatar: z.union([avatarSchema, z.null()]).optional(),
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
}).strict();

export const updateTaskSchema = z.object({
  title: titleSchema.optional(),
  description: descriptionSchema.optional(),
  dueDate: dueDateSchema.nullable().optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  category: categorySchema.optional(),
  status: z.enum(TASK_STATUSES).optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  'Envie ao menos um campo para atualizar',
);

export function formatZodError(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue?.message ?? 'Dados invalidos';
}
