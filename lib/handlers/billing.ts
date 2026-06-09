import {
  createMercadoPagoPreapproval,
  getMercadoPagoAuthorizedPayment,
  getMercadoPagoPreapproval,
  getMercadoPagoSubscriptionIdForOrganization,
  isBillingConfigured,
  isPaidPlanCode,
  upsertMercadoPagoSubscriptionFromPreapproval,
  verifyMercadoPagoWebhookSignature,
} from '../billing.js';
import { getAuthFailureResponse, requireAuthFromAuthorizationHeader } from '../auth.js';
import { logError, logInfo, logWarn } from '../logger.js';
import { ensureSaasInfrastructure, requireCurrentOrganization } from '../organizations.js';
import {
  type HandlerContext,
  type HandlerResult,
  getRequestMeta,
  json,
  methodNotAllowed,
  type SqlClient,
} from './core.js';

function firstQueryValue(value: unknown) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

function getAppUrl(context: HandlerContext) {
  const origin = context.request.headers.origin;
  if (typeof origin === 'string' && origin.trim()) return origin.replace(/\/+$/, '');
  return (process.env.APP_URL || context.defaultAppUrl || 'http://localhost:3001').replace(/\/+$/, '');
}

async function requireBillingAuth(context: HandlerContext) {
  try {
    return await requireAuthFromAuthorizationHeader(
      context.sql,
      context.request.headers.authorization as string | undefined,
    );
  } catch (error) {
    const authFailure = getAuthFailureResponse(error);
    if (authFailure) return json(authFailure.status, { error: authFailure.error });

    logError('billing_auth_failed', error, getRequestMeta(context.request));
    return json(500, { error: 'Erro interno ao autenticar' });
  }
}

function requireBillingReady() {
  if (!isBillingConfigured()) {
    return json(501, { error: 'Billing ainda nao configurado. Defina as variaveis MERCADO_PAGO_*.' });
  }

  return null;
}

async function createCheckout(context: HandlerContext) {
  const auth = await requireBillingAuth(context);
  if ('status' in auth) return auth;

  const billingReady = requireBillingReady();
  if (billingReady) return billingReady;

  const body = context.request.body && typeof context.request.body === 'object'
    ? context.request.body as { planCode?: unknown }
    : {};
  const planCode = typeof body.planCode === 'string' ? body.planCode : '';
  if (!isPaidPlanCode(planCode)) return json(400, { error: 'Plano invalido para checkout.' });

  await ensureSaasInfrastructure(context.sql);
  const organization = await requireCurrentOrganization(context.sql, { ...auth.user, currentOrganization: null });
  if (organization.role !== 'owner') {
    return json(403, { error: 'Apenas o proprietario pode alterar assinatura.' });
  }

  const appUrl = getAppUrl(context);
  const preapproval = await createMercadoPagoPreapproval({
    organizationId: organization.id,
    organizationName: organization.name,
    userId: auth.user.id,
    payerEmail: auth.user.email,
    planCode,
    appUrl,
  });

  await upsertMercadoPagoSubscriptionFromPreapproval(context.sql, preapproval, {
    organizationId: organization.id,
    planCode,
    customerId: auth.user.email,
  });

  logInfo('billing_checkout_created', getRequestMeta(context.request, {
    provider: 'mercado_pago',
    userId: auth.user.id,
    organizationId: organization.id,
    planCode,
    preapprovalId: preapproval.id,
  }));

  return json(200, { url: preapproval.init_point || null });
}

async function createPortal(context: HandlerContext) {
  const auth = await requireBillingAuth(context);
  if ('status' in auth) return auth;

  const billingReady = requireBillingReady();
  if (billingReady) return billingReady;

  await ensureSaasInfrastructure(context.sql);
  const organization = await requireCurrentOrganization(context.sql, { ...auth.user, currentOrganization: null });
  if (organization.role !== 'owner') {
    return json(403, { error: 'Apenas o proprietario pode gerenciar assinatura.' });
  }

  const preapprovalId = await getMercadoPagoSubscriptionIdForOrganization(context.sql, organization.id);
  if (!preapprovalId) {
    return json(404, { error: 'Nenhuma assinatura Mercado Pago encontrada para este workspace.' });
  }

  const subscription = await getMercadoPagoPreapproval(preapprovalId);
  const status = (subscription.status || '').toLowerCase();
  const url = status === 'pending' && subscription.init_point
    ? subscription.init_point
    : process.env.MERCADO_PAGO_SUBSCRIPTIONS_URL || 'https://www.mercadopago.com.br/subscriptions';

  logInfo('billing_portal_created', getRequestMeta(context.request, {
    provider: 'mercado_pago',
    userId: auth.user.id,
    organizationId: organization.id,
    preapprovalId,
  }));

  return json(200, { url });
}

