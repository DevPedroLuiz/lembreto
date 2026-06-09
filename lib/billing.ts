import crypto from 'node:crypto';
import type { SqlClient } from './handlers/core.js';

export type PaidPlanCode = 'pro' | 'team';

type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete';

export interface MercadoPagoPreapproval {
  id: string;
  status?: string | null;
  external_reference?: string | null;
  payer_id?: string | number | null;
  payer_email?: string | null;
  init_point?: string | null;
  next_payment_date?: string | null;
  date_created?: string | null;
  auto_recurring?: {
    transaction_amount?: number | null;
    currency_id?: string | null;
  } | null;
}

interface MercadoPagoAuthorizedPayment {
  id: string | number;
  preapproval_id?: string | null;
  subscription_id?: string | null;
}

const PAID_PLAN_CODES: PaidPlanCode[] = ['pro', 'team'];
const MERCADO_PAGO_API_BASE_URL = 'https://api.mercadopago.com';

export function isPaidPlanCode(value: string): value is PaidPlanCode {
  return PAID_PLAN_CODES.includes(value as PaidPlanCode);
}

export function isBillingConfigured() {
  return Boolean(
    process.env.MERCADO_PAGO_ACCESS_TOKEN &&
      process.env.MERCADO_PAGO_PRO_MONTHLY_AMOUNT &&
      process.env.MERCADO_PAGO_TEAM_MONTHLY_AMOUNT,
  );
}

function getAccessToken() {
  const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  if (!accessToken) throw new Error('MERCADO_PAGO_ACCESS_TOKEN nao configurado.');
  return accessToken;
}

