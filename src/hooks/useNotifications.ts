import { useCallback, useEffect, useRef, useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut } from '../api/client';
import type { AppNotification, NotificationTarget } from '../types';

export interface NotificationPageInfo {
  hasMore: boolean;
  nextCursor: string | null;
  limit: number;
}

export interface NotificationListQuery {
  search?: string;
  read?: boolean | null;
  tone?: AppNotification['tone'] | null;
  kind?: AppNotification['kind'] | null;
  createdFrom?: string | null;
  createdTo?: string | null;
  limit?: number;
}

interface NotificationsResponse {
  notifications: AppNotification[];
  enabled: boolean;
  pageInfo?: NotificationPageInfo;
  pushConfigured?: boolean;
  pushPublicKey?: string | null;
}

export type NotificationsSnapshot = NotificationsResponse;

interface NotificationCreateResponse {
  created: boolean;
  notification: AppNotification;
}

interface ProcessDueNotificationsResponse extends NotificationsResponse {
  ok: boolean;
}

const DEFAULT_NOTIFICATION_PAGE_INFO: NotificationPageInfo = {
  hasMore: false,
  nextCursor: null,
  limit: 50,
};

function appendParam(params: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === null || value === '') return;
  params.set(key, String(value));
}

function buildNotificationsPath(query: NotificationListQuery = {}, cursor?: string | null) {
  const params = new URLSearchParams();
  appendParam(params, 'search', query.search?.trim());
  appendParam(params, 'read', query.read);
  appendParam(params, 'tone', query.tone);
  appendParam(params, 'kind', query.kind);
  appendParam(params, 'createdFrom', query.createdFrom);
  appendParam(params, 'createdTo', query.createdTo);
  appendParam(params, 'limit', query.limit);
  appendParam(params, 'cursor', cursor);

  const queryString = params.toString();
  return queryString ? `/api/notifications?${queryString}` : '/api/notifications';
}

function mergeNotificationPages(
  current: AppNotification[],
  incoming: AppNotification[],
) {
  const seen = new Set<string>();
  return [...current, ...incoming].filter((notification) => {
    if (seen.has(notification.id)) return false;
    seen.add(notification.id);
    return true;
  });
}

export function useNotifications(token: string | null) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [pageInfo, setPageInfo] = useState<NotificationPageInfo>(DEFAULT_NOTIFICATION_PAGE_INFO);
  const [serverEnabled, setServerEnabled] = useState<boolean | null>(null);
  const [pushConfigured, setPushConfigured] = useState(false);
  const [pushPublicKey, setPushPublicKey] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const requestSequenceRef = useRef(0);
  const notificationQueryRef = useRef<NotificationListQuery>({});

  const applyNotificationsSnapshot = useCallback((data: NotificationsSnapshot, options?: { append?: boolean }) => {
    requestSequenceRef.current += 1;
    const nextNotifications = Array.isArray(data.notifications) ? data.notifications : [];
    setNotifications((current) => (
      options?.append ? mergeNotificationPages(current, nextNotifications) : nextNotifications
    ));
    setPageInfo(data.pageInfo ?? DEFAULT_NOTIFICATION_PAGE_INFO);
    setServerEnabled(data.enabled);
    setPushConfigured(Boolean(data.pushConfigured));
    setPushPublicKey(typeof data.pushPublicKey === 'string' ? data.pushPublicKey : null);
    setLoaded(true);
  }, []);

  useEffect(() => {
    requestSequenceRef.current += 1;
    setNotifications([]);
    setPageInfo(DEFAULT_NOTIFICATION_PAGE_INFO);
    setServerEnabled(null);
    setPushConfigured(false);
    setPushPublicKey(null);
    setLoaded(false);
    setIsLoadingMore(false);
    notificationQueryRef.current = {};
  }, [token]);

  const refreshNotifications = useCallback(async (
    overrideToken?: string | null,
    query?: NotificationListQuery,
  ) => {
    const requestToken = overrideToken ?? token;
    if (query) notificationQueryRef.current = query;

    if (!requestToken) {
      setNotifications([]);
      setPageInfo(DEFAULT_NOTIFICATION_PAGE_INFO);
      setServerEnabled(null);
      setPushConfigured(false);
      setPushPublicKey(null);
      setLoaded(true);
      return {
        notifications: [],
        enabled: true,
        pageInfo: DEFAULT_NOTIFICATION_PAGE_INFO,
      } satisfies NotificationsResponse;
    }

    const requestSequence = ++requestSequenceRef.current;
    const data = await apiGet<NotificationsResponse>(
      buildNotificationsPath(notificationQueryRef.current),
      requestToken,
    );

    if (requestSequence === requestSequenceRef.current) {
      applyNotificationsSnapshot(data);
    }

    return data;
  }, [applyNotificationsSnapshot, token]);

  useEffect(() => {
    setLoaded(false);
    void refreshNotifications().catch(() => {
      setNotifications([]);
      setPageInfo(DEFAULT_NOTIFICATION_PAGE_INFO);
      setServerEnabled(null);
      setPushConfigured(false);
      setPushPublicKey(null);
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

  const processDueNotifications = useCallback(async (overrideToken?: string | null) => {
    const requestToken = overrideToken ?? token;

    if (!requestToken) {
      return {
        ok: false,
        notifications: [],
        enabled: true,
        pageInfo: DEFAULT_NOTIFICATION_PAGE_INFO,
      } satisfies ProcessDueNotificationsResponse;
    }

    const requestSequence = ++requestSequenceRef.current;
    const data = await apiPost<ProcessDueNotificationsResponse>(
      '/api/notifications/process-due',
      {},
      requestToken,
    );

    if (requestSequence === requestSequenceRef.current) {
      applyNotificationsSnapshot(data);
    }

    return data;
  }, [applyNotificationsSnapshot, token]);

  const loadMoreNotifications = useCallback(async (overrideToken?: string | null) => {
    const requestToken = overrideToken ?? token;
    const cursor = pageInfo.nextCursor;

    if (!requestToken || !cursor || isLoadingMore) {
      return null;
    }

    setIsLoadingMore(true);
    const requestSequence = ++requestSequenceRef.current;

    try {
      const data = await apiGet<NotificationsResponse>(
        buildNotificationsPath(notificationQueryRef.current, cursor),
        requestToken,
      );

      if (requestSequence === requestSequenceRef.current) {
        applyNotificationsSnapshot(data, { append: true });
      }

      return data;
    } finally {
      setIsLoadingMore(false);
    }
  }, [applyNotificationsSnapshot, isLoadingMore, pageInfo.nextCursor, token]);

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

  const clearAll = useCallback(async (filters?: NotificationListQuery) => {
    if (!token) {
      throw new Error('Não autenticado');
    }

    await apiDelete('/api/notifications', token, filters);
    await refreshNotifications(token, notificationQueryRef.current);
  }, [refreshNotifications, token]);

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
    pageInfo,
    serverEnabled,
    pushConfigured,
    pushPublicKey,
    loaded,
    isLoadingMore,
    refreshNotifications,
    applyNotificationsSnapshot,
    processDueNotifications,
    loadMoreNotifications,
    createNotification,
    markNotificationRead,
    markAllRead,
    clearAll,
    updateNotificationsEnabled,
  };
}
