self.__LEMBRETO_SW_VERSION = '2026-05-06-1';
const recentPushKeys = new Map();
const PUSH_DEDUPE_WINDOW_MS = 5 * 60 * 1000;

const APP_CACHE = `lembreto-app-${self.__LEMBRETO_SW_VERSION}`;
const RUNTIME_CACHE = `lembreto-runtime-${self.__LEMBRETO_SW_VERSION}`;
const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    await cache.addAll(APP_SHELL_URLS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.startsWith('lembreto-') && ![APP_CACHE, RUNTIME_CACHE].includes(cacheName))
        .map((cacheName) => caches.delete(cacheName)),
    );
    await self.clients.claim();
  })());
});

function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);

  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return cache.match(request);
  }
}

async function appShellFallback(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(APP_CACHE);
    if (response.ok) {
      await cache.put('/index.html', response.clone());
    }
    return response;
  } catch {
    return caches.match('/index.html');
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(RUNTIME_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin || request.method !== 'GET' || isApiRequest(url)) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(appShellFallback(request));
    return;
  }

  if (request.destination === 'script' || request.destination === 'style') {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

function normalizeNotificationPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return {
      title: 'Lembreto',
      body: 'Voce recebeu uma nova notificacao.',
      icon: '/icon.png',
      badge: '/icon.png',
      tag: 'lembreto-notification',
      data: {
        path: '/?notificationTarget=notifications',
      },
    };
  }

  const data = payload.data && typeof payload.data === 'object'
    ? payload.data
    : { path: '/?notificationTarget=notifications' };
  const stableTag = typeof data.dedupeKey === 'string'
    ? data.dedupeKey
    : typeof data.scheduleId === 'string'
      ? `alarm:${data.scheduleId}`
      : typeof payload.tag === 'string'
        ? payload.tag
        : 'lembreto-notification';

  return {
    title: typeof payload.title === 'string' && payload.title.trim().length > 0
      ? payload.title
      : 'Lembreto',
    body: typeof payload.body === 'string' && payload.body.trim().length > 0
      ? payload.body
      : 'Voce recebeu uma nova notificacao.',
    icon: typeof payload.icon === 'string' ? payload.icon : '/icon.png',
    badge: typeof payload.badge === 'string' ? payload.badge : '/icon.png',
    tag: stableTag,
    data,
  };
}

self.addEventListener('push', (event) => {
  const payload = normalizeNotificationPayload(event.data ? event.data.json() : null);

  event.waitUntil((async () => {
    const now = Date.now();
    for (const [key, seenAt] of recentPushKeys.entries()) {
      if (now - seenAt > PUSH_DEDUPE_WINDOW_MS) recentPushKeys.delete(key);
    }

    const pushKey =
      payload.data && typeof payload.data.dedupeKey === 'string'
        ? payload.data.dedupeKey
        : payload.data && typeof payload.data.scheduleId === 'string'
          ? `schedule:${payload.data.scheduleId}`
          : payload.tag;

    if (recentPushKeys.has(pushKey)) return;
    recentPushKeys.set(pushKey, now);

    const clients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    const visibleClient = clients.find((client) => client.visibilityState === 'visible');
    if (visibleClient) {
      visibleClient.postMessage({
        type: 'PUSH_NOTIFICATION_RECEIVED',
        payload,
      });
      return;
    }

    await self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon,
      badge: payload.badge,
      tag: payload.tag,
      data: payload.data,
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const path =
    event.notification.data &&
    typeof event.notification.data.path === 'string' &&
    event.notification.data.path.length > 0
      ? event.notification.data.path
      : '/?notificationTarget=notifications';

  event.waitUntil((async () => {
    const targetUrl = new URL(path, self.location.origin).toString();
    const clients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    for (const client of clients) {
      if ('navigate' in client) {
        await client.navigate(targetUrl);
        await client.focus();
        return;
      }
    }

    await self.clients.openWindow(targetUrl);
  })());
});