function readAmount(name: string) {
  const raw = process.env[name];
  const value = raw ? Number.parseFloat(raw.replace(',', '.')) : Number.NaN;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} deve ser um valor numerico maior que zero.`);
  }
  return Math.round(value * 100) / 100;
}

export function getMercadoPagoPlanConfig(planCode: PaidPlanCode) {
  const amount = planCode === 'pro'
    ? readAmount('MERCADO_PAGO_PRO_MONTHLY_AMOUNT')
    : readAmount('MERCADO_PAGO_TEAM_MONTHLY_AMOUNT');

  return {
    amount,
    currency: (process.env.MERCADO_PAGO_CURRENCY || 'BRL').toUpperCase(),
    label: planCode === 'pro' ? 'Pro' : 'Team',
  };
}

async function mercadoPagoRequest<T>(
  path: string,
  init: RequestInit & { idempotencyKey?: string } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${getAccessToken()}`);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (init.idempotencyKey) headers.set('X-Idempotency-Key', init.idempotencyKey);

  const response = await fetch(`${MERCADO_PAGO_API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) as unknown : null;
  } catch {
    data = { message: text };
  }

  if (!response.ok) {
    const message = data && typeof data === 'object' && 'message' in data
      ? String((data as { message?: unknown }).message)
      : `Mercado Pago retornou HTTP ${response.status}.`;
    throw new Error(message);
  }

  return data as T;
}

export function buildMercadoPagoExternalReference(
  organizationId: string,
  planCode: PaidPlanCode,
  userId: string,
) {
  return `${organizationId}:${planCode}:${userId}`;
}

export function parseMercadoPagoExternalReference(reference: string | null | undefined) {
  if (!reference) return {};
  const [organizationId, planCode, userId] = reference.split(':');
  return {
    organizationId: organizationId || null,
    planCode: isPaidPlanCode(planCode || '') ? planCode as PaidPlanCode : null,
    userId: userId || null,
  };
}

export function getMercadoPagoWebhookUrl(appUrl: string) {
  const configured = process.env.MERCADO_PAGO_WEBHOOK_URL;
  const url = configured || `${appUrl.replace(/\/+$/, '')}/api/billing/webhook`;
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(url)) return null;
  return url;
}

export async function createMercadoPagoPreapproval(input: {
  organizationId: string;
  organizationName: string;
  userId: string;
  payerEmail: string;
  planCode: PaidPlanCode;
  appUrl: string;
}) {
  const plan = getMercadoPagoPlanConfig(input.planCode);
  const notificationUrl = getMercadoPagoWebhookUrl(input.appUrl);
  const body: Record<string, unknown> = {
    reason: `Lembreto ${plan.label}`,
    external_reference: buildMercadoPagoExternalReference(
      input.organizationId,
      input.planCode,
      input.userId,
    ),
    payer_email: input.payerEmail,
    back_url: `${input.appUrl}/?billing=success`,
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: plan.amount,
      currency_id: plan.currency,
    },
  };

  if (notificationUrl) {
    body.notification_url = `${notificationUrl}${notificationUrl.includes('?') ? '&' : '?'}source_news=webhooks`;
  }

  return mercadoPagoRequest<MercadoPagoPreapproval>('/preapproval', {
    method: 'POST',
    body: JSON.stringify(body),
    idempotencyKey: crypto.randomUUID(),
  });
}

export async function getMercadoPagoPreapproval(preapprovalId: string) {
  return mercadoPagoRequest<MercadoPagoPreapproval>(`/preapproval/${encodeURIComponent(preapprovalId)}`);
}

export async function getMercadoPagoAuthorizedPayment(authorizedPaymentId: string) {
  return mercadoPagoRequest<MercadoPagoAuthorizedPayment>(
    `/authorized_payments/${encodeURIComponent(authorizedPaymentId)}`,
  );
}

export function mapMercadoPagoSubscriptionStatus(status: string | null | undefined): SubscriptionStatus {
  const normalized = (status || '').toLowerCase();
  if (normalized === 'authorized') return 'active';
  if (normalized === 'pending') return 'incomplete';
  if (normalized === 'paused') return 'unpaid';
  if (normalized === 'cancelled' || normalized === 'canceled') return 'canceled';
  return 'incomplete';
}

function toDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function verifyMercadoPagoWebhookSignature(input: {
  signature: string | null | undefined;
  requestId: string | null | undefined;
  dataId: string | null | undefined;
}) {
  const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  if (!secret) throw new Error('MERCADO_PAGO_WEBHOOK_SECRET nao configurado.');
  if (!input.signature || !input.requestId) return false;

  const parts = input.signature.split(',').map((part) => part.trim());
  const ts = parts.find((part) => part.startsWith('ts='))?.slice(3);
  const hash = parts.find((part) => part.startsWith('v1='))?.slice(3);
  if (!ts || !hash) return false;

  const manifestParts: string[] = [];
  if (input.dataId) manifestParts.push(`id:${input.dataId.toLowerCase()};`);
  manifestParts.push(`request-id:${input.requestId};`);
  manifestParts.push(`ts:${ts};`);

  const expected = crypto
    .createHmac('sha256', secret)
    .update(manifestParts.join(''))
    .digest('hex');

  const expectedBuffer = Buffer.from(expected, 'hex');
  const receivedBuffer = Buffer.from(hash, 'hex');
  return expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

export async function getMercadoPagoSubscriptionIdForOrganization(sql: SqlClient, organizationId: string) {
  const rows = await sql`
    SELECT provider_subscription_id AS "providerSubscriptionId"
    FROM subscriptions
    WHERE organization_id = ${organizationId}
      AND provider = 'mercado_pago'
      AND provider_subscription_id IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1
  `;

  const value = rows[0]?.providerSubscriptionId;
  return typeof value === 'string' && value.trim() ? value : null;
}

export async function upsertMercadoPagoSubscriptionFromPreapproval(
  sql: SqlClient,
  preapproval: MercadoPagoPreapproval,
  fallback: {
    organizationId?: string | null;
    planCode?: string | null;
    customerId?: string | null;
  } = {},
) {
  const parsedReference = parseMercadoPagoExternalReference(preapproval.external_reference);
  const organizationId = parsedReference.organizationId || fallback.organizationId;
  const planCode = parsedReference.planCode || fallback.planCode || 'pro';
  const customerId = String(preapproval.payer_id || preapproval.payer_email || fallback.customerId || '');

  if (!organizationId || !customerId || !isPaidPlanCode(planCode)) {
    return false;
  }

  await sql`
    INSERT INTO subscriptions (
      organization_id,
      plan_code,
      provider,
      provider_customer_id,
      provider_subscription_id,
      status,
      current_period_start,
      current_period_end,
      cancel_at_period_end
    )
    VALUES (
      ${organizationId},
      ${planCode},
      'mercado_pago',
      ${customerId},
      ${preapproval.id},
      ${mapMercadoPagoSubscriptionStatus(preapproval.status)},
      ${toDate(preapproval.date_created)},
      ${toDate(preapproval.next_payment_date)},
      ${mapMercadoPagoSubscriptionStatus(preapproval.status) === 'canceled'}
    )
    ON CONFLICT (provider, provider_subscription_id)
    WHERE provider_subscription_id IS NOT NULL
    DO UPDATE SET
      plan_code = EXCLUDED.plan_code,
      provider_customer_id = EXCLUDED.provider_customer_id,
      status = EXCLUDED.status,
      current_period_start = EXCLUDED.current_period_start,
      current_period_end = EXCLUDED.current_period_end,
      cancel_at_period_end = EXCLUDED.cancel_at_period_end,
      updated_at = NOW()
  `;

  return true;
}
