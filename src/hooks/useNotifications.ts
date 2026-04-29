import { useCallback, useEffect, useRef, useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut } from '../api/client';
import type { AppNotification, NotificationTarget } from '../types';

interface NotificationsResponse {
  notifications: AppNotification[];
  enabled: boolean;
}

interface NotificationCreateResponse {
  created: boolean;
  notification: AppNotification;
}

export function useNotifications(token: string | null) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [serverEnabled, setServerEnabled] = useState<boolean | null>(null);
  const [loaded, setLoaded] = useState(false);
  const requestSequenceRef = useRef(0);

  useEffect(() => {
    requestSequenceRef.current += 1;
    setNotifications([]);
    setServerEnabled(null);
    setLoaded(false);
  }, [token]);

  const refreshNotifications = useCallback(async (overrideToken?: string | null) => {
    const requestToken = overrideToken ?? token;

    if (!requestToken) {
      setNotifications([]);
      setServerEnabled(null);
      setLoaded(true);
      return { notifications: [], enabled: true } satisfies NotificationsResponse;
    }

    const requestSequence = ++requestSequenceRef.current;
    const data = await apiGet<NotificationsResponse>('/api/notifications', requestToken);

    if (requestSequence === requestSequenceRef.current) {
      setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
      setServerEnabled(data.enabled);
      setLoaded(true);
    }

    return data;
  }, [token]);

  useEffect(() => {
    setLoaded(false);
    void refreshNotifications().catch(() => {
      setNotifications([]);
      setServerEnabled(null);
      setLoaded(true);
    });
  }, [refreshNotifications]);

  const createNotification = useCallback(async (payload: {
    title: string;
    message: string;
    tone: AppNotification['tone'];
    target?: NotificationTarget;
    dedupeKey?: string;
    token?: string | null;
  }) => {
    const requestToken = payload.token ?? token;

    if (!requestToken) {
      throw new Error('Não autenticado');
    }

    const { token: _token, ...requestPayload } = payload;
    const data = await apiPost<NotificationCreateResponse>('/api/notifications', requestPayload, requestToken);
    await refreshNotifications(requestToken);

    return data;
  }, [refreshNotifications, token]);

  const markNotificationRead = useCallback(async (id: string, read: boolean) => {
    if (!token) {
      throw new Error('Não autenticado');
    }

    const data = await apiPut<{ notification: AppNotification }>(`/api/notifications/${id}`, { read }, token);
    setNotifications((prev) => prev.map((item) => (
      item.id === id ? data.notification : item
    )));
    return data.notification;
  }, [token]);

  const markAllRead = useCallback(async () => {
    if (!token) {
      throw new Error('Não autenticado');
    }

    await apiPost('/api/notifications/mark-all-read', {}, token);
    setNotifications((prev) => prev.map((item) => (
      item.read ? item : { ...item, read: true }
    )));
  }, [token]);

  const clearAll = useCallback(async () => {
    if (!token) {
      throw new Error('Não autenticado');
    }

    await apiDelete('/api/notifications', token);
    setNotifications([]);
  }, [token]);

  const updateNotificationsEnabled = useCallback(async (enabled: boolean) => {
    if (!token) {
      throw new Error('Não autenticado');
    }

    requestSequenceRef.current += 1;
    setServerEnabled(enabled);
    await apiPut<{ enabled: boolean }>('/api/notifications/settings', { enabled }, token);
    setServerEnabled(enabled);
    return enabled;
  }, [token]);

  return {
    notifications,
    serverEnabled,
    loaded,
    refreshNotifications,
    createNotification,
    markNotificationRead,
    markAllRead,
    clearAll,
    updateNotificationsEnabled,
  };
}
