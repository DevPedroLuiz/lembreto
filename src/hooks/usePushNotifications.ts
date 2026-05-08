import { useCallback, useEffect, useRef, useState } from 'react';
import { apiDelete, apiPost } from '../api/client';

const PUSH_SERVICE_WORKER_PATH = '/push-sw.js';

function isPushSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
}

interface UsePushNotificationsOptions {
  token: string | null;
  enabled: boolean;
  pushPublicKey: string | null;
  notificationPermission: NotificationPermission;
  onPushMessage?: (payload: unknown) => void;
}

export function usePushNotifications({
  token,
  enabled,
  pushPublicKey,
  notificationPermission,
  onPushMessage,
}: UsePushNotificationsOptions) {
  const registrationPromiseRef = useRef<Promise<ServiceWorkerRegistration> | null>(null);
  const syncedEndpointRef = useRef<string | null>(null);
  const [subscriptionEndpoint, setSubscriptionEndpoint] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  const ensureRegistration = useCallback(async () => {
    if (!isPushSupported()) {
      throw new Error('Push notifications are not supported in this browser.');
    }

    if (!registrationPromiseRef.current) {
      registrationPromiseRef.current = navigator.serviceWorker.register(PUSH_SERVICE_WORKER_PATH, {
        scope: '/',
      });
    }

    await registrationPromiseRef.current;
    return navigator.serviceWorker.ready;
  }, []);

  useEffect(() => {
    syncedEndpointRef.current = null;
    setSubscriptionEndpoint(null);
    setPushError(null);
  }, [token]);

  const syncPushSubscription = useCallback(async () => {
    if (!isPushSupported()) {
      setSubscriptionEndpoint(null);
      setPushError('Este navegador não oferece suporte a notificações push.');
      return;
    }

    setIsSyncing(true);
    setPushError(null);

    try {
      const registration = await ensureRegistration();
      const existingSubscription = await registration.pushManager.getSubscription();
      const explicitlyDisabled = !enabled || notificationPermission !== 'granted';

      if (explicitlyDisabled) {
        if (existingSubscription) {
          if (token) {
            await apiDelete('/api/notifications/push-subscriptions', token, {
              endpoint: existingSubscription.endpoint,
            }).catch(() => {
              // best effort cleanup
            });
          }

          await existingSubscription.unsubscribe().catch(() => {
            // best effort unsubscribe
          });
        }

        syncedEndpointRef.current = null;
        setSubscriptionEndpoint(null);
        return;
      }

      if (!existingSubscription) {
        if (!token || !pushPublicKey) {
          setSubscriptionEndpoint(null);
          return;
        }

        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(pushPublicKey),
        });

        const json = subscription.toJSON();
        if (!json.keys?.p256dh || !json.keys.auth) {
          throw new Error('O navegador retornou uma assinatura push inválida.');
        }

        await apiPost(
          '/api/notifications/push-subscriptions',
          {
            endpoint: json.endpoint,
            expirationTime: json.expirationTime ?? null,
            keys: {
              p256dh: json.keys.p256dh,
              auth: json.keys.auth,
            },
            userAgent: navigator.userAgent,
          },
          token,
        );

        syncedEndpointRef.current = subscription.endpoint;
        setSubscriptionEndpoint(subscription.endpoint);
        return;
      }

      setSubscriptionEndpoint(existingSubscription.endpoint);

      if (!token || !pushPublicKey || syncedEndpointRef.current === existingSubscription.endpoint) {
        return;
      }

      const json = existingSubscription.toJSON();
      if (!json.keys?.p256dh || !json.keys.auth) {
        throw new Error('O navegador retornou uma assinatura push inválida.');
      }

      await apiPost(
        '/api/notifications/push-subscriptions',
        {
          endpoint: json.endpoint,
          expirationTime: json.expirationTime ?? null,
          keys: {
            p256dh: json.keys.p256dh,
            auth: json.keys.auth,
          },
          userAgent: navigator.userAgent,
        },
        token,
      );

      syncedEndpointRef.current = existingSubscription.endpoint;
      setSubscriptionEndpoint(existingSubscription.endpoint);
    } catch (error) {
      setPushError(
        error instanceof Error
          ? error.message
          : 'Não foi possível conectar este navegador às notificações do Windows.',
      );
      throw error;
    } finally {
      setIsSyncing(false);
    }
  }, [enabled, ensureRegistration, notificationPermission, pushPublicKey, token]);

  useEffect(() => {
    void syncPushSubscription().catch(() => {
      // the app still works without push; this is a best effort sync
    });
  }, [syncPushSubscription]);

  useEffect(() => {
    if (!isPushSupported() || !onPushMessage) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'PUSH_NOTIFICATION_RECEIVED') {
        onPushMessage(event.data.payload);
      }
    };

    navigator.serviceWorker.addEventListener('message', handleMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
  }, [onPushMessage]);

  useEffect(() => {
    if (!isPushSupported()) return;

    const resync = () => {
      void syncPushSubscription().catch(() => {
        // best effort resync
      });
    };

    window.addEventListener('focus', resync);
    document.addEventListener('visibilitychange', resync);

    return () => {
      window.removeEventListener('focus', resync);
      document.removeEventListener('visibilitychange', resync);
    };
  }, [syncPushSubscription]);

  return {
    pushSupported: isPushSupported(),
    subscriptionReady: subscriptionEndpoint !== null && notificationPermission === 'granted',
    isSyncing,
    pushError,
    syncPushSubscription,
  };
}
