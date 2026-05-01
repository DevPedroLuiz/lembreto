self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
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

  return {
    title: typeof payload.title === 'string' && payload.title.trim().length > 0
      ? payload.title
      : 'Lembreto',
    body: typeof payload.body === 'string' && payload.body.trim().length > 0
      ? payload.body
      : 'Voce recebeu uma nova notificacao.',
    icon: typeof payload.icon === 'string' ? payload.icon : '/icon.png',
    badge: typeof payload.badge === 'string' ? payload.badge : '/icon.png',
    tag: typeof payload.tag === 'string' ? payload.tag : 'lembreto-notification',
    data: payload.data && typeof payload.data === 'object'
      ? payload.data
      : { path: '/?notificationTarget=notifications' },
  };
}

self.addEventListener('push', (event) => {
  const payload = normalizeNotificationPayload(event.data ? event.data.json() : null);

  event.waitUntil((async () => {
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
