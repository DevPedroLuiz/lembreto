import { Capacitor } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';

const TOKEN_KEY = 'lembreto.authToken';
const TOKEN_PAYLOAD_VERSION = 1;

interface MobileTokenPayload {
  version: number;
  token: string;
}

export function isNativeMobileRuntime() {
  return Capacitor.isNativePlatform();
}

function normalizeStoredToken(value: string | null) {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<MobileTokenPayload> | string;
    if (typeof parsed === 'string') return parsed.trim() || null;
    if (typeof parsed?.token === 'string') return parsed.token.trim() || null;
  } catch {
    return value.trim() || null;
  }

  return null;
}

async function removeStoredToken() {
  try {
    await SecureStorage.removeItem(TOKEN_KEY);
  } catch {
    try {
      await SecureStorage.remove(TOKEN_KEY);
    } catch {
      // Some Android KeyStore failures cannot be repaired from JS.
    }
  }
}

export async function loadMobileAuthToken() {
  if (!isNativeMobileRuntime()) return null;

  try {
    const rawValue = await SecureStorage.getItem(TOKEN_KEY);
    const token = normalizeStoredToken(rawValue);

    if (!token) {
      await removeStoredToken();
      return null;
    }

    return token;
  } catch {
    await removeStoredToken();
    return null;
  }
}

export async function saveMobileAuthToken(token: string) {
  if (!isNativeMobileRuntime()) return;

  const payload: MobileTokenPayload = {
    version: TOKEN_PAYLOAD_VERSION,
    token,
  };

  try {
    await SecureStorage.setItem(TOKEN_KEY, JSON.stringify(payload));
  } catch {
    await removeStoredToken();
    try {
      await SecureStorage.setItem(TOKEN_KEY, JSON.stringify(payload));
    } catch {
      console.warn('[mobileSession] Nao foi possivel salvar a sessao no Secure Storage.');
    }
  }
}

export async function clearMobileAuthToken() {
  if (!isNativeMobileRuntime()) return;
  await removeStoredToken();
}
