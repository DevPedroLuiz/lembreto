const APP_SOURCE = 'lembreto-app';
const EXTENSION_SOURCE = 'lembreto-extension';
const REQUEST_PING = 'LEMBRETO_EXTENSION_PING';
const REQUEST_ENABLE = 'LEMBRETO_EXTENSION_ENABLE';
const RESPONSE = 'LEMBRETO_EXTENSION_RESPONSE';

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(values) {
  return new Promise((resolve) => chrome.storage.local.set(values, resolve));
}

function reply(requestId, payload) {
  window.postMessage({
    source: EXTENSION_SOURCE,
    type: RESPONSE,
    requestId,
    payload,
  }, window.location.origin);
}

window.addEventListener('message', async (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data = event.data;
  if (!data || typeof data !== 'object' || data.source !== APP_SOURCE) return;
  if (data.type !== REQUEST_PING && data.type !== REQUEST_ENABLE) return;

  const requestId = typeof data.requestId === 'string' ? data.requestId : '';
  if (!requestId) return;

  try {
    if (data.type === REQUEST_ENABLE) {
      await storageSet({
        appOrigin: window.location.origin,
        extensionEnabled: true,
        extensionEnabledAt: new Date().toISOString(),
      });
      reply(requestId, {
        installed: true,
        active: true,
        appOrigin: window.location.origin,
      });
      return;
    }

    const stored = await storageGet(['appOrigin', 'extensionEnabled']);
    reply(requestId, {
      installed: true,
      active: Boolean(stored.extensionEnabled) && stored.appOrigin === window.location.origin,
      appOrigin: stored.appOrigin || '',
    });
  } catch (error) {
    reply(requestId, {
      installed: true,
      active: false,
      error: error instanceof Error ? error.message : 'Erro ao falar com a extensao.',
    });
  }
});