export async function handleBilling(context: HandlerContext): Promise<HandlerResult> {
  if (context.request.method !== 'POST') return methodNotAllowed();

  const action = firstQueryValue(context.request.query?.action);
  try {
    if (action === 'checkout') return await createCheckout(context);
    if (action === 'portal') return await createPortal(context);
    return json(404, { error: 'Acao de billing nao encontrada.' });
  } catch (error) {
    logError('billing_action_failed', error, getRequestMeta(context.request, { action }));
    return json(500, { error: 'Erro ao processar billing.' });
  }
}

function parseRawJson(rawBody: Buffer | string) {
  const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
  if (!raw.trim()) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function getWebhookDataId(body: Record<string, unknown>, query: Record<string, unknown>) {
  const queryDataId = firstQueryValue(query['data.id']) || firstQueryValue(query.id);
  if (queryDataId) return queryDataId;

  const data = body.data;
  if (data && typeof data === 'object' && 'id' in data) {
    const value = (data as { id?: unknown }).id;
    if (typeof value === 'string' || typeof value === 'number') return String(value);
  }

  return null;
}

function getWebhookTopic(body: Record<string, unknown>, query: Record<string, unknown>) {
  const topic = firstQueryValue(query.topic) || firstQueryValue(query.type);
  if (topic) return topic;

  const bodyType = body.type;
  if (typeof bodyType === 'string') return bodyType;

  const bodyTopic = body.topic;
  return typeof bodyTopic === 'string' ? bodyTopic : null;
}

export async function handleMercadoPagoWebhookRaw(
  sql: SqlClient,
  rawBody: Buffer | string,
  headers: {
    signature?: string | null;
    requestId?: string | null;
  },
  query: Record<string, unknown> = {},
) {
  let body: Record<string, unknown>;
  try {
    body = parseRawJson(rawBody);
  } catch (error) {
    logWarn('mercado_pago_webhook_invalid_json', {
      error: error instanceof Error ? error.message : String(error),
    });
    return json(400, { error: 'JSON invalido.' });
  }

  const dataId = getWebhookDataId(body, query);
  try {
    const validSignature = verifyMercadoPagoWebhookSignature({
      signature: headers.signature,
      requestId: headers.requestId,
      dataId: firstQueryValue(query['data.id']) || firstQueryValue(query.id),
    });
    if (!validSignature) {
      logWarn('mercado_pago_webhook_invalid_signature', { dataId });
      return json(400, { error: 'Assinatura Mercado Pago invalida.' });
    }
  } catch (error) {
    logWarn('mercado_pago_webhook_signature_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return json(501, { error: 'Webhook Mercado Pago nao configurado.' });
  }

  const topic = getWebhookTopic(body, query);
  try {
    if (topic === 'subscription_preapproval' && dataId) {
      const preapproval = await getMercadoPagoPreapproval(dataId);
      await upsertMercadoPagoSubscriptionFromPreapproval(sql, preapproval);
    } else if (topic === 'subscription_authorized_payment' && dataId) {
      const authorizedPayment = await getMercadoPagoAuthorizedPayment(dataId);
      const preapprovalId = authorizedPayment.preapproval_id || authorizedPayment.subscription_id;
      if (preapprovalId) {
        const preapproval = await getMercadoPagoPreapproval(preapprovalId);
        await upsertMercadoPagoSubscriptionFromPreapproval(sql, preapproval);
      }
    }

    logInfo('mercado_pago_webhook_processed', { topic, dataId });
    return json(200, { received: true });
  } catch (error) {
    logError('mercado_pago_webhook_failed', error, { topic, dataId });
    return json(500, { error: 'Erro ao processar webhook Mercado Pago.' });
  }
}
