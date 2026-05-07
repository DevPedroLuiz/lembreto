import { useCallback, useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut } from '../api/client';
import type {
  CalendarIntegrationProvider,
  CalendarIntegrationStatus,
  CalendarSyncAllResult,
} from '../types';

interface CalendarIntegrationsResponse {
  integrations: CalendarIntegrationStatus[];
}

interface CalendarSyncAllResponse extends CalendarIntegrationsResponse {
  result: CalendarSyncAllResult;
}

export function useCalendarIntegrations(token: string | null) {
  const [integrations, setIntegrations] = useState<CalendarIntegrationStatus[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refreshCalendarIntegrations = useCallback(async (requestToken = token) => {
    if (!requestToken) {
      setIntegrations([]);
      return [];
    }

    setIsLoading(true);
    try {
      const data = await apiGet<CalendarIntegrationsResponse>('/api/calendar/integrations', requestToken);
      const items = Array.isArray(data.integrations) ? data.integrations : [];
      setIntegrations(items);
      return items;
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) {
      setIntegrations([]);
      return;
    }

    void refreshCalendarIntegrations(token).catch(() => {
      setIntegrations([]);
    });
  }, [refreshCalendarIntegrations, token]);

  const connectCalendar = useCallback((provider: CalendarIntegrationProvider, requestToken = token) => {
    if (!requestToken) throw new Error('Não autenticado');
    window.location.assign(`/api/calendar/${provider}/connect`);
  }, [token]);

  const updateCalendarSync = useCallback(async (
    provider: CalendarIntegrationProvider,
    syncEnabled: boolean,
    requestToken = token,
  ) => {
    if (!requestToken) throw new Error('Não autenticado');
    const data = await apiPut<CalendarIntegrationsResponse>(
      `/api/calendar/${provider}`,
      { syncEnabled },
      requestToken,
    );
    setIntegrations(Array.isArray(data.integrations) ? data.integrations : []);
  }, [token]);

  const disconnectCalendar = useCallback(async (
    provider: CalendarIntegrationProvider,
    requestToken = token,
  ) => {
    if (!requestToken) throw new Error('Não autenticado');
    await apiDelete(`/api/calendar/${provider}`, requestToken);
    await refreshCalendarIntegrations(requestToken);
  }, [refreshCalendarIntegrations, token]);

  const syncTaskNow = useCallback(async (
    taskId: string,
    provider?: CalendarIntegrationProvider,
    requestToken = token,
  ) => {
    if (!requestToken) throw new Error('Não autenticado');
    await apiPost(`/api/calendar/tasks/${taskId}/sync`, provider ? { provider } : {}, requestToken);
  }, [token]);

  const syncAllNow = useCallback(async (
    provider: CalendarIntegrationProvider,
    requestToken = token,
  ) => {
    if (!requestToken) throw new Error('NÃ£o autenticado');
    const data = await apiPost<CalendarSyncAllResponse>(`/api/calendar/${provider}/sync-all`, {}, requestToken);
    setIntegrations(Array.isArray(data.integrations) ? data.integrations : []);
    return data.result;
  }, [token]);

  return {
    integrations,
    isLoading,
    refreshCalendarIntegrations,
    connectCalendar,
    updateCalendarSync,
    disconnectCalendar,
    syncTaskNow,
    syncAllNow,
  };
}
