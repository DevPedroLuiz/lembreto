const ALLOWED_AVATAR_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;

export const MAX_AVATAR_BYTES = 256 * 1024;

export function isAllowedAvatarMimeType(mimeType: string): boolean {
  return (ALLOWED_AVATAR_MIME_TYPES as readonly string[]).includes(mimeType);
}

export function parseAvatarDataUrl(
  value: string,
): { mimeType: string; base64: string } | null {
  const match = value.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;

  return {
    mimeType: match[1].toLowerCase(),
    base64: match[2],
  };
}

export function estimateBase64Bytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export function validateAvatarDataUrl(value: string): { valid: boolean; error?: string } {
  const parsed = parseAvatarDataUrl(value);
  if (!parsed) {
    return { valid: false, error: 'Avatar invalido. Use uma imagem em base64.' };
  }

  if (!isAllowedAvatarMimeType(parsed.mimeType)) {
    return {
      valid: false,
      error: 'Formato de avatar invalido. Use PNG, JPG, WEBP ou GIF.',
    };
  }

  const bytes = estimateBase64Bytes(parsed.base64);
  if (bytes > MAX_AVATAR_BYTES) {
    return {
      valid: false,
      error: `Avatar muito grande. Limite de ${Math.round(MAX_AVATAR_BYTES / 1024)} KB.`,
    };
  }

  return { valid: true };
}
