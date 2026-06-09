import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from '../_db.js';
import { handleMercadoPagoWebhookRaw } from '../../lib/handlers/billing.js';
import { sendHandlerResult } from '../../lib/handlers/core.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length > 0) return Buffer.concat(chunks);

  if (req.body && typeof req.body === 'object') {
    return Buffer.from(JSON.stringify(req.body));
  }

  return Buffer.alloc(0);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return sendHandlerResult(res, { status: 405, body: { error: 'Metodo nao permitido' } });
  }

  const rawBody = await readRawBody(req);
  const signatureHeader = req.headers['x-signature'];
  const requestIdHeader = req.headers['x-request-id'];
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  const requestId = Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader;
  const result = await handleMercadoPagoWebhookRaw(sql, rawBody, { signature, requestId }, req.query);
  return sendHandlerResult(res, result);
}
