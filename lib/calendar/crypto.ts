import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey(): Buffer {
  const configured = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY;
  if (configured) {
    const trimmed = configured.trim();
    if (/^[a-f0-9]{64}$/i.test(trimmed)) {
      return Buffer.from(trimmed, 'hex');
    }

    return crypto.createHash('sha256').update(trimmed).digest();
  }

  const fallback = process.env.JWT_SECRET;
  if (!fallback) {
    throw new Error('CALENDAR_TOKEN_ENCRYPTION_KEY ou JWT_SECRET precisa estar configurado');
  }

  return crypto.createHash('sha256').update(fallback).digest();
}

export function encryptCalendarToken(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.');
}

export function decryptCalendarToken(value: string): string {
  const [ivValue, tagValue, encryptedValue] = value.split('.');
  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error('Token de calendário criptografado inválido');
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(ivValue, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
