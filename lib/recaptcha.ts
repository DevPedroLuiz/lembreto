import type { HandlerRequest } from './handlers/core.js';
import { logError, logWarn } from './logger.js';

const RECAPTCHA_VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

interface RecaptchaVerifyResponse {
  success?: boolean;
  hostname?: string;
  'error-codes'?: string[];
}

export function isRecaptchaConfigured(): boolean {
  return Boolean(process.env.RECAPTCHA_SECRET_KEY);
}

export function getRecaptchaSiteKey(): string | null {
  const siteKey = process.env.VITE_RECAPTCHA_SITE_KEY ?? process.env.RECAPTCHA_SITE_KEY;
  const normalizedSiteKey = siteKey?.trim();
  return normalizedSiteKey ? normalizedSiteKey : null;
}

export function shouldSkipRecaptchaForTest(): boolean {
  return process.env.RECAPTCHA_SKIP_VERIFY === 'true';
}

export function shouldEnforceRecaptcha(): boolean {
  if (shouldSkipRecaptchaForTest()) return false;
  return isRecaptchaConfigured() || process.env.NODE_ENV === 'production';
}

export async function verifyRecaptchaToken(
  token: string | undefined,
  request: HandlerRequest,
): Promise<boolean> {
  const secret = process.env.RECAPTCHA_SECRET_KEY;

  if (shouldSkipRecaptchaForTest()) return true;

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      logError('recaptcha_missing_secret', new Error('RECAPTCHA_SECRET_KEY missing'), {
        requestId: request.requestId,
      });
      return false;
    }

    logWarn('recaptcha_skipped_missing_secret', { requestId: request.requestId });
    return true;
  }

  if (!token?.trim()) return false;

  try {
    const body = new URLSearchParams({
      secret,
      response: token,
    });

    if (request.ip && request.ip !== 'unknown') {
      body.set('remoteip', request.ip);
    }

    const response = await fetch(RECAPTCHA_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    const data = await response.json().catch(() => ({})) as RecaptchaVerifyResponse;
    if (!response.ok || !data.success) {
      logWarn('recaptcha_rejected', {
        requestId: request.requestId,
        errors: data['error-codes'] ?? [],
      });
      return false;
    }

    return true;
  } catch (error) {
    logError('recaptcha_verify_failed', error, { requestId: request.requestId });
    return false;
  }
}
