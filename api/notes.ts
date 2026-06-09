import type { VercelRequest, VercelResponse } from '@vercel/node';
import sql from './_db.js';
import {
  handleNoteById,
  handleNotesCollection,
} from '../lib/handlers/notes.js';
import { buildHandlerRequest, handleCorsPreflight, sendHandlerResult } from '../lib/handlers/core.js';

function hasNoteId(req: VercelRequest): boolean {
  const value = req.query.id;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0].trim().length > 0;
  return false;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const request = buildHandlerRequest(req);
  const preflight = handleCorsPreflight(request);
  if (preflight) return sendHandlerResult(res, preflight, request);
  const result = hasNoteId(req)
    ? await handleNoteById({ sql, request })
    : await handleNotesCollection({ sql, request });

  return sendHandlerResult(res, result, request);
}
